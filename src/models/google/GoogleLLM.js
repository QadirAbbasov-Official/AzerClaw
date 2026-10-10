const { GoogleGenAI } = require('@google/genai');
const Agent = require('../../agents/Agent');

class GoogleLLMAgent extends Agent {
  constructor(id, name, prompt, io, apiKey, dataManager = null, cronManager = null, agentManager = null, model = 'gemini-3.8-flash') {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);
    this.apiKey = apiKey;
    this.client = null;
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
    
    // Initialize client
    this._initializeClient();
  }

  _initializeClient() {
    try {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
      console.log(`GoogleLLM Agent ${this.id} client initialized`);
    } catch (error) {
      console.error(`GoogleLLM Agent ${this.id} client initialization error:`, error);
      this.client = null;
    }
  }

  resetRuntime() {
    const previousStatus = this.status;
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
    this._initializeClient();
    this.status = previousStatus;
  }

  _buildSystemInstruction() {
    let instruction = `${this.prompt || ''}${this.getAdminProfileContext()}`;

    // Add conversation history (last 1000 messages)
    if (this.history && this.history.length > 0) {
      const recentHistory = this.history.slice(-1000);
      instruction += '\n\nPrevious conversation history:\n';
      recentHistory.forEach(msg => {
        if (msg.toolUsage) {
          // Display tool usage messages in more appropriate format
          if (msg.toolUsage.type === 'usage') {
            instruction += `${msg.role}: Tool call (${msg.toolUsage.tool})\n`;
          } else if (msg.toolUsage.type === 'result') {
            instruction += `${msg.role}: Tool result (${msg.toolUsage.tool}): ${JSON.stringify(msg.toolUsage.result)}\n`;
          } else if (msg.toolUsage.type === 'error') {
            instruction += `${msg.role}: Tool error (${msg.toolUsage.tool}): ${msg.toolUsage.error}\n`;
          }
        } else {
          instruction += `${msg.role}: ${msg.content}\n`;
        }
      });
    }

    return instruction;
  }

  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    this._initializeClient();
    console.log(`GoogleLLM Agent ${this.id} API key updated`);
  }

  async start() {
    await super.start();
    if (!this.client) {
      this._initializeClient();
    }
  }

  stop() {
    super.stop();
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
  }

  _createToolDefinition(toolName, toolConfig) {
    return {
      type: "function",
      name: toolName,
      description: toolConfig.description || toolName,
      parameters: {
        type: "object",
        properties: toolConfig.parameters || {},
        required: toolConfig.required || []
      }
    };
  }

  _convertToolsToGoogleFormat(tools) {
    const googleTools = [];
    
    console.log(`GoogleLLM Agent ${this.id} converting ${tools.length} tools to Google format`);
    console.log(`Available tools:`, tools);
    console.log(`Available plugins:`, Array.from(this.toolManager.pluginManager.plugins.keys()));
    
    // If tools is null or undefined, return empty array
    if (!tools || tools.length === 0) {
      console.log(`No tools to convert, returning empty array`);
      return [];
    }
    
    tools.forEach(toolName => {
      console.log(`Processing tool: ${toolName}`);
      
      // If tool is in plugin.tool format
      if (toolName && toolName.includes('.')) {
        const [pluginName, actualToolName] = toolName.split('.');
        console.log(`  Tool is in plugin.tool format: ${pluginName}.${actualToolName}`);
        
        const plugin = this.toolManager.pluginManager.plugins.get(pluginName);
        if (plugin && plugin.tools[actualToolName]) {
          const tool = plugin.tools[actualToolName];
          console.log(`  Found tool in plugin:`, tool);
          
          // Plugin tool structures are already in correct format
          const googleTool = {
            type: "function",
            name: toolName,
            description: tool.description || toolName,
            parameters: {
              type: "object",
              properties: tool.parameters?.properties || {},
              required: tool.parameters?.required || []
            }
          };
          googleTools.push(googleTool);
          console.log(`  Added Google tool:`, googleTool);
        } else {
          console.log(`  Tool not found in plugin ${pluginName}`);
        }
      } else if (toolName) {
        // Simple tool name - search in plugins
        console.log(`  Tool is simple name, searching in plugins...`);
        let found = false;
        for (const [pluginName, plugin] of this.toolManager.pluginManager.plugins.entries()) {
          if (plugin.tools[toolName]) {
            const tool = plugin.tools[toolName];
            console.log(`  Found tool in plugin ${pluginName}:`, tool);
            
            // For Google, we use tool name in plugin.tool format
            const fullToolName = `${pluginName}.${toolName}`;
            const googleTool = {
              type: "function",
              name: fullToolName, // Use in plugin.tool format
              description: tool.description || toolName,
              parameters: {
                type: "object",
                properties: tool.parameters?.properties || {},
                required: tool.parameters?.required || []
              }
            };
            googleTools.push(googleTool);
            console.log(`  Added Google tool with full name: ${fullToolName}`, googleTool);
            found = true;
            break;
          }
        }
        
        // If not found, create basic definition
        if (!found) {
          console.log(`  Tool not found in any plugin, creating basic definition`);
          googleTools.push({
            type: "function",
            name: toolName,
            description: toolName,
            parameters: {
              type: "object",
              properties: {},
              required: []
            }
          });
        }
      } else {
        console.log(`  Tool name is null or undefined, skipping`);
      }
    });
    
    console.log(`Final Google tools:`, googleTools);
    return googleTools;
  }

  async _executeModelMessage(content, options = {}) {
    if (!this.client) {
      console.error(`GoogleLLM Agent ${this.id} client not initialized`);
      this.completeCurrentQueueItem();
      return;
    }

    // Check for tasks coming from connection
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem && processingItem.reconnectionAttempt > 0) {
      console.log(`GoogleLLM Agent ${this.id} processing reconnection task (attempt #${processingItem.reconnectionAttempt})`);

      // Check if task was already completed
      // Check if there is a similar task in history
      const isAlreadyCompleted = this._checkIfTaskAlreadyCompleted(processingItem.originalContent || processingItem.content);

      if (isAlreadyCompleted) {
        console.log(`GoogleLLM Agent ${this.id} task was already completed, skipping reconnection task`);
        // Mark task as completed and skip
        this.completeCurrentQueueItem();
        return;
      }
    }

    this.isProcessing = true;
    this.status = 'taskWorking';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'taskWorking'
    });

    try {
      // Initialize streaming buffer for new response
      this.currentResponseBuffer = '';
      this.isStreamingResponse = true;
      this.currentResponseStartTime = new Date().toISOString();

      // Convert enabled tools to Google format
      // If enabledTools is null, get all tools
      const toolsToConvert = this.toolManager.getEnabledTools();
      console.log(`GoogleLLM Agent ${this.id} enabledTools:`, this.enabledTools);
      console.log(`GoogleLLM Agent ${this.id} toolsToConvert:`, toolsToConvert);

      const googleTools = this._convertToolsToGoogleFormat(toolsToConvert);

      // Build system instruction with history
      const systemInstruction = this._buildSystemInstruction();

      // Create input with system instruction (in GoogleLLM format)
      let inputContent = content;
      if (systemInstruction && systemInstruction !== this.prompt) {
        // Add only if system instruction is different
        inputContent = `${systemInstruction}\n\nUser: ${content}`;
      }

      // Create initial interaction with streaming
      const stream = await this.client.interactions.create({
        model: this.model,
        tools: googleTools.length > 0 ? googleTools : undefined,
        input: inputContent,
        stream: true,
      });

      let fullResponse = '';
      let firstInteractionId = null;
      let funcCallId = null;
      let funcCallName = null;
      let funcArgsAccumulated = '';
      let functionCall = null;

      // Process first interaction
      for await (const event of stream) {
        if (event.event_type === "interaction.created") {
          firstInteractionId = event.interaction.id;
          this.currentInteractionId = firstInteractionId;
        } else if (event.event_type === "step.start") {
          const step = event.step;
          if (step.type === "function_call") {
            funcCallId = step.id;
            funcCallName = step.name;
            this.currentStepId = funcCallId;
            this.currentFunctionName = funcCallName;
          }
        } else if (event.event_type === "step.delta") {
          if (event.delta.type === "arguments_delta") {
            funcArgsAccumulated += event.delta.arguments;
            this.accumulatedArgs = funcArgsAccumulated;
          } else if (event.delta.type === "text") {
            fullResponse += event.delta.text;
            
            // Add chunk to streaming buffer
            this.currentResponseBuffer += event.delta.text;
            
            // Stream text to client for real-time display (in GoogleAgent.js format)
            this.io.emit('agent-stream', {
              agentId: this.id,
              chunk: event.delta.text,
              timestamp: this.currentResponseStartTime
            });
            
            // Save to storage after each chunk
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
          }
        }
      }

      // If function call was made, execute it and continue
      if (funcCallId && firstInteractionId && funcCallName) {
        console.log(`GoogleLLM Agent ${this.id} executing function: ${funcCallName}`);
        
        // Save tool usage to history (in GoogleLive format)
        const toolUsageMessage = {
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
          toolUsage: {
            tool: funcCallName,
            args: funcArgsAccumulated,
            type: 'usage'
          }
        };
        this.history.push(toolUsageMessage);
        
        // Sort history to maintain correct order
        this.sortHistoryByTimestamp();
        
        // Apply memory limit
        this.applyMemoryLimit();
        
        // Save to storage after tool usage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }
        
        this.io.emit('agent-tool-usage', {
          agentId: this.id,
          toolUsage: {
            tool: funcCallName,
            args: funcArgsAccumulated,
            timestamp: new Date().toISOString()
          }
        });

        try {
          // Parse arguments
          let parsedArgs = {};
          try {
            // If funcArgsAccumulated is empty, use empty object
            if (funcArgsAccumulated && funcArgsAccumulated.trim()) {
              parsedArgs = JSON.parse(funcArgsAccumulated);
            } else {
              parsedArgs = {};
            }
          } catch (e) {
            // Use empty object in case of parse error
            parsedArgs = {};
          }

          console.log(`GoogleLLM Agent ${this.id} executing tool: ${funcCallName} with args:`, parsedArgs);

          // Auto-add senderAgentId for sendMessageToAgent (in GoogleLive format)
          if ((funcCallName === 'sendMessageToAgent' || funcCallName === 'agent.sendMessageToAgent') && !parsedArgs.senderAgentId) {
            parsedArgs = { ...parsedArgs, senderAgentId: this.id };
            console.log(`Auto-added senderAgentId: ${this.id} for sendMessageToAgent`);
          }

          // Execute tool - handle both plugin.tool and simple tool names
          let toolResult;
          try {
            // Tool name from GoogleLLM might be in plugin.tool format
            // So first try to find simple tool name
            let toolToExecute = funcCallName;
            
            // If funcCallName is in plugin.tool format, ToolManager's executeTool function already handles this
            // But in some cases simple name might be needed
            if (funcCallName.includes('.')) {
              console.log(`Tool name is in plugin.tool format, trying direct execution`);
            } else {
              console.log(`Tool name is simple format, searching for full name`);
              // Convert simple name to full name
              const allTools = this.toolManager.pluginManager.getAllTools();
              for (const [fullName, toolConfig] of Object.entries(allTools)) {
                if (fullName.endsWith(`.${funcCallName}`)) {
                  toolToExecute = fullName;
                  console.log(`Found full tool name: ${fullName}`);
                  break;
                }
              }
            }
            
            console.log(`Executing tool: ${toolToExecute}`);
            toolResult = await this.toolManager.executeTool(toolToExecute, parsedArgs, this);
            console.log(`Tool execution result:`, toolResult);
            
            // Save tool result to history (in GoogleLive format)
            const toolResultMessage = {
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              toolUsage: {
                tool: funcCallName,
                args: parsedArgs,
                result: toolResult,
                type: 'result'
              }
            };
            this.history.push(toolResultMessage);
            
            // Sort history to maintain correct order
            this.sortHistoryByTimestamp();
            
            // Apply memory limit
            this.applyMemoryLimit();
            
            // Save to storage after tool execution
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
            
          } catch (toolError) {
            console.error(`GoogleLLM Agent ${this.id} tool execution error:`, toolError);
            
            // Save tool error to history (in GoogleLive format)
            const toolErrorMessage = {
              role: 'assistant',
              content: '',
              timestamp: new Date().toISOString(),
              toolUsage: {
                tool: funcCallName,
                args: parsedArgs,
                error: toolError.message,
                type: 'error'
              }
            };
            this.history.push(toolErrorMessage);
            
            // Sort history to maintain correct order
            this.sortHistoryByTimestamp();
            
            // Apply memory limit
            this.applyMemoryLimit();
            
            // Save to storage after tool error
            if (this.dataManager) {
              this.dataManager.saveAgent(this);
            }
            
            throw toolError;
          }
          
          this.io.emit('agent-tool-result', {
            agentId: this.id,
            toolUsage: {
              tool: funcCallName,
              result: toolResult,
              timestamp: new Date().toISOString()
            }
          });

          // Send result back to continue the conversation
          const dummyResult = {
            content: [{ 
              type: "text", 
              text: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
            }]
          };

          const stream2 = await this.client.interactions.create({
            model: this.model,
            previous_interaction_id: firstInteractionId,
            input: [{
              type: "function_result",
              name: funcCallName,
              call_id: funcCallId,
              result: dummyResult
            }],
            stream: true,
          });

          // Process second interaction
          for await (const event of stream2) {
            if (event.event_type === "step.delta") {
              if (event.delta.type === "text") {
                fullResponse += event.delta.text;
                
                // Add chunk to streaming buffer
                this.currentResponseBuffer += event.delta.text;
                
                // Stream text to client for real-time display (in GoogleAgent.js format)
                this.io.emit('agent-stream', {
                  agentId: this.id,
                  chunk: event.delta.text,
                  timestamp: this.currentResponseStartTime
                });
                
                // Save to storage after each chunk
                if (this.dataManager) {
                  this.dataManager.saveAgent(this);
                }
              }
            }
          }
        } catch (toolError) {
          console.error(`GoogleLLM Agent ${this.id} tool execution error:`, toolError);
          
          // Send error result back
          const errorResult = {
            content: [{ 
              type: "text", 
              text: JSON.stringify({ error: toolError.message })
            }]
          };

          try {
            const stream2 = await this.client.interactions.create({
              model: this.model,
              previous_interaction_id: firstInteractionId,
              input: [{
                type: "function_result",
                name: funcCallName,
                call_id: funcCallId,
                result: errorResult
              }],
              stream: true,
            });

            for await (const event of stream2) {
              if (event.event_type === "step.delta") {
                if (event.delta.type === "text") {
                  fullResponse += event.delta.text;
                  
                  // Add chunk to streaming buffer
                  this.currentResponseBuffer += event.delta.text;
                  
                  // Stream text to client for real-time display (in GoogleAgent.js format)
                  this.io.emit('agent-stream', {
                    agentId: this.id,
                    chunk: event.delta.text,
                    timestamp: this.currentResponseStartTime
                  });
                  
                  // Save to storage after each chunk
                  if (this.dataManager) {
                    this.dataManager.saveAgent(this);
                  }
                }
              }
            }
          } catch (retryError) {
            console.error(`GoogleLLM Agent ${this.id} retry error:`, retryError);
          }
        }
      }

      // Add assistant response to history (in GoogleLive format - piece by piece)
      if (fullResponse) {
        // First check if last message has tool usage
        const lastMessage = this.history[this.history.length - 1];
        const isLastToolMessage = lastMessage && lastMessage.toolUsage;
        
        if (isLastToolMessage) {
          // If last message is tool usage, add new assistant message
          this.history.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString()
          });
        } else if (lastMessage && lastMessage.role === 'assistant') {
          // Update existing assistant message (streaming)
          lastMessage.content = fullResponse;
          lastMessage.timestamp = new Date().toISOString();
        } else {
          // Add new assistant message
          this.history.push({
            role: 'assistant',
            content: fullResponse,
            timestamp: new Date().toISOString()
          });
        }

        // Sort history by timestamp to ensure correct order
        this.sortHistoryByTimestamp();

        // Reset streaming buffer
        this.isStreamingResponse = false;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = null;

        // Final save to storage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }
        
        // agent-message sending - only use agent-stream
        // Frontend already processes and combines stream events
      }

    } catch (error) {
      console.error(`GoogleLLM Agent ${this.id} execution error:`, error);
      this.io.emit('agent-error', {
        agentId: this.id,
        error: error.message
      });
    } finally {
      this.isProcessing = false;
      this.status = 'ready';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'ready'
      });
      
      this.currentInteractionId = null;
      this.currentStepId = null;
      this.currentFunctionName = null;
      this.accumulatedArgs = '';
      
      this.completeCurrentQueueItem();
    }
  }

  _stopModelSession() {
    // GoogleLLM doesn't have persistent sessions like Live API
    // Just reset the state
    this.currentInteractionId = null;
    this.currentStepId = null;
    this.currentFunctionName = null;
    this.accumulatedArgs = '';
    this.isProcessing = false;
  }

  _updateModelSession(model) {
    // Model update handling
    this.model = model;
    console.log(`GoogleLLM Agent ${this.id} model updated to: ${model}`);
  }

  // ===== QUEUE READY CHECK FOR GOOGLELLM =====
  isReadyForQueue() {
    this.normalizeAgentStatus();
    const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing' || item.status === 'connection_lost');

    // For GoogleLLM: No live session check, normal queue processing
    return this.status === 'ready' && !hasProcessingItem;
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
            console.log(`GoogleLLM Agent ${this.id} found similar completed task: ${msg.content}`);
            return true;
          }
        }
      }
    }

    return false;
  }
}

module.exports = GoogleLLMAgent;
