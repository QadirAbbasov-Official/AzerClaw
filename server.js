const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { getConfigManager } = require('./src/config/config');
const { getLang } = require('./src/config/lang');
const AuthManager = require('./src/auth/AuthManager');
const packageJson = require('./package.json');

// Initialize config manager
const configManager = getConfigManager();
global.configManager = configManager;
const authManager = new AuthManager();
global.authManager = authManager;

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

// Single-admin credentials and hashed session tokens are stored in SQLite.
// Browser session cookies remain random, HttpOnly, and time-limited.
const sessionCookie = 'azerclaw_admin_session';
const getAdmin = () => authManager.getAdmin();
const sessionTokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const addAdminSession = token => {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  authManager.deleteExpiredSessions();
  authManager.saveSession(sessionTokenHash(token), expiresAt);
};
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verifyPassword = (password, storedHash) => {
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, hash] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map(part => {
  const index = part.indexOf('=');
  return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
}));
const publicAdmin = admin => admin && ({ firstName: admin.firstName, lastName: admin.lastName, email: admin.email, birthDate: admin.birthDate || '', avatar: admin.avatar || '' });
const getSessionAdmin = req => {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  const hash = sessionTokenHash(token);
  const expiry = authManager.getSessionExpiry(hash);
  if (!token || !expiry || expiry <= Date.now()) {
    if (expiry) authManager.deleteSession(hash);
    return null;
  }
  return getAdmin();
};
const setSessionCookie = (res, token) => res.setHeader('Set-Cookie', `${sessionCookie}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${reqIsSecure(res) ? '; Secure' : ''}`);
function reqIsSecure(res) { return Boolean(res.req?.secure); }

app.post('/api/auth/register', async (req, res) => {
  if (getAdmin()) return res.status(409).json({ error: 'An administrator account already exists.' });
  const { firstName, lastName, birthDate, email, password } = req.body || {};
  if (![firstName, lastName, birthDate, email, password].every(value => typeof value === 'string' && value.trim())) {
    return res.status(400).json({ error: 'All profile fields and password are required.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 8) {
    return res.status(400).json({ error: 'Enter a valid email and a password with at least 8 characters.' });
  }
  const admin = { firstName: firstName.trim(), lastName: lastName.trim(), birthDate, email: email.trim().toLowerCase(), passwordHash: hashPassword(password), avatar: '' };
  try { authManager.saveAdmin(admin); } catch (error) { return res.status(500).json({ error: 'Could not save administrator account.' }); }
  const token = crypto.randomBytes(32).toString('hex');
  addAdminSession(token);
  setSessionCookie(res, token);
  await global.agentManager?.refreshAdminContext();
  res.json({ success: true, profile: publicAdmin(admin) });
});

app.post('/api/auth/login', (req, res) => {
  const admin = getAdmin();
  if (!admin) return res.status(404).json({ error: 'Administrator registration is required.' });
  if (!req.body?.email || !req.body?.password || req.body.email.trim().toLowerCase() !== admin.email || !verifyPassword(req.body.password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  addAdminSession(token);
  setSessionCookie(res, token);
  res.json({ success: true, profile: publicAdmin(admin) });
});

app.get('/api/auth/status', (req, res) => {
  const admin = getAdmin();
  const sessionAdmin = getSessionAdmin(req);
  res.json({ adminExists: Boolean(admin), authenticated: Boolean(sessionAdmin), profile: sessionAdmin ? publicAdmin(sessionAdmin) : null });
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (token) authManager.deleteSession(sessionTokenHash(token));
  res.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ success: true });
});

app.delete('/api/auth/account', (req, res) => {
  if (!getSessionAdmin(req)) return res.status(401).json({ error: 'Please sign in again.' });
  try {
    authManager.deleteAdminAccount();
    io.disconnectSockets(true);
    res.setHeader('Set-Cookie', `${sessionCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Could not delete administrator account.' });
  }
});

const authUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.put('/api/auth/profile', authUpload.single('avatar'), async (req, res) => {
  const admin = getSessionAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in again.' });
  const updated = { ...getAdmin(), firstName: String(req.body.firstName || '').trim(), lastName: String(req.body.lastName || '').trim(), birthDate: String(req.body.birthDate || ''), email: String(req.body.email || '').trim().toLowerCase() };
  if (!updated.firstName || !updated.lastName || !/^\S+@\S+\.\S+$/.test(updated.email)) return res.status(400).json({ error: 'Enter a first name, last name, and valid email.' });
  if (req.body.removeAvatar === 'true') updated.avatar = '';
  if (req.file) {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(req.file.mimetype)) return res.status(400).json({ error: 'Upload a PNG, JPEG, WebP, or GIF image.' });
    updated.avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  }
  try { authManager.saveAdmin(updated); } catch (error) { return res.status(500).json({ error: 'Could not save profile.' }); }
  await global.agentManager?.refreshAdminContext();
  res.json({ success: true, profile: publicAdmin(updated) });
});

app.put('/api/auth/password', (req, res) => {
  const admin = getSessionAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Please sign in again.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(currentPassword || '', admin.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'New password must have at least 8 characters.' });
  const updated = { ...getAdmin(), passwordHash: hashPassword(newPassword) };
  try { authManager.saveAdmin(updated); } catch (error) { return res.status(500).json({ error: 'Could not save password.' }); }
  res.json({ success: true });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  if (!getSessionAdmin(req)) return res.status(401).json({ error: 'Authentication required.' });
  next();
});

io.use((socket, next) => {
  const token = parseCookies(socket.handshake.headers.cookie)[sessionCookie];
  const expiry = authManager.getSessionExpiry(sessionTokenHash(token));
  if (!expiry || expiry <= Date.now() || !getAdmin()) return next(new Error('Authentication required.'));
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/plugins', (req, res, next) => getSessionAdmin(req) ? next() : res.sendStatus(401), express.static(path.join(__dirname, 'plugins')));

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

// Initialize ModelManager
global.modelManager = new ModelManager();

// Move legacy custom provider keys into the central config store.
let migratedProviderKeys = false;
for (const [providerId, provider] of Object.entries(global.modelManager.models.providers || {})) {
  if (provider.type !== 'custom' || !provider.apiKey) continue;
  if (!configManager.getApiKey(providerId)) configManager.setApiKey(providerId, provider.apiKey);
  delete provider.apiKey;
  migratedProviderKeys = true;
}
if (migratedProviderKeys) global.modelManager.saveModels(global.modelManager.models);

// Initialize Agent Manager
const apiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
global.agentManager = new AgentManager(io, apiKey);

// Initialize Cron Manager
global.cronManager = new CronManager(io, global.agentManager);

// Set cronManager in agentManager after initialization
global.agentManager.setCronManager(global.cronManager);

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
    agent.updateEnabledTools(enabledTools);
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
    const { auth: _privateAuth, ...safeConfig } = config;
    const maskedConfig = {
      ...safeConfig,
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
    const { auth: _ignoredAuth, ...newConfig } = req.body || {};
    configManager.update(newConfig);
    const { auth: _privateAuth, ...safeConfig } = configManager.getAll();
    res.json({ success: true, config: safeConfig });
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

// Server status endpoint
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

app.post('/api/agents/:id/tools/enable', async (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = await agentManager.enableTool(id, toolName);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/tools/disable', async (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = await agentManager.disableTool(id, toolName);
  
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
    const safeProviders = Object.fromEntries(Object.entries(providers).map(([id, value]) => [id, { ...value, hasApiKey: !!value.hasApiKey || !!configManager.getApiKey(id), apiKey: undefined }]));
    res.json({ providers: safeProviders });
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
    res.json({ provider: { ...provider, apiKey: undefined } });
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
    const { providerId, name, apiUrl, apiKey } = req.body;
    if (!providerId || !name || !apiUrl) {
      return res.status(400).json({ error: 'providerId, name, and apiUrl are required' });
    }
    
    const result = global.modelManager.addProvider(providerId, name, apiUrl, apiKey);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, provider: { ...result.provider, apiKey: undefined } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/models/providers/:providerId', (req, res) => {
  const result = global.modelManager.updateProvider(req.params.providerId, req.body);
  if (!result.success) return res.status(400).json({ error: result.error || 'Could not save provider' });
  res.json({ success: true });
});

app.post('/api/models/providers/test', async (req, res) => {
  try {
    const { providerId, apiUrl, model } = req.body;
    const savedProvider = providerId ? global.modelManager.getProvider(providerId) : null;
    const targetUrl = apiUrl || savedProvider?.apiUrl;
    const targetModel = model || savedProvider?.models?.[0]?.id || 'openai/gpt-4o-mini';
    const apiKey = configManager.getApiKey(providerId) || req.body.apiKey || savedProvider?.apiKey;
    if (!targetUrl || !model && !savedProvider?.models?.length) return res.status(400).json({ success: false, message: 'Enter a test model ID first' });
    const response = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model: targetModel, messages: [{ role: 'user', content: 'Reply with OK' }], max_tokens: 8 }) });
    const body = await response.text();
    res.status(response.ok ? 200 : 400).json({ success: response.ok, message: response.ok ? 'Connection successful' : body.slice(0, 500) });
  } catch (error) { res.status(400).json({ success: false, message: error.message }); }
});

app.delete('/api/models/providers/:providerId', (req, res) => {
  try {
    const { providerId } = req.params;
    const result = global.modelManager.deleteProvider(providerId);
    if (result.success) configManager.deleteApiKey(providerId);
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
  
  const isStopped = agent.status === 'stopped';
  const trueLiveMode = !isStopped && !!(agent.isTrueLiveMode || agent.trueLiveMode);
  const isLiveSessionActive = !isStopped && !!agent.isLiveSessionActive;
  const connectionStatus = isStopped ? 'disconnected' : (agent.connectionStatus || (isLiveSessionActive ? 'connected' : 'disconnected'));
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
function getLoadedPluginToolNames() {
  const toolNames = new Set();
  agentManager.agents.forEach(agent => {
    agent.toolManager?.getAvailableTools().forEach(toolName => toolNames.add(toolName));
  });
  return toolNames;
}

async function resetPluginRuntime(previousToolNames = new Set()) {
  const agents = Array.from(agentManager.agents.values());
  const liveSessions = [];
  const reloadErrors = [];

  agents.forEach(agent => {
    if (agent.isLiveSessionActive && typeof agent.stopLiveSession === 'function') {
      liveSessions.push({ agent, clientSocket: agent.clientSocket || null });
      try {
        agent.stopLiveSession(true);
      } catch (error) {
        reloadErrors.push({ agentId: agent.id, error: error.message });
      }
    }
  });

  for (const agent of agents) {
    if (!agent.toolManager) continue;
    try {
      await agent.toolManager.reloadTools();
    } catch (error) {
      reloadErrors.push({ agentId: agent.id, error: error.message });
    }
  }

  const availableToolsByAgent = new Map();
  const allAvailableTools = new Set();
  agents.forEach(agent => {
    const available = agent.toolManager?.getAvailableTools() || [];
    availableToolsByAgent.set(agent.id, available);
    available.forEach(toolName => allAvailableTools.add(toolName));
  });
  const newlyAvailableTools = Array.from(allAvailableTools).filter(toolName => !previousToolNames.has(toolName));

  agents.forEach(agent => {
    try {
      const available = availableToolsByAgent.get(agent.id) || [];
      const enabledBefore = Array.isArray(agent.enabledTools) ? agent.enabledTools : available;
      const enabledTools = Array.from(new Set([
        ...enabledBefore.filter(toolName => available.includes(toolName)),
        ...newlyAvailableTools.filter(toolName => available.includes(toolName))
      ]));
      agent.updateEnabledTools(enabledTools);
      agent.dataManager?.saveAgent(agent);
      io.emit('agent-tools-updated', { agentId: agent.id, enabledTools });
    } catch (error) {
      reloadErrors.push({ agentId: agent.id, error: error.message });
    }
  });

  let liveSessionsRestarted = 0;
  for (const { agent, clientSocket } of liveSessions) {
    try {
      const restarted = await agent.startLiveSession(clientSocket);
      if (restarted) liveSessionsRestarted++;
      else reloadErrors.push({ agentId: agent.id, error: 'Live session could not be reconnected' });
    } catch (error) {
      reloadErrors.push({ agentId: agent.id, error: error.message });
    }
  }

  agentManager.broadcastStatus();
  io.emit('plugins-updated');
  return { liveSessionsRestarted, reloadErrors };
}

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
  if (agent?.status === 'stopped' && enabled !== false) {
    return res.status(409).json({ error: 'Agent is stopped' });
  }
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
  if (agent.status === 'stopped') {
    return res.status(409).json({ error: 'Agent is stopped' });
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
    isTrueLiveMode: agent.status !== 'stopped' && (agent.isTrueLiveMode || false),
    isLiveSessionActive: agent.status !== 'stopped' && (agent.isLiveSessionActive || false),
    connectionStatus: agent.status === 'stopped' ? 'disconnected' : (agent.connectionStatus || 'disconnected')
  });
});

app.post('/api/agents/:id/start-true-live-session', async (req, res) => {
  const { id } = req.params;
  if (agentManager.getAgent(id)?.status === 'stopped') {
    return res.status(409).json({ error: 'Agent is stopped' });
  }
  
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

    const previousToolNames = getLoadedPluginToolNames();

    // Create temporary zip file
    const tempDir = path.join(__dirname, 'temp-updates');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const zipPath = path.join(tempDir, `plugin-${Date.now()}.zip`);
    fs.writeFileSync(zipPath, req.file.buffer);

    // Load via plugin manager
    const agent = agentManager.agents.values().next().value;
    let result;
    if (!agent || !agent.toolManager || !agent.toolManager.pluginManager) {
      // Fallback: create temporary ToolManager
      const ToolManager = require('./src/tools/ToolManager');
      const tempToolManager = new ToolManager(global.cronManager, null, agentManager, io);
      await tempToolManager.ready;
      result = await tempToolManager.pluginManager.installFromZip(zipPath, true);
    } else {
      result = await agent.toolManager.pluginManager.installFromZip(zipPath, true);
    }

    const runtimeReset = result.success ? await resetPluginRuntime(previousToolNames) : null;
    res.json({
      success: result.success,
      pluginName: result.pluginName,
      runtimeReset: Boolean(runtimeReset),
      liveSessionsRestarted: runtimeReset?.liveSessionsRestarted || 0,
      resetWarnings: runtimeReset?.reloadErrors || []
    });
  } catch (error) {
    console.error('Plugin upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete plugin
app.delete('/api/plugins/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { removeDependencies } = req.query;
    const previousToolNames = getLoadedPluginToolNames();

    const agent = agentManager.agents.values().next().value;
    let result;
    if (!agent || !agent.toolManager || !agent.toolManager.pluginManager) {
      // Fallback: create temporary ToolManager
      const ToolManager = require('./src/tools/ToolManager');
      const tempToolManager = new ToolManager(global.cronManager, null, agentManager, io);
      
      await tempToolManager.ready;
      result = await tempToolManager.pluginManager.deletePlugin(
        name, 
        removeDependencies === 'true'
      );
    } else {
      result = await agent.toolManager.pluginManager.deletePlugin(
        name, 
        removeDependencies === 'true'
      );
    }

    const runtimeReset = result.success ? await resetPluginRuntime(previousToolNames) : null;
    res.json({
      success: result.success,
      pluginName: result.pluginName,
      removedDependencies: result.removedDependencies,
      runtimeReset: Boolean(runtimeReset),
      liveSessionsRestarted: runtimeReset?.liveSessionsRestarted || 0,
      resetWarnings: runtimeReset?.reloadErrors || []
    });
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
  socket.on('create-agent', ({ name, prompt, model, provider, enabledTools }) => {
    const agent = agentManager.createAgent(name, prompt, true, model || 'gemini-3.1-flash-live-preview', provider);
    
    // Set enabled tools if provided
    if (enabledTools && Array.isArray(enabledTools)) {
      agent.updateEnabledTools(enabledTools);
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
  socket.on('update-agent', async ({ agentId, name, prompt, model, provider, voice }) => {
    try {
      await agentManager.updateAgent(agentId, { name, prompt, model, provider, voice });
    } catch (error) {
      console.error(`Failed to update agent ${agentId}:`, error);
      socket.emit('agent-error', { agentId, error: error.message || 'Agent settings could not be saved.' });
    }
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
    if (agent?.status === 'stopped') {
      socket.emit('agent-error', { agentId, error: 'Cannot start Live mode while the agent is stopped' });
      return;
    }
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
    if (agent && agent.status !== 'stopped' && typeof agent.handleLiveAudioInput === 'function') {
      agent.handleLiveAudioInput(audioData);
    }
  });

  // Manual Reconnect Handler
  socket.on('manual-reconnect-live', async ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent?.status === 'stopped') {
      socket.emit('live-connection-status', { agentId, status: 'disconnected', message: 'Agent is stopped' });
      return;
    }
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
    const agent = agentManager.getAgent(agentId);
    if (agent?.status === 'stopped' && enabled !== false) {
      socket.emit('true-live-mode-set', { agentId, enabled, success: false });
      return;
    }
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
    if (agentManager.getAgent(agentId)?.status === 'stopped') {
      socket.emit('true-live-session-started', { agentId, success: false });
      return;
    }
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
    if (agentManager.getAgent(agentId)?.status !== 'stopped') {
      agentManager.handleAgentTrueLiveAudioInput(agentId, audioData);
    }
  });

  socket.on('true-live-text-input', ({ agentId, text }) => {
    if (agentManager.getAgent(agentId)?.status !== 'stopped') {
      agentManager.handleAgentTrueLiveTextInput(agentId, text);
    }
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
