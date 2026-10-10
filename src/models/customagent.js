const Agent = require('../agents/Agent');
const { streamText, generateText, tool, jsonSchema, stepCountIs } = require('ai');
const { createOpenAICompatible } = require('@ai-sdk/openai-compatible');

class CustomAgent extends Agent {
  _createSdkTools(onExecute = () => {}) {
    const configuredTools = this.toolManager?.pluginManager?.getAllTools?.() || {};
    const sdkTools = {};
    for (const [fullName, config] of Object.entries(configuredTools)) {
      if (!this.toolManager.isToolEnabled(fullName)) continue;
      const schema = config.parameters || { type: 'object', properties: {}, required: [] };
      sdkTools[fullName] = tool({
        description: config.description || fullName,
        inputSchema: jsonSchema(schema),
        execute: async (args) => {
          onExecute();
          if ((fullName.endsWith('.sendMessageToAgent') || fullName === 'sendMessageToAgent') && !args.senderAgentId) args = { ...args, senderAgentId: this.id };
          const result = await this.toolManager.executeTool(fullName, args, this);
          const usage = { tool: fullName, args, result, type: 'result' };
          this.history.push({ role: 'assistant', content: '', toolUsage: usage, timestamp: new Date().toISOString() });
          this.applyMemoryLimit();
          if (this.dataManager) this.dataManager.saveAgent(this);
          this.io.emit('agent-tool-usage', { agentId: this.id, toolUsage: usage });
          this.io.emit('agent-tool-result', { agentId: this.id, toolUsage: { ...usage, timestamp: new Date().toISOString() } });
          return result;
        }
      });
    }
    return sdkTools;
  }
  constructor(id, name, prompt, io, dataManager, cronManager, agentManager, model, providerId) {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);
    this.provider = providerId;
  }
  async _executeModelMessage(content) {
    try {
      const provider = global.modelManager?.getProvider(this.provider);
      if (!provider?.apiUrl) throw new Error('Custom provider URL is not configured');
      const endpoint = new URL(provider.apiUrl);
      const model = global.modelManager.getModel(this.provider, this.model);
      // The compatible SDK appends /chat/completions, so use the endpoint's parent as base URL.
      const baseURL = endpoint.pathname.endsWith('/chat/completions') ? endpoint.href.slice(0, -'/chat/completions'.length) : endpoint.href.replace(/\/$/, '');
      const apiKey = global.configManager?.getApiKey(this.provider) || provider.apiKey || '';
      const sdkOptions = { name: this.provider, baseURL, includeUsage: false };
      if (apiKey) sdkOptions.apiKey = apiKey;
      const sdkProvider = createOpenAICompatible(sdkOptions);
      const messages = [
        ...this.history.filter(m => ['user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content }
      ];
      this.status = 'taskWorking';
      this.io.emit('agent-status', { agentId: this.id, status: 'taskWorking' });
      let toolExecuted = false;
      const tools = this._createSdkTools(() => { toolExecuted = true; });
      const request = { model: sdkProvider.chatModel(model?.id || this.model), system: `${this.prompt || ''}${this.getAdminProfileContext()}`, messages, ...(Object.keys(tools).length ? { tools, stopWhen: stepCountIs(8) } : {}) };
      let response = '';
      const emitChunk = (chunk) => this.io.emit('agent-stream', { agentId: this.id, chunk, timestamp: new Date().toISOString() });
      const streamUnsupported = (error) => {
        const status = error.statusCode || error.cause?.statusCode;
        return [400, 404, 405, 406, 415, 501].includes(status) || /stream(?:ing)?[^\n]*(?:not supported|unsupported|disabled)|unsupported[^\n]*stream/i.test(error.message || '');
      };
      if (provider.supportsStreaming === false) {
        const result = await generateText(request);
        response = result.text || '';
        if (response) emitChunk(response);
      } else {
        try {
          const result = streamText(request);
          for await (const chunk of result.textStream) {
            response += chunk;
            emitChunk(chunk);
          }
        } catch (streamError) {
          if (response || toolExecuted || !streamUnsupported(streamError)) throw streamError;
          provider.supportsStreaming = false;
          global.modelManager?.saveModels(global.modelManager.models);
          const result = await generateText(request);
          response = result.text || '';
          if (response) emitChunk(response);
        }
      }
      this.history.push({ role: 'assistant', content: response, timestamp: new Date().toISOString() });
      this.applyMemoryLimit();
      if (this.dataManager) this.dataManager.saveAgent(this);
      this.status = 'ready';
      this.io.emit('agent-status', { agentId: this.id, status: 'ready' });
      this.completeCurrentQueueItem();
    } catch (error) {
      console.error(`Custom provider error (${this.provider}):`, error);
      this.status = 'ready';
      const details = error.responseBody || error.cause?.responseBody || error.message || 'Unknown provider error';
      const message = `Provider ${this.provider} request failed${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}: ${String(details).slice(0, 1200)}`;
      this.io.emit('agent-error', { agentId: this.id, error: message });
      this.io.emit('agent-status', { agentId: this.id, status: 'ready' });
      this.completeCurrentQueueItem();
    }
  }
}
module.exports = CustomAgent;
