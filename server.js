const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getConfigManager } = require('./src/config/config');
const { getLang } = require('./src/config/lang');
const packageJson = require('./package.json');

// Initialize config manager
const configManager = getConfigManager();

// Initialize lang system
const lang = getLang();

// Load language setting from config
const savedLanguage = configManager.get('language') || 'tr';
lang.setLanguage(savedLanguage);

// System modules
const AgentManager = require('./src/agents/AgentManager');
const CronManager = require('./src/cron/CronManager');
const ModelManager = require('./src/models/ModelManager');
const UpdateManager = require('./src/system/UpdateManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/plugins', express.static(path.join(__dirname, 'plugins')));

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Initialize Agent Manager
const apiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
global.agentManager = new AgentManager(io, apiKey);

// Initialize Cron Manager
global.cronManager = new CronManager(io, global.agentManager);

// Set cronManager in agentManager after initialization
global.agentManager.setCronManager(global.cronManager);

// Initialize ModelManager
global.modelManager = new ModelManager();

// Initialize UpdateManager
global.updateManager = new UpdateManager(io, configManager);

// Store reference to main plugin manager for cleanup
let mainPluginManager = null;

// API Routes
app.get('/api/agents', (req, res) => {
  const agents = agentManager.getAllAgents();
  res.json({ agents });
});

app.post('/api/agents', (req, res) => {
  const { name, prompt, useLiveAPI, model, provider, enabledTools } = req.body;
  
  if (!name || !prompt) {
    return res.status(400).json({ error: 'Name and prompt are required' });
  }
  
  // Force useLiveAPI to true for live model usage
  const agent = agentManager.createAgent(name, prompt, true, model || 'qwen3:0.6b', provider);
  
  // Set enabled tools if provided
  if (enabledTools && Array.isArray(enabledTools)) {
    agent.enabledTools = enabledTools;
    if (agent.dataManager) {
      agent.dataManager.saveAgent(agent);
    }
  }
  
  res.json({ agent: agent.toJSON() });
});

// Version API Route
app.get('/api/version', (req, res) => {
  try {
    res.json({ 
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Language API Routes
app.get('/api/language', (req, res) => {
  try {
    res.json({ 
      currentLanguage: lang.getLanguage(),
      availableLanguages: lang.getAvailableLanguages()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/language', (req, res) => {
  try {
    const { language } = req.body;
    if (!language) {
      return res.status(400).json({ error: 'Language is required' });
    }
    
    lang.setLanguage(language);
    configManager.set('language', language);
    
    res.json({ 
      success: true,
      currentLanguage: lang.getLanguage(),
      availableLanguages: lang.getAvailableLanguages()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Config API Routes
app.get('/api/config', (req, res) => {
  try {
    const config = configManager.getAll();
    // Return config without actual API keys for security
    const maskedConfig = {
      ...config,
      apiKeys: {
        google: '',
        gemini: '',
        hasGoogleKey: !!config.apiKeys.google,
        hasGeminiKey: !!config.apiKeys.gemini
      }
    };
    res.json({ config: maskedConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/api-keys/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const apiKey = configManager.getApiKey(provider);
    if (apiKey) {
      res.json({ key: apiKey });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    configManager.update(newConfig);
    res.json({ success: true, config: configManager.getAll() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/api-keys', (req, res) => {
  try {
    const { provider, key } = req.body;
    if (!provider || !key) {
      return res.status(400).json({ error: 'Provider and key are required' });
    }
    configManager.setApiKey(provider, key);
    
    // If Google or Gemini API key is updated, update AgentManager
    if (provider === 'google' || provider === 'gemini') {
      const newApiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
      if (global.agentManager) {
        global.agentManager.updateApiKey(newApiKey);
      }
    }
    
    res.json({ success: true, message: `API key for ${provider} updated` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/config/api-keys/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    configManager.deleteApiKey(provider);
    
    // If Google or Gemini API key is deleted, update AgentManager
    if (provider === 'google' || provider === 'gemini') {
      const newApiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
      if (global.agentManager) {
        global.agentManager.updateApiKey(newApiKey);
      }
    }
    
    res.json({ success: true, message: `API key for ${provider} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config/server', (req, res) => {
  try {
    const { port, host } = req.body;
    if (port !== undefined) {
      configManager.setPort(port);
    }
    if (host !== undefined) {
      configManager.setHost(host);
    }
    res.json({ success: true, config: configManager.get('server') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dynamic server restart endpoint
app.post('/api/server/restart', async (req, res) => {
  try {
    const { port, host } = req.body;
    
    if (!port || !host) {
      return res.status(400).json({ error: 'Port and host are required' });
    }
    
    // Save new configuration
    configManager.setPort(port);
    configManager.setHost(host);
    
    console.log(`🔄 Server configuration changing: ${HOST}:${PORT} -> ${host}:${port}`);
    
    res.json({ 
      success: true, 
      message: 'Server configuration updated, restarting...',
      newConfig: { host, port },
      redirectUrl: `http://${host}:${port}`,
      estimatedTime: 10000 // 10 seconds estimated time
    });
    
    // Socket.IO event to monitor server status
    io.emit('server-restarting', { 
      message: 'Server restarting',
      newUrl: `http://${host}:${port}`,
      estimatedTime: 10000
    });
    
    // Close server immediately and restart
    console.log('🛑 Server shutting down...');
    
    // Close all socket connections
    io.close();
    
    // Force close server
    server.closeAllConnections();
    
    setTimeout(() => {
      server.close(() => {
        console.log('✅ Server closed');
        
        // Restart with new configuration
        server.listen(port, host, () => {
          console.log(`🚀 Server started with new configuration: http://${host}:${port}`);
          console.log('✅ Server ready, users can be redirected');
          
          // Notify when server is ready
          io.emit('server-ready', {
            message: 'Server ready',
            url: `http://${host}:${port}`
          });
        }).on('error', (error) => {
          console.error('❌ Server startup error:', error);
          // Revert to old configuration on error
          configManager.setPort(PORT);
          configManager.setHost(HOST);
          console.log('🔄 Reverting to old configuration');
          
          io.emit('server-error', {
            message: 'Server startup error',
            error: error.message
          });
        });
      });
    }, 1000); // 1 second wait to ensure closure
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Server durum kontrol endpoint'i
app.get('/api/server/status', (req, res) => {
  res.json({ 
    status: 'running',
    host: HOST,
    port: PORT,
    url: `http://${HOST}:${PORT}`,
    timestamp: new Date().toISOString()
  });
});

app.delete('/api/agents/:id', (req, res) => {
  const { id } = req.params;
  const success = agentManager.deleteAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/start', (req, res) => {
  const { id } = req.params;
  const success = agentManager.startAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/stop', (req, res) => {
  const { id } = req.params;
  const success = agentManager.stopAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.put('/api/agents/:id', (req, res) => {
  const { id } = req.params;
  const { name, prompt, model, provider } = req.body;
  const success = agentManager.updateAgent(id, { name, prompt, model, provider });
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/message', (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const success = agentManager.sendMessageToAgent(id, content);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.get('/api/agents/:id/history', (req, res) => {
  const { id } = req.params;
  const history = agentManager.getAgentHistory(id);
  
  if (history !== null) {
    res.json({ history });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.delete('/api/agents/:id/history', (req, res) => {
  const { id } = req.params;
  const result = agentManager.clearAgentHistory(id);
  
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.get('/api/agents/:id/status', (req, res) => {
  const { id } = req.params;
  const status = agentManager.getAgentStatus(id);
  
  if (status !== null) {
    res.json({ status });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.get('/api/agents/:id/queue', (req, res) => {
  const { id } = req.params;
  const queue = agentManager.getAgentQueue(id);

  if (queue !== null) {
    res.json({ queue });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.delete('/api/agents/:id/queue/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  const result = agentManager.removeQueueItem(id, itemId);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.put('/api/agents/:id/queue/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  const { content, label } = req.body;
  const result = agentManager.updateQueueItem(id, itemId, { content, label });

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.post('/api/agents/:id/queue/:itemId/stop', (req, res) => {
  const { id, itemId } = req.params;
  const result = agentManager.stopQueueItem(id, itemId);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.delete('/api/agents/:id/queue', (req, res) => {
  const { id } = req.params;
  const result = agentManager.clearAgentQueue(id);

  if (result.success) {
    res.json({ success: true, message: 'Queue successfully cleared.' });
  } else {
    res.status(400).json({ error: result.message });
  }
});

// Cron Task Routes
app.get('/api/cron-tasks', (req, res) => {
  const tasks = cronManager.getAllTasks();
  res.json({ tasks });
});

app.post('/api/cron-tasks', (req, res) => {
  const { agentId, schedule, message, name } = req.body;
  
  if (!agentId || !schedule || !message || !name) {
    return res.status(400).json({ error: 'agentId, schedule, message, and name are required' });
  }
  
  const task = cronManager.createTask(agentId, schedule, message, name);
  res.json({ task: task.toJSON() });
});

app.delete('/api/cron-tasks/:id', (req, res) => {
  const { id } = req.params;
  const success = cronManager.deleteTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/start', (req, res) => {
  const { id } = req.params;
  const success = cronManager.startTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/stop', (req, res) => {
  const { id } = req.params;
  const success = cronManager.stopTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/pause', (req, res) => {
  const { id } = req.params;
  const success = cronManager.pauseTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/resume', (req, res) => {
  const { id } = req.params;
  const success = cronManager.resumeTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.put('/api/cron-tasks/:id/schedule', (req, res) => {
  const { id } = req.params;
  const { schedule } = req.body;
  
  if (!schedule) {
    return res.status(400).json({ error: 'schedule is required' });
  }
  
  const success = cronManager.updateTaskSchedule(id, schedule);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.put('/api/cron-tasks/:id/message', (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  
  const success = cronManager.updateTaskMessage(id, message);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.get('/api/agents/:id/cron-tasks', (req, res) => {
  const { id } = req.params;
  const tasks = cronManager.getTasksByAgent(id);
  res.json({ tasks });
});

// Tool Management Routes
app.get('/api/tools', (req, res) => {
  const tools = agentManager.getAvailableTools();
  res.json({ tools });
});

app.get('/api/agents/:id/tools', (req, res) => {
  const { id } = req.params;
  const enabledTools = agentManager.getEnabledTools(id);
  
  if (enabledTools !== null) {
    res.json({ enabledTools });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/tools/enable', (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = agentManager.enableTool(id, toolName);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/tools/disable', (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = agentManager.disableTool(id, toolName);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Model Management Routes
app.get('/api/models', (req, res) => {
  try {
    const models = global.modelManager.getAllModels();
    const providers = global.modelManager.getAllProviders();
    res.json({ models, providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers', (req, res) => {
  try {
    const providers = global.modelManager.getAllProviders();
    res.json({ providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId', (req, res) => {
  try {
    const { providerId } = req.params;
    const provider = global.modelManager.getProvider(providerId);
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.json({ provider });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId/models', (req, res) => {
  try {
    const { providerId } = req.params;
    const models = global.modelManager.getProviderModels(providerId);
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers', (req, res) => {
  try {
    const { providerId, name } = req.body;
    if (!providerId || !name) {
      return res.status(400).json({ error: 'providerId and name are required' });
    }
    
    const result = global.modelManager.addProvider(providerId, name);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, provider: result.provider });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/models/providers/:providerId', (req, res) => {
  try {
    const { providerId } = req.params;
    const result = global.modelManager.deleteProvider(providerId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers/:providerId/models', (req, res) => {
  try {
    const { providerId } = req.params;
    const { id, name, description, default: isDefault, supportsThinking } = req.body;
    
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    
    const result = global.modelManager.addModel(providerId, { id, name, description, default: isDefault, supportsThinking });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/models/providers/:providerId/models/:modelId', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const { id, name, description, default: isDefault, supportsThinking } = req.body;
    
    const result = global.modelManager.updateModel(providerId, modelId, { id, name, description, default: isDefault, supportsThinking });
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/models/providers/:providerId/models/:modelId', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const result = global.modelManager.deleteModel(providerId, modelId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers/:providerId/models/:modelId/default', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const result = global.modelManager.setDefaultModel(providerId, modelId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId/default', (req, res) => {
  try {
    const { providerId } = req.params;
    const model = global.modelManager.getDefaultModel(providerId);
    if (!model) {
      return res.status(404).json({ error: 'No default model found' });
    }
    res.json({ model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agent model selection endpoint - Get all available models for agent creation
app.get('/api/agents/available-models', (req, res) => {
  try {
    const models = agentManager.getAllAvailableModels();
    const providers = agentManager.getAllProviders();
    res.json({ models, providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent true-live status
app.get('/api/agents/:id/true-live-status', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const trueLiveMode = !!(agent.isTrueLiveMode || agent.trueLiveMode);
  const isLiveSessionActive = !!agent.isLiveSessionActive;
  const connectionStatus = agent.connectionStatus || (isLiveSessionActive ? 'connected' : 'disconnected');
  const uptime = agent.uptimeSeconds || 0;

  res.json({ 
    trueLiveMode,
    isTrueLiveMode: trueLiveMode,
    isLiveSessionActive,
    connectionStatus,
    uptime
  });
});

// Plugin Management Routes
app.get('/api/plugins', (req, res) => {
  const plugins = agentManager.getAllPluginsInfo();
  res.json({ plugins });
});

// Update Management Routes
app.get('/api/update/status', (req, res) => {
  try {
    const status = global.updateManager.getUpdateStatus();
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/update/check', async (req, res) => {
  try {
    const updateInfo = await global.updateManager.checkForUpdates();
    res.json({ updateInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/update/check', async (req, res) => {
  try {
    const updateInfo = await global.updateManager.checkForUpdates();
    res.json({ updateInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/update/start', async (req, res) => {
  try {
    const { updateInfo } = req.body;
    if (!updateInfo) {
      return res.status(400).json({ error: 'updateInfo is required' });
    }

    const result = await global.updateManager.startUpdate(updateInfo);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/update/settings', (req, res) => {
  try {
    const newSettings = req.body;
    console.log('Received update settings:', newSettings);
    
    const settings = global.updateManager.updateSettings(newSettings);
    console.log('Settings updated successfully:', settings);
    
    res.json({ settings });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/update/test-github', async (req, res) => {
  try {
    const update = await global.updateManager.checkForUpdates();
    res.json({ update });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// True Live Mode Routes
app.post('/api/agents/:id/true-live-mode', (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};

  // Get current agent to check current state if enabled is undefined
  const agent = agentManager.agents.get(id);
  const currentEnabled = agent && agent.isTrueLiveMode ? agent.isTrueLiveMode : false;

  // If enabled is undefined, toggle the current state
  const finalEnabled = enabled !== undefined ? enabled : !currentEnabled;

  const success = agentManager.setAgentTrueLiveMode(id, finalEnabled);

  if (success) {
    res.json({ success: true, enabled: finalEnabled });
  } else {
    res.status(404).json({ error: 'Agent not found or does not support true live mode' });
  }
});

app.post('/api/agents/:id/start-true-live-session', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.agents.get(id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Check if agent supports true live session
  if (!agent.startTrueLiveSession) {
    return res.status(400).json({ error: 'Agent does not support true live session' });
  }

  // Check if session is already active
  if (agent.isLiveSessionActive) {
    return res.json({ success: true, message: 'True live session already active', isActive: true });
  }

  // Start true live session (without socket for API call)
  agent.startTrueLiveSession(null).then(success => {
    if (success) {
      // Save to storage
      if (agent.dataManager) {
        agent.dataManager.saveAgent(agent);
      }
      res.json({ success: true, message: 'True live session started', isActive: true });
    } else {
      res.status(500).json({ error: 'Failed to start true live session' });
    }
  }).catch(error => {
    res.status(500).json({ error: error.message });
  });
});

app.post('/api/agents/:id/stop-true-live-session', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.agents.get(id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  // Check if agent supports true live session
  if (!agent.stopTrueLiveSession) {
    return res.status(400).json({ error: 'Agent does not support true live session' });
  }

  // Check if session is already inactive
  if (!agent.isLiveSessionActive) {
    return res.json({ success: true, message: 'True live session already inactive', isActive: false });
  }

  agent.stopTrueLiveSession();

  // Save to storage
  if (agent.dataManager) {
    agent.dataManager.saveAgent(agent);
  }

  res.json({ success: true, message: 'True live session stopped', isActive: false });
});

app.get('/api/agents/:id/true-live-status', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.agents.get(id);

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  res.json({
    isTrueLiveMode: agent.isTrueLiveMode || false,
    isLiveSessionActive: agent.isLiveSessionActive || false,
    connectionStatus: agent.connectionStatus || 'disconnected'
  });
});

app.post('/api/agents/:id/start-true-live-session', async (req, res) => {
  const { id } = req.params;
  
  try {
    const success = await agentManager.startAgentTrueLiveSession(id, null);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Agent not found or does not support true live mode' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/plugins/:name', (req, res) => {
  const { name } = req.params;
  const plugin = agentManager.getPluginInfo(name);
  
  if (plugin) {
    res.json({ plugin });
  } else {
    res.status(404).json({ error: 'Plugin not found' });
  }
});

app.post('/api/plugins/:name/enable', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.enablePlugin(name);
    res.json({ success: true, message: `Plugin ${name} enabled` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plugins/:name/disable', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.disablePlugin(name);
    res.json({ success: true, message: `Plugin ${name} disabled` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plugins/:name/reload', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.reloadPlugin(name);
    res.json({ success: true, message: `Plugin ${name} reloaded` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Plugin loading (zip upload)
app.post('/api/plugins/upload', upload.single('plugin'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Create temporary zip file
    const tempDir = path.join(__dirname, 'temp-updates');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const zipPath = path.join(tempDir, `plugin-${Date.now()}.zip`);
    fs.writeFileSync(zipPath, req.file.buffer);

    // Load via plugin manager
    const agent = agentManager.agents.values().next().value;
    if (!agent || !agent.toolManager || !agent.toolManager.pluginManager) {
      // Fallback: create temporary ToolManager
      const ToolManager = require('./src/tools/ToolManager');
      const tempToolManager = new ToolManager(global.cronManager, null, agentManager, io);
      
      const result = await tempToolManager.pluginManager.installFromZip(zipPath, true);
      res.json({ 
        success: result.success, 
        pluginName: result.pluginName 
      });
    } else {
      const result = await agent.toolManager.pluginManager.installFromZip(zipPath, true);
      res.json({ 
        success: result.success, 
        pluginName: result.pluginName 
      });
    }
  } catch (error) {
    console.error('Plugin upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Plugin silme
app.delete('/api/plugins/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { removeDependencies } = req.query;

    const agent = agentManager.agents.values().next().value;
    if (!agent || !agent.toolManager || !agent.toolManager.pluginManager) {
      // Fallback: create temporary ToolManager
      const ToolManager = require('./src/tools/ToolManager');
      const tempToolManager = new ToolManager(global.cronManager, null, agentManager, io);
      
      const result = await tempToolManager.pluginManager.deletePlugin(
        name, 
        removeDependencies === 'true'
      );
      res.json({ 
        success: result.success, 
        pluginName: result.pluginName,
        removedDependencies: result.removedDependencies
      });
    } else {
      const result = await agent.toolManager.pluginManager.deletePlugin(
        name, 
        removeDependencies === 'true'
      );
      res.json({ 
        success: result.success, 
        pluginName: result.pluginName,
        removedDependencies: result.removedDependencies
      });
    }
  } catch (error) {
    console.error('Plugin delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Plugin dependency information
app.get('/api/plugins/:name/dependencies', (req, res) => {
  try {
    const { name } = req.params;
    const agent = agentManager.agents.values().next().value;
    
    if (!agent || !agent.toolManager || !agent.toolManager.pluginManager) {
      const ToolManager = require('./src/tools/ToolManager');
      const tempToolManager = new ToolManager(global.cronManager, null, agentManager, io);
      const dependencies = tempToolManager.pluginManager.getPluginDependencies(name);
      res.json({ dependencies });
    } else {
      const dependencies = agent.toolManager.pluginManager.getPluginDependencies(name);
      res.json({ dependencies });
    }
  } catch (error) {
    console.error('Plugin dependencies error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res, next) => {
  // Ignore Chrome DevTools and other system requests
  const ignoredPaths = [
    '/.well-known/',
    '/favicon.ico',
    '/robots.txt'
  ];
  
  const shouldIgnore = ignoredPaths.some(path => req.originalUrl.startsWith(path));
  
  if (shouldIgnore) {
    return res.status(404).end();
  }
  
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  
  // Don't send error notifications for ignored paths
  const ignoredPaths = [
    '/.well-known/',
    '/favicon.ico',
    '/robots.txt'
  ];
  
  const shouldIgnore = ignoredPaths.some(path => req.originalUrl?.startsWith(path));
  
  res.status(err.status || 500);
  res.json({
    error: {
      message: err.message || 'Unknown error',
      status: err.status || 500
    }
  });
});

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Check for any agents with backend restoration sessions and update their client socket
  agentManager.agents.forEach((agent, agentId) => {
    if (agent.isLiveSessionActive && !agent.clientSocket) {
      console.log(`Updating client socket for agent ${agentId} from backend restoration to active session`);
      agent.clientSocket = socket;
    }
  });

  // Send current agents status to new client
  socket.emit('agents-status', {
    agents: agentManager.getAllAgents()
  });
  
  // Create Agent
  socket.on('create-agent', ({ name, prompt, model, enabledTools }) => {
    const agent = agentManager.createAgent(name, prompt, true, model || 'gemini-3.1-flash-live-preview');
    
    // Set enabled tools if provided
    if (enabledTools && Array.isArray(enabledTools)) {
      agent.enabledTools = enabledTools;
      if (agent.dataManager) {
        agent.dataManager.saveAgent(agent);
      }
    }
    
    socket.emit('agent-created', { agent: agent.toJSON() });
  });
  
  // Delete Agent
  socket.on('delete-agent', ({ agentId }) => {
    agentManager.deleteAgent(agentId);
  });
  
  // Start Agent
  socket.on('start-agent', ({ agentId }) => {
    agentManager.startAgent(agentId);
  });
  
  // Stop Agent
  socket.on('stop-agent', ({ agentId }) => {
    agentManager.stopAgent(agentId);
  });
  
  // Update Agent (name, prompt, model, voice)
  socket.on('update-agent', ({ agentId, name, prompt, model, voice }) => {
    agentManager.updateAgent(agentId, { name, prompt, model, voice });
  });
  
  // Restart Agent (triggered by agent reconnection)
  socket.on('agent-reconnected', async ({ agentId }) => {
    console.log(`Agent ${agentId} reconnected, restarting via server`);
    await agentManager.restartAgent(agentId);
  });
  
  // Restart Agent (triggered by agent reconnection)
  socket.on('agent-reconnected', ({ agentId }) => {
    console.log(`Agent ${agentId} reconnected, restarting via server`);
    agentManager.restartAgent(agentId);
  });
  
  // Send Message to Agent
  socket.on('send-message', ({ agentId, content }) => {
    agentManager.sendMessageToAgent(agentId, content);
  });
  
  // Get Agent History
  socket.on('get-history', ({ agentId }) => {
    const history = agentManager.getAgentHistory(agentId);
    socket.emit('agent-history', { agentId, history });
  });

  // Clear Agent History
  socket.on('clear-history', ({ agentId }) => {
    const result = agentManager.clearAgentHistory(agentId);
    if (!result.success) {
      socket.emit('agent-error', { 
        agentId, 
        error: result.message 
      });
    }
  });
  
  // Request Status Update
  socket.on('request-status', () => {
    agentManager.broadcastStatus();
  });

  // Request Agent Queue
  socket.on('request-agent-queue', ({ agentId }) => {
    const queue = agentManager.getAgentQueue(agentId);
    if (queue !== null) {
      socket.emit('agent-queue-update', { agentId, queue });
    }
  });
  
  // Cron Task Events
  socket.on('create-cron-task', ({ agentId, schedule, message, name }) => {
    const task = cronManager.createTask(agentId, schedule, message, name);
    socket.emit('cron-task-created', { task: task.toJSON() });
  });
  
  socket.on('delete-cron-task', ({ taskId }) => {
    cronManager.deleteTask(taskId);
  });
  
  socket.on('start-cron-task', ({ taskId }) => {
    cronManager.startTask(taskId);
  });
  
  socket.on('stop-cron-task', ({ taskId }) => {
    cronManager.stopTask(taskId);
  });
  
  socket.on('pause-cron-task', ({ taskId }) => {
    cronManager.pauseTask(taskId);
  });
  
  socket.on('resume-cron-task', ({ taskId }) => {
    cronManager.resumeTask(taskId);
  });
  
  socket.on('update-cron-task-schedule', ({ taskId, schedule }) => {
    cronManager.updateTaskSchedule(taskId, schedule);
  });
  
  socket.on('update-cron-task-message', ({ taskId, message }) => {
    cronManager.updateTaskMessage(taskId, message);
  });
  
  socket.on('update-cron-task', ({ taskId, name, agentId, schedule, message }) => {
    cronManager.updateTaskSchedule(taskId, schedule);
    cronManager.updateTaskMessage(taskId, message);
    if (name) cronManager.updateTaskName(taskId, name);
    if (agentId) cronManager.updateTaskAgent(taskId, agentId);
  });
  
  socket.on('request-cron-tasks', () => {
    cronManager.broadcastStatus();
  });
  
  // Python Process Management
  socket.on('request-python-processes', () => {
    // Broadcast all Python processes status
    const agents = agentManager.getAllAgents();
    agents.forEach(agent => {
      if (agent.toolManager && agent.toolManager.pythonProcessManager) {
        const processes = agent.toolManager.pythonProcessManager.getAllProcesses();
        socket.emit('python-processes-status', {
          agentId: agent.id,
          processes: processes
        });
      }
    });
  });
  
  // Shell Process Management
  socket.on('request-shell-processes', () => {
    // Broadcast all Shell processes status
    const agents = agentManager.getAllAgents();
    agents.forEach(agent => {
      if (agent.toolManager && agent.toolManager.shellProcessManager) {
        const processes = agent.toolManager.shellProcessManager.getAllProcesses();
        socket.emit('shell-processes-status', {
          agentId: agent.id,
          processes: processes
        });
      }
    });
  });
  
  // Live Session Management (works for all models)
  socket.on('start-live-session', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.startLiveSession === 'function') {
      agent.startLiveSession(socket);
      socket.emit('live-session-started', { agentId });
    }
  });

  socket.on('stop-live-session', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.stopLiveSession === 'function') {
      agent.stopLiveSession();
      socket.emit('live-session-stopped', { agentId });
    }
  });

  socket.on('live-audio-input', ({ agentId, audioData }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.handleLiveAudioInput === 'function') {
      agent.handleLiveAudioInput(audioData);
    }
  });

  // Manual Reconnect Handler
  socket.on('manual-reconnect-live', async ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.manualReconnect === 'function') {
      try {
        await agent.manualReconnect();
        socket.emit('live-connection-status', {
          agentId,
          status: 'connecting',
          message: 'Manual reconnection started'
        });
      } catch (error) {
        socket.emit('live-connection-status', {
          agentId,
          status: 'disconnected',
          message: 'Manual reconnection failed: ' + error.message
        });
      }
    }
  });

  // Test Disconnect Handler (for testing)
  socket.on('test-disconnect-live', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.liveSession) {
      console.log('Test disconnect requested for agent:', agentId);
      // Simulate connection drop
      if (typeof agent._handleConnectionDrop === 'function') {
        agent._handleConnectionDrop('Test interruption (tested by user)');
      }
    }
  });

  // True Live Mode - Special live mode controlled by button
  socket.on('set-true-live-mode', ({ agentId, enabled }) => {
    const success = agentManager.setAgentTrueLiveMode(agentId, enabled);
    socket.emit('true-live-mode-set', { agentId, enabled, success });

    // Save to storage when true live mode changes
    if (success) {
      const agent = agentManager.agents.get(agentId);
      if (agent && agent.dataManager) {
        agent.dataManager.saveAgent(agent);
      }
    }
  });

  socket.on('start-true-live-session', ({ agentId }) => {
    agentManager.startAgentTrueLiveSession(agentId, socket).then(success => {
      socket.emit('true-live-session-started', { agentId, success });

      // Save to storage when session starts
      if (success) {
        const agent = agentManager.agents.get(agentId);
        if (agent && agent.dataManager) {
          agent.dataManager.saveAgent(agent);
        }
      }
    }).catch(error => {
      socket.emit('true-live-session-error', { agentId, error: error.message });
    });
  });

  socket.on('stop-true-live-session', ({ agentId }) => {
    const success = agentManager.stopAgentTrueLiveSession(agentId);
    socket.emit('true-live-session-stopped', { agentId, success });

    // Save to storage when session stops
    if (success) {
      const agent = agentManager.agents.get(agentId);
      if (agent && agent.dataManager) {
        agent.dataManager.saveAgent(agent);
      }
    }
  });

  socket.on('true-live-audio-input', ({ agentId, audioData }) => {
    agentManager.handleAgentTrueLiveAudioInput(agentId, audioData);
  });

  socket.on('true-live-text-input', ({ agentId, text }) => {
    agentManager.handleAgentTrueLiveTextInput(agentId, text);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Error handling for socket
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

// Start Server
const PORT = configManager.getPort();
const HOST = configManager.getHost();

// Dynamic server configuration change
let currentServerConfig = { port: PORT, host: HOST };

app.post('/api/server/restart', async (req, res) => {
  try {
    const { port, host } = req.body;
    
    if (!port || !host) {
      return res.status(400).json({ error: 'Port and host are required' });
    }
    
    // Save new configuration
    configManager.setPort(port);
    configManager.setHost(host);
    
    console.log(`🔄 Server configuration changing: ${currentServerConfig.host}:${currentServerConfig.port} -> ${host}:${port}`);
    
    // Update new configuration
    currentServerConfig = { port, host };
    
    res.json({ 
      success: true, 
      message: 'Server configuration updated',
      newConfig: { host, port },
      redirectUrl: `http://${host}:${port}`
    });
    
    // Close and restart server
    setTimeout(() => {
      console.log('🛑 Server shutting down...');
      server.close(() => {
        console.log('✅ Server closed');
        
        // Restart with new configuration
        server.listen(port, host, () => {
          console.log(`🚀 Server started with new configuration: http://${host}:${port}`);
        }).on('error', (error) => {
          console.error('❌ Server startup error:', error);
          // On error, revert to old configuration
          configManager.setPort(currentServerConfig.port);
          configManager.setHost(currentServerConfig.host);
        });
      });
    }, 5000); // Close and restart after 5 seconds
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AzerClaw server running on http://${HOST}:${PORT}`);
  console.log(`Google API Key: ${configManager.hasApiKey('google') ? 'Set' : 'Not set'}`);
  console.log(`Gemini API Key: ${configManager.hasApiKey('gemini') ? 'Set' : 'Not set'}`);
}).on('error', (error) => {
  console.error('Server error:', error);
});