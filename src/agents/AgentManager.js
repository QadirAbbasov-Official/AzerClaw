const GoogleLiveAgent = require('../models/google/GoogleLive');
const GoogleLLMAgent = require('../models/google/GoogleLLM');
const OllamaAgent = require('../models/ollama/OllamaAgent');
const DataManager = require('../storage/DataManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const lang = require('../config/lang');

class AgentManager {
  constructor(io, apiKey, cronManager = null) {
    this.agents = new Map();
    this.io = io;
    this.apiKey = apiKey;
    this.dataManager = new DataManager('./data', this);
    this.cronManager = cronManager;
    // Start async loading without blocking constructor
    this.loadAgentsFromStorage().catch(error => {
      console.error('Error loading agents from storage:', error);
    });
    
    // Log API key status
    if (!this.apiKey) {
      console.warn('AgentManager initialized without API key - Google models will not work');
    } else {
      console.log('AgentManager initialized with API key');
    }
  }

  /**
   * Update API key
   */
  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log('AgentManager API key updated:', newApiKey ? '***SET***' : '***EMPTY***');
    
    // Update API keys for all Google agents
    this.agents.forEach((agent, id) => {
      if (agent instanceof GoogleLiveAgent || agent instanceof GoogleLLMAgent) {
        agent.updateApiKey(newApiKey);
        console.log(`Agent ${id} API key updated`);
      }
    });
  }

  _getModelProvider(model) {
    // Get provider information from ModelManager
    if (global.modelManager) {
      const allModels = global.modelManager.getAllModels();
      const modelInfo = allModels.find(m => m.id === model);
      if (modelInfo) {
        return modelInfo.provider;
      }
    }
    
    // Fallback: Simple check if ModelManager is not available
    // Only accept explicitly ollama: prefixed as ollama
    if (model.startsWith('ollama:')) {
      return 'ollama';
    }
    
    // Determine sub-provider for Google models
    // Live API models usually end with "-live-preview"
    // LLM models use different naming
    if (model.includes('gemini')) {
      // Google models - default to google provider
      return 'google';
    }
    
    // Default to google in other cases
    return 'google';
  }

  /**
   * Get all available models from ModelManager
   */
  getAllAvailableModels() {
    if (global.modelManager) {
      return global.modelManager.getAllModels();
    }
    return [];
  }

  /**
   * Get models for a specific provider
   */
  getProviderModels(providerId) {
    if (global.modelManager) {
      return global.modelManager.getProviderModels(providerId);
    }
    return [];
  }

  /**
   * Get all providers
   */
  getAllProviders() {
    if (global.modelManager) {
      return global.modelManager.getAllProviders();
    }
    return {};
  }

  createAgent(name, prompt, useLiveAPI = true, model = 'qwen3:0.6b', provider = null) {
    const id = crypto.randomUUID();

    // If provider is not specified, detect provider from model ID
    let detectedProvider = provider;
    if (!detectedProvider) {
      detectedProvider = this._getModelProvider(model);
    }

    let agent;
    if (detectedProvider === 'ollama') {
      agent = new OllamaAgent(id, name, prompt, this.io, this.dataManager, this.cronManager, this, model);
    } else {
      // Determine model type for Google provider
      // Live API models usually end with "-live-preview"
      // LLM models use different naming
      const isLiveModel = model.includes('-live-preview') || model.includes('-live');

      if (isLiveModel) {
        agent = new GoogleLiveAgent(id, name, prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, model);
      } else {
        agent = new GoogleLLMAgent(id, name, prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, model);
      }
    }

    // Save provider information to agent
    agent.provider = detectedProvider;

    // Initialize queue system for all agents (already done in constructors)
    if (!agent.messageQueue) {
      agent.messageQueue = [];
    }

    agent.createdAt = new Date().toISOString();
    this.agents.set(id, agent);

    this.dataManager.saveAgent(agent);

    this.io.emit('agent-created', {
      agent: agent.toJSON()
    });

    return agent;
  }

  deleteAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.stop();
      this.agents.delete(id);
      
      // Delete using agent name instead of ID
      this.dataManager.deleteAgent(agent.name);
      
      this.io.emit('agent-deleted', {
        agentId: id
      });
      
      return true;
    }
    return false;
  }

  getAgent(id) {
    return this.agents.get(id);
  }

  getAllAgents() {
    return Array.from(this.agents.values()).map(agent => agent.toJSON());
  }

  startAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'ready';
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-status', {
        agentId: id,
        status: 'ready'
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  stopAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'stopped';
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-status', {
        agentId: id,
        status: 'stopped'
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  updateAgent(id, { name, prompt, model, provider, voice }) {
    const agent = this.agents.get(id);
    if (agent) {
      const currentModel = agent.model;
      const currentProvider = this._getModelProvider(currentModel);
      const currentIsOllama = currentProvider === 'ollama';
      
      // Determine new provider and model type
      let newProvider = provider;
      let newModel = model;
      
      // If provider is specified but model is not, get default model for that provider
      if (newProvider && !newModel && global.modelManager) {
        const defaultModel = global.modelManager.getDefaultModel(newProvider);
        if (defaultModel) {
          newModel = defaultModel.id;
        }
      }
      
      // If model is specified but provider is not, detect provider from model
      if (newModel && !newProvider) {
        newProvider = this._getModelProvider(newModel);
      }
      
      // Fall back to current provider if still no provider
      if (!newProvider) {
        newProvider = currentProvider;
      }
      
      const newIsOllama = newProvider === 'ollama';
      
      // Determine current and new Google model types
      const currentIsLiveModel = currentModel.includes('-live-preview') || currentModel.includes('-live');
      const newIsLiveModel = newModel.includes('-live-preview') || newModel.includes('-live');
      
      // If model type changed (Ollama ↔ Google or Google Live ↔ Google LLM), recreate the agent
      if (currentIsOllama !== newIsOllama || (!currentIsOllama && !newIsOllama && currentIsLiveModel !== newIsLiveModel)) {
        console.log(`Model type changed for agent ${id}, recreating agent`);
        
        // Stop the old agent
        agent.stop();
        this.agents.delete(id);
        
        // Create new agent with correct type
        let newAgent;
        if (newIsOllama) {
          newAgent = new OllamaAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.dataManager, this.cronManager, this, newModel || currentModel);
        } else {
          // Determine model type for Google provider
          if (newIsLiveModel) {
            newAgent = new GoogleLiveAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, newModel || currentModel);
          } else {
            newAgent = new GoogleLLMAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, newModel || currentModel);
          }
        }
        
        // Copy properties from old agent
        newAgent.createdAt = agent.createdAt;
        newAgent.history = agent.history;
        newAgent.session = agent.session;
        newAgent.enabledTools = agent.enabledTools;
        newAgent.memoryLimit = agent.memoryLimit;
        newAgent.provider = newProvider;
        newAgent.voice = agent.voice || 'Puck'; // Copy voice setting
        
        this.agents.set(id, newAgent);
        
        if (this.dataManager) {
          this.dataManager.saveAgent(newAgent);
        }
        
        this.io.emit('agent-updated', {
          agent: newAgent.toJSON()
        });
        this.broadcastStatus();
        return true;
      }
      
      // Otherwise, just update properties
      if (name) agent.name = name;
      if (prompt) agent.prompt = prompt;
      if (newModel) agent.updateModel(newModel);
      if (newProvider) agent.provider = newProvider;
      if (voice) agent.updateVoice(voice);
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-updated', {
        agent: agent.toJSON()
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  async restartAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      // Restart the agent by stopping and starting it
      // This works for both GoogleAgent and OllamaAgent
      await agent.stop();
      await agent.start();
      return true;
    }
    return false;
  }

  updateAgentVoice(id, voice) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.updateVoice(voice);
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-updated', {
        agent: agent.toJSON()
      });
      return true;
    }
    return false;
  }

  sendMessageToAgent(id, content, senderAgentId = null) {
    const agent = this.agents.get(id);
    if (!agent || agent.status === 'stopped') {
      return false;
    }

    if (senderAgentId) {
      const senderAgent = this.agents.get(senderAgentId);
      const finalMessage = senderAgent
        ? `[${senderAgent.name} (ID: ${senderAgentId})'dan mesaj]: ${content}`
        : content;
      agent.receiveMessage(finalMessage, {
        label: senderAgent
          ? `${senderAgent.name}: ${content.substring(0, 50)}`
          : content.substring(0, 60),
        source: 'agent',
        senderAgentId: senderAgentId,
        senderAgentName: senderAgent ? senderAgent.name : null,
        originalMessage: content
      });
    } else {
      agent.sendMessage(content);
    }

    return true;
  }

  getAgentQueue(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.getQueue();
    }
    return null;
  }

  removeQueueItem(agentId, itemId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.removeQueueItem(itemId);
    }
    return { success: false, message: 'Agent not found.' };
  }

  stopQueueItem(agentId, itemId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.stopCurrentQueueItem();
    }
    return { success: false, message: 'Agent not found.' };
  }

  updateQueueItem(agentId, itemId, updates) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.updateQueueItem(itemId, updates);
    }
    return { success: false, message: 'Agent not found.' };
  }

  clearAgentQueue(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.clearQueue();
    }
    return { success: false, message: 'Agent not found.' };
  }

  getAgentHistory(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.getHistory();
    }
    return null;
  }

  clearAgentHistory(id) {
    const agent = this.agents.get(id);
    if (agent) {
      const result = agent.clearHistory();
      return result;
    }
    return { success: false, message: 'Agent not found' };
  }

  getAgentStatus(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.toJSON();
    }
    return null;
  }

  broadcastStatus() {
    const agents = this.getAllAgents();
    this.io.emit('agents-status', {
      agents: agents
    });
  }

  async loadAgentsFromStorage() {
    try {
      const agentsData = this.dataManager.loadAgents();

      for (const agentData of agentsData) {
        const model = agentData.model || 'qwen3:0.6b';
        const provider = agentData.provider || this._getModelProvider(model);

        let agent;
        if (provider === 'ollama') {
          agent = new OllamaAgent(
            agentData.id,
            agentData.name,
            agentData.prompt,
            this.io,
            this.dataManager,
            this.cronManager,
            this,
            model
          );
        } else {
          // Determine model type for Google provider
          const isLiveModel = model.includes('-live-preview') || model.includes('-live');

          if (isLiveModel) {
            agent = new GoogleLiveAgent(
              agentData.id,
              agentData.name,
              agentData.prompt,
              this.io,
              this.apiKey,
              this.dataManager,
              this.cronManager,
              this,
              model
            );
          } else {
            agent = new GoogleLLMAgent(
              agentData.id,
              agentData.name,
              agentData.prompt,
              this.io,
              this.apiKey,
              this.dataManager,
              this.cronManager,
              this,
              model
            );
          }
        }

        agent.createdAt = agentData.createdAt;
        agent.history = agentData.history || [];
        agent.session = agentData.session || [];
        agent.messageQueue = agentData.messageQueue || []; // Load queue tasks

        // Convert processing queue items to waiting and add reconnection format
        const processingItems = agent.messageQueue.filter(item => item.status === 'processing');
        if (processingItems.length > 0) {
          console.log(`Agent ${agent.id} found ${processingItems.length} processing items, converting to waiting with reconnection format`);

          processingItems.forEach(item => {
            // Save original content
            if (!item.originalContent) {
              item.originalContent = item.content;
            }

            // Add reconnection format
            const langInstance = lang.getLang();
            item.content = `${langInstance.t('reconnectionMessage')} ${item.originalContent}`;
            item.status = 'waiting';
            item.reconnectionAttempt = (item.reconnectionAttempt || 0) + 1;
            item.reconnectedAt = new Date().toISOString();

            console.log(`Agent ${agent.id} queue item ${item.id} converted to waiting (attempt #${item.reconnectionAttempt})`);
          });

          // Save cleaned queue
          this.dataManager.saveAgent(agent);
        }

        // Clean up completed/stopped queue items on load
        const originalQueueLength = agent.messageQueue.length;
        agent.messageQueue = agent.messageQueue.filter(item => item.status !== 'completed' && item.status !== 'stopped');
        const cleanedQueueLength = agent.messageQueue.length;

        if (originalQueueLength !== cleanedQueueLength) {
          console.log(`Agent ${agent.id} cleaned queue: ${originalQueueLength} -> ${cleanedQueueLength} items (removed ${originalQueueLength - cleanedQueueLength} items)`);
          // Save the cleaned queue to storage
          this.dataManager.saveAgent(agent);
        }

        agent.status = 'ready';
        agent.voice = agentData.voice || 'Puck'; // Load voice setting, default to 'Puck'
        agent.isTrueLiveMode = agentData.isTrueLiveMode || false; // Load true live mode status

        // Don't set isLiveSessionActive initially - we'll restore it if needed
        // This prevents the "already active" check from blocking restoration
        const wasLiveSessionActive = agentData.isLiveSessionActive || false;
        agent.isLiveSessionActive = false; // Reset to false initially

        // If true live mode was active on save, restore it
        if (agentData.isTrueLiveMode && agent.setTrueLiveMode) {
          agent.setTrueLiveMode(true);
          console.log(`Agent ${agent.id} True Live mode restored to active`);

          // If True Live mode is active, also start live session
          if (agent.startTrueLiveSession && !agent.isLiveSessionActive) {
            console.log(`Agent ${agent.id} True Live mode is active, starting live session automatically`);

            // First reload tools synchronously
            if (agent.toolManager) {
              console.log(`Agent ${agent.id} reloading tools before session start`);
              await agent.toolManager.reloadTools();
              console.log(`Agent ${agent.id} tools reloaded, now starting session`);
            }

            // Start the session (without socket for backend restoration)
            agent.startTrueLiveSession(null).then(success => {
              if (success) {
                console.log(`Agent ${this.id} live session started successfully for True Live mode`);
              } else {
                console.log(`Agent ${this.id} live session start failed for True Live mode`);
              }
            }).catch(error => {
              console.log(`Agent ${this.id} live session start error for True Live mode:`, error.message);
            });
          }
        }

        // If live session was active on save, try to restore it (separate from True Live mode)
        if (wasLiveSessionActive && agent.startTrueLiveSession && !agent.isLiveSessionActive) {
          console.log(`Agent ${agent.id} had active live session on save, attempting to restore`);

          // First reload tools synchronously
          if (agent.toolManager) {
            console.log(`Agent ${agent.id} reloading tools before session restoration`);
            await agent.toolManager.reloadTools();
            console.log(`Agent ${agent.id} tools reloaded, now restoring session`);
          }

          // Then restore the session (without socket for backend restoration)
          agent.startTrueLiveSession(null).then(success => {
            if (success) {
              console.log(`Agent ${this.id} live session restored successfully`);
            } else {
              console.log(`Agent ${this.id} live session restoration failed, user will need to restart`);
            }
          }).catch(error => {
            console.log(`Agent ${this.id} live session restoration error:`, error.message);
          });
        }

        // Add default tools for GoogleLLM
        if (agent instanceof GoogleLLMAgent) {
          const defaultTools = ['datetime.getCurrentTime', 'datetime.getCurrentDate'];
          const storedTools = agentData.enabledTools || agent.toolManager.getAvailableTools();

          // Add DateTime tools if not present
          defaultTools.forEach(tool => {
            if (!storedTools.includes(tool)) {
              storedTools.push(tool);
            }
          });

          agent.enabledTools = storedTools;
        } else {
          agent.enabledTools = agentData.enabledTools || agent.toolManager.getAvailableTools();
        }

        agent.memoryLimit = agentData.memoryLimit || 1000;

        this.agents.set(agent.id, agent);

        // Start queue processing for GoogleLLM and Ollama (after load)
        const isLLMAgent = agent instanceof GoogleLLMAgent;
        const isOllamaAgent = agent.provider === 'ollama';
        const isLiveAgent = agent instanceof GoogleLiveAgent;

        if ((isLLMAgent || isOllamaAgent) && agent.messageQueue && agent.messageQueue.length > 0) {
          const waitingItems = agent.messageQueue.filter(item => item.status === 'waiting');
          if (waitingItems.length > 0) {
            console.log(`${isLLMAgent ? 'GoogleLLM' : 'Ollama'} Agent ${agent.id} found ${waitingItems.length} waiting items in queue, starting queue processing`);
            // Start queue processing with delay so agent is fully stable
            setTimeout(() => {
              agent.processNextInQueue();
            }, 1000);
          }
        }

        // For GoogleLive: If queue has items and session is not active, auto-start
        if (isLiveAgent && agent.messageQueue && agent.messageQueue.length > 0) {
          const waitingItems = agent.messageQueue.filter(item => item.status === 'waiting');
          if (waitingItems.length > 0 && !agent.isLiveSessionActive) {
            console.log(`GoogleLive Agent ${agent.id} found ${waitingItems.length} waiting items in queue but no active session, starting live session automatically`);
            // Start live session
            setTimeout(() => {
              agent.startTrueLiveSession(null).then(success => {
                if (success) {
                  console.log(`GoogleLive Agent ${agent.id} live session started automatically for queue processing`);
                } else {
                  console.log(`GoogleLive Agent ${agent.id} failed to start live session for queue processing`);
                }
              }).catch(error => {
                console.log(`GoogleLive Agent ${agent.id} error starting live session for queue processing:`, error.message);
              });
            }, 1000);
          }
        }
      }
      console.log(`Loaded ${agentsData.length} agents from storage`);
    } catch (error) {
      console.error('Error loading agents from storage:', error);
    }
  }

  saveAllAgentsToStorage() {
    try {
      this.dataManager.saveAgents(Array.from(this.agents.values()));
    } catch (error) {
      console.error('Error saving agents to storage:', error);
    }
  }

  setCronManager(cronManager) {
    this.cronManager = cronManager;
    // Update all existing agents' toolManager with cronManager
    this.agents.forEach(agent => {
      agent.cronManager = cronManager;
      if (agent.toolManager) {
        if (typeof agent.toolManager.setCronManager === 'function') {
          agent.toolManager.setCronManager(cronManager);
        } else {
          agent.toolManager.cronManager = cronManager;
        }
        agent.toolManager.agentManager = this;
      }
    });
  }

  // Plugin Management Methods
  getAllPluginsInfo() {
    // Get plugins info from the first available agent's ToolManager
    const agent = this.agents.values().next().value;
    if (agent && agent.toolManager && agent.toolManager.pluginManager) {
      return agent.toolManager.pluginManager.getAllPluginsInfo();
    }
    
    // Fallback: create temporary ToolManager if no agent exists
    const ToolManager = require('../tools/ToolManager');
    const tempToolManager = new ToolManager(this.cronManager, null, this, this.io);
    return tempToolManager.pluginManager.getAllPluginsInfo();
  }

  getPluginInfo(pluginName) {
    const agent = this.agents.values().next().value;
    if (agent && agent.toolManager) {
      return agent.toolManager.getPluginInfo(pluginName);
    }
    return null;
  }

  async enablePlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.enablePlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  async disablePlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.disablePlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  async reloadPlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.reloadPlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  enableTool(agentId, toolName) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    if (!agent.enabledTools.includes(toolName)) {
      agent.enabledTools.push(toolName);
      agent.updateEnabledTools(agent.enabledTools);
      this.dataManager.saveAgent(agent);
      this.io.emit('agent-tools-updated', {
        agentId: agentId,
        enabledTools: agent.enabledTools
      });
    }
    return true;
  }

  disableTool(agentId, toolName) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    const index = agent.enabledTools.indexOf(toolName);
    if (index > -1) {
      agent.enabledTools.splice(index, 1);
      agent.updateEnabledTools(agent.enabledTools);
      this.dataManager.saveAgent(agent);
      this.io.emit('agent-tools-updated', {
        agentId: agentId,
        enabledTools: agent.enabledTools
      });
    }
    return true;
  }

  getEnabledTools(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }
    return agent.enabledTools;
  }

  getAvailableTools() {
    // Get all available tools from ToolManager
    // Create a temporary ToolManager to get all available tools
    const ToolManager = require('../tools/ToolManager');
    const tempToolManager = new ToolManager(this.cronManager, null, this, this.io);
    return tempToolManager.getAvailableTools();
  }

  // True Live Mode Methods
  setAgentTrueLiveMode(agentId, enabled) {
    const agent = this.agents.get(agentId);
    if (agent && agent.setTrueLiveMode) {
      agent.setTrueLiveMode(enabled);
      return true;
    }
    return false;
  }

  async startAgentTrueLiveSession(agentId, clientSocket) {
    const agent = this.agents.get(agentId);
    if (agent && agent.startTrueLiveSession) {
      return await agent.startTrueLiveSession(clientSocket);
    }
    return false;
  }

  stopAgentTrueLiveSession(agentId) {
    const agent = this.agents.get(agentId);
    if (agent && agent.stopTrueLiveSession) {
      agent.stopTrueLiveSession();
      return true;
    }
    return false;
  }

  handleAgentTrueLiveAudioInput(agentId, audioData) {
    const agent = this.agents.get(agentId);
    if (agent && agent.handleTrueLiveAudioInput) {
      agent.handleTrueLiveAudioInput(audioData);
      return true;
    }
    return false;
  }

  handleAgentTrueLiveTextInput(agentId, text) {
    const agent = this.agents.get(agentId);
    if (agent && agent.handleTrueLiveTextInput) {
      agent.handleTrueLiveTextInput(text);
      return true;
    }
    return false;
  }

  async cleanup(waitForCompletion = false) {
    console.log('AgentManager temizleniyor...');
    
    // First save agent data
    if (this.dataManager && this.agents.size > 0) {
      try {
        this.dataManager.saveAgents(Array.from(this.agents.values()));
        console.log(`${this.agents.size} agent verisi kaydedildi`);
      } catch (err) {
        console.error('Agent verileri kaydedilirken hata:', err);
      }
    }
    
    // If waitForCompletion is requested, wait for running agents to finish (infinite)
    if (waitForCompletion) {
      console.log('Waiting for running agents to finish (infinite wait)...');
      let stillWorking = true;
      
      while (stillWorking) {
        stillWorking = false;
        
        this.agents.forEach((agent, id) => {
          const isProcessing = agent.isProcessing || agent.status === 'Gorev_yapiyor';
          const hasQueue = agent.messageQueue.some(item => item.status !== 'completed');
          const hasLiveSession = agent.isLiveSessionActive;
          
          if (isProcessing || hasQueue || hasLiveSession) {
            stillWorking = true;
            console.log(`Agent ${id} (${agent.name}) still running (processing: ${isProcessing}, queue: ${hasQueue}, liveSession: ${hasLiveSession})`);
          }
        });
        
        if (stillWorking) {
          console.log('Agents still running, waiting 1 second...');
          // Wait 1 second (async)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log('All agents completed their tasks.');
    }
    
    // Stop all agents
    this.agents.forEach((agent, id) => {
      try {
        // Also stop true live session
        if (agent.stopTrueLiveSession) {
          agent.stopTrueLiveSession();
        }
        agent.stop();
      } catch (err) {
        console.error(`Error stopping agent ${id}:`, err);
      }
    });
    
    // Clear agents
    this.agents.clear();
    
    // Cleanup DataManager
    if (this.dataManager) {
      try {
        this.dataManager.cleanup();
      } catch (err) {
        console.error('Error cleaning up DataManager:', err);
      }
    }
    
    console.log('AgentManager successfully cleaned up');
  }
}

module.exports = AgentManager;