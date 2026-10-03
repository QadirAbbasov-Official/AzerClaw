/**
 * ConfigManager - Class that manages application settings
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../../data/config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load config file
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      } else {
        // Create default config
        const defaultConfig = this.getDefaultConfig();
        this.saveConfig(defaultConfig);
        return defaultConfig;
      }
    } catch (error) {
      console.error('Error loading config:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Default config
   */
  getDefaultConfig() {
    return {
      server: {
        port: 3000,
        host: 'localhost'
      },
      apiKeys: {
        google: '',
        gemini: ''
      },
      language: 'az',
      update: {
        enabled: true,
        checkOnStartup: true,
        checkInterval: 10,
        autoUpdate: false
      }
    };
  }

  /**
   * Save config file
   */
  saveConfig(config = this.config) {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  /**
   * Get config value
   */
  get(key) {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Set config value
   */
  set(key, value) {
    const keys = key.split('.');
    let obj = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }
    
    obj[keys[keys.length - 1]] = value;
    return this.saveConfig();
  }

  /**
   * Delete config value
   */
  delete(key) {
    const keys = key.split('.');
    let obj = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        return false;
      }
      obj = obj[k];
    }
    
    const lastKey = keys[keys.length - 1];
    if (lastKey in obj) {
      delete obj[lastKey];
      return this.saveConfig();
    }
    
    return false;
  }

  /**
   * Return all config
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  update(newConfig) {
    this.config = { ...this.config, ...newConfig };
    return this.saveConfig();
  }

  /**
   * Reset config (returns to default values)
   */
  reset() {
    this.config = this.getDefaultConfig();
    return this.saveConfig();
  }

  /**
   * API Key check
   */
  hasApiKey(provider = 'google') {
    const key = this.get(`apiKeys.${provider}`);
    return key && key.length > 0;
  }

  /**
   * Get API Key
   */
  getApiKey(provider = 'google') {
    return this.get(`apiKeys.${provider}`) || '';
  }

  /**
   * Set API Key
   */
  setApiKey(provider, key) {
    return this.set(`apiKeys.${provider}`, key);
  }

  /**
   * Delete API Key
   */
  deleteApiKey(provider) {
    return this.delete(`apiKeys.${provider}`);
  }

  /**
   * Get Port
   */
  getPort() {
    return this.get('server.port') || 3000;
  }

  /**
   * Set Port
   */
  setPort(port) {
    return this.set('server.port', parseInt(port));
  }

  /**
   * Get Host
   */
  getHost() {
    return this.get('server.host') || 'localhost';
  }

  /**
   * Set Host
   */
  setHost(host) {
    return this.set('server.host', host);
  }
}

// Singleton instance
let configManagerInstance = null;

/**
 * Returns ConfigManager singleton instance
 */
function getConfigManager() {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}

module.exports = { ConfigManager, getConfigManager };
