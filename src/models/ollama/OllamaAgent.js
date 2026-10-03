const Agent = require('../../agents/Agent');

// Dynamic import for Ollama (ES module)
let ollama = null;
async function loadOllama() {
  if (!ollama) {
    const module = await import('ollama');
    ollama = module.default;
  }
  return ollama;
}

class OllamaAgent extends Agent {
  constructor(id, name, prompt, io, dataManager = null, cronManager = null, agentManager = null, model = 'qwen3:0.6b') {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);

    // Set provider to ollama
    this.provider = 'ollama';

    // Initialize queue system
    this.messageQueue = this.messageQueue || [];

    // Determine if using Ollama
    this.useOllama = this.model.startsWith('ollama:') || this.model.startsWith('qwen') || this.model.startsWith('llama') || this.model.startsWith('mistral');
    this.ollamaModel = this.model.startsWith('ollama:') ? this.model.replace('ollama:', '') : this.model;
  }

  async start() {
    await super.start();
    console.log(`Agent ${this.id} using Ollama model: ${this.ollamaModel}`);
  }

  _stopModelSession() {
    // Ollama doesn't have a persistent session to close
    // This is a no-op for Ollama
  }

  async _executeModelMessage(content, options = {}) {
    await this._executeOllamaMessage(content, options);
  }

  async _executeOllamaMessage(content, options = {}) {
    try {
      // Load Ollama dynamically
      const ollamaLib = await loadOllama();

      console.log(`OllamaAgent ${this.id} starting message execution: ${content.substring(0, 50)}...`);

      // Check for tasks coming from connection
      const processingItem = this.messageQueue.find(item => item.status === 'processing');
      if (processingItem && processingItem.reconnectionAttempt > 0) {
        console.log(`OllamaAgent ${this.id} processing reconnection task (attempt #${processingItem.reconnectionAttempt})`);

        // Check if task was already completed
        // Check if there is a similar task in history
        const isAlreadyCompleted = this._checkIfTaskAlreadyCompleted(processingItem.originalContent || processingItem.content);

        if (isAlreadyCompleted) {
          console.log(`OllamaAgent ${this.id} task was already completed, skipping reconnection task`);
          // Mark task as completed and skip
          this.completeCurrentQueueItem();
          return;
        }
      }

      this.status = 'taskWorking';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'taskWorking'
      });

      // Determine message content (preserve cron format)
      const messageContent = content; // content already comes in cron format

      // History and frontend updates are done in base Agent.js, this is empty
      // We don't add to history to prevent duplicate messages

      // Build messages array for Ollama
      const messages = [
        { role: 'system', content: this.prompt },
        ...this.history.map(msg => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        })),
        { role: 'user', content: messageContent } // Send in cron format
      ];

      // Get tools from ToolManager (plugin tools included)
      const tools = this._getToolDeclarations();

      // Agent loop for tool calls
      let agentLoop = true;
      let supportsThinking = false;

      // Check if model supports thinking using ModelManager
      if (global.modelManager) {
        supportsThinking = global.modelManager.modelSupportsThinking('ollama', this.ollamaModel);
      } else {
        // Fallback to old logic if ModelManager not available
        supportsThinking = !this.ollamaModel.includes('llama3.1');
      }

      console.log(`Model ${this.ollamaModel} supports thinking: ${supportsThinking}`);

      while (agentLoop) {
        try {
          const stream = await ollamaLib.chat({
            model: this.ollamaModel,
            messages: messages,
            tools: tools,
            stream: true,
            think: supportsThinking, // Enable thinking only for supported models
          });

          let thinking = '';
          let responseContent = '';
          const toolCalls = [];
          const streamStartTime = new Date().toISOString(); // Consistent stream start time

          for await (const chunk of stream) {
            if (supportsThinking && chunk.message.thinking) {
              thinking += chunk.message.thinking;
              // Don't emit thinking to client
            }
            if (chunk.message.content) {
              responseContent += chunk.message.content;
              this.io.emit('agent-stream', {
                agentId: this.id,
                chunk: chunk.message.content,
                timestamp: new Date().toISOString()
              });
              
              // Save each chunk to history for persistence across page refreshes
              this.history.push({
                role: 'assistant',
                content: chunk.message.content,
                timestamp: new Date().toISOString(),
                isStreamChunk: true,
                streamStartTime: streamStartTime
              });
              
              // Apply memory limit (less frequent for streaming)
              if (this.history.length % 10 === 0) {
                this.applyMemoryLimit();
              }
              
              // Save to storage after each chunk
              if (this.dataManager) {
                this.dataManager.saveAgent(this);
              }
            }
            if (chunk.message.tool_calls?.length) {
              toolCalls.push(...chunk.message.tool_calls);
            }
          }
          
          // Save tool calls info if present (chunks already saved in history)
          if (toolCalls.length > 0) {
            this.history.push({
              role: 'assistant',
              content: '',
              tool_calls: toolCalls,
              timestamp: new Date().toISOString()
            });
            
            // Apply memory limit
            this.applyMemoryLimit();
            
            // Save to storage
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
          }

          // If no tool calls, we're done
          if (!toolCalls.length) {
            agentLoop = false;
            break;
          }

          // Execute tool calls using ToolManager
          for (const call of toolCalls) {
            try {
              const toolName = call.function.name;
              let args = call.function.arguments;

              // Auto-add senderAgentId for sendMessageToAgent (same as GoogleAgent)
              if ((toolName === 'sendMessageToAgent' || toolName === 'agent.sendMessageToAgent') && !args.senderAgentId) {
                args = { ...args, senderAgentId: this.id };
              }

              // Execute tool using ToolManager
              const result = await this.toolManager.executeTool(toolName, args);
              
              messages.push({ role: 'tool', tool_name: toolName, content: result });
              
              // Save tool result to history
              this.history.push({
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString(),
                toolUsage: {
                  tool: toolName,
                  args: args,
                  result: result,
                  type: 'result'
                }
              });
              
              // Apply memory limit
              this.applyMemoryLimit();
              
              // Save to storage
              if (this.dataManager) {
                this.dataManager.saveAgent(this);
              }
              
              this.io.emit('agent-tool-usage', {
                agentId: this.id,
                toolUsage: {
                  tool: toolName,
                  args: args,
                  result: result
                }
              });
              
              this.io.emit('agent-tool-result', {
                agentId: this.id,
                toolUsage: {
                  tool: toolName,
                  args: args,
                  result: result,
                  timestamp: new Date().toISOString()
                }
              });
            } catch (error) {
              console.error(`Tool execution error for ${call.function.name}:`, error);
              const errorMessage = `Tool execution error: ${error.message}`;
              messages.push({ role: 'tool', tool_name: call.function.name, content: errorMessage });
              
              // Save tool error to history
              this.history.push({
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString(),
                toolUsage: {
                  tool: call.function.name,
                  args: call.function.arguments,
                  error: errorMessage,
                  type: 'error'
                }
              });
              
              // Apply memory limit
              this.applyMemoryLimit();
              
              // Save to storage
              if (this.dataManager) {
                this.dataManager.saveAgent(this);
              }
              
              this.io.emit('agent-tool-usage', {
                agentId: this.id,
                toolUsage: {
                  tool: call.function.name,
                  args: call.function.arguments,
                  error: errorMessage
                }
              });
            }
          }
        } catch (streamError) {
          console.error(`Stream error for model ${this.ollamaModel}:`, streamError);
          
          // If the error is about thinking not being supported, disable thinking and retry
          if (streamError.message && (streamError.message.includes('thinking') || streamError.message.includes('does not support'))) {
            console.log(`Model ${this.ollamaModel} does not support thinking, disabling and retrying...`);
            supportsThinking = false;
            continue; // Retry with thinking disabled
          }
          
          // For other errors, break the loop
          throw streamError;
        }
      }

      this.status = 'taskCompleted';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'taskCompleted'
      });

      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      this.completeCurrentQueueItem();

      // Reset status to ready for queue processing
      this.status = 'ready';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'ready'
      });

      // Process next in queue
      this.processNextInQueue();

    } catch (error) {
      console.error(`Agent ${this.id} Ollama execution error:`, error);
      this.status = 'ready';
      this.io.emit('agent-error', {
        agentId: this.id,
        error: error.message || 'Ollama execution failed'
      });
      this.completeCurrentQueueItem();
      this.processNextInQueue();
    }
  }

  _updateModelSession(model) {
    // Update Ollama detection
    this.useOllama = this.model.startsWith('ollama:') || this.model.startsWith('qwen') || this.model.startsWith('llama') || this.model.startsWith('mistral');
    this.ollamaModel = this.model.startsWith('ollama:') ? this.model.replace('ollama:', '') : this.model;
  }

  // ===== QUEUE READY CHECK FOR OLLAMA =====
  isReadyForQueue() {
    this.normalizeAgentStatus();
    const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing' || item.status === 'connection_lost');

    // For Ollama: No live session check, normal queue processing
    const isReady = this.status === 'ready' && !hasProcessingItem;
    console.log(`OllamaAgent ${this.id} isReadyForQueue: ${isReady}, status: ${this.status}, hasProcessingItem: ${hasProcessingItem}`);
    return isReady;
  }

  _checkIfTaskAlreadyCompleted(content) {
    // Check if there is a similar task with this content in history
    const recentHistory = this.history.slice(-1000); // Check last 1000 messages

    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'cron') {
        // Check content similarity
        if (msg.content && content) {
          const normalizedMsgContent = msg.content.toLowerCase().trim();
          const normalizedContent = content.toLowerCase().trim();

          // Exact match or high similarity
          if (normalizedMsgContent === normalizedContent ||
              normalizedMsgContent.includes(normalizedContent) ||
              normalizedContent.includes(normalizedMsgContent)) {
            console.log(`OllamaAgent ${this.id} found similar completed task: ${msg.content}`);
            return true;
          }
        }
      }
    }

    return false;
  }

  _getToolDeclarations() {
    const tools = [];

    // Get tools from ToolManager (plugin tools included)
    if (this.toolManager) {
      // Get all tools from plugin manager
      const allTools = this.toolManager.pluginManager ? this.toolManager.pluginManager.getAllTools() : {};

      for (const [fullName, toolConfig] of Object.entries(allTools)) {
        if (toolConfig && toolConfig.description && toolConfig.parameters) {
          tools.push({
            type: 'function',
            function: {
              name: fullName, // Use fullName (plugin.toolName format)
              description: toolConfig.description || '',
              parameters: toolConfig.parameters || {
                type: 'object',
                properties: {},
                required: []
              }
            }
          });
        }
      }
    }

    return tools;
  }
}

module.exports = OllamaAgent;