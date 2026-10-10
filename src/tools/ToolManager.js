const PluginManager = require('./PluginManager');

class ToolManager {
  constructor(cronManager = null, enabledTools = null, agentManager = null, io = null) {
    this.cronManager = cronManager;
    this.agentManager = agentManager;
    this.enabledTools = enabledTools; // If null, all tools are enabled
    this.io = io;
    
    // Use PluginManager instead of direct tool registration
    this.pluginManager = new PluginManager(io, cronManager, agentManager);
    this.ready = this.pluginManager.loadAllPlugins().then(() => {
      console.log(`ToolManager: Plugin loading completed`);
    }).catch(error => {
      console.error('ToolManager: Initial plugin loading failed:', error);
    });
  }

  async reloadTools() {
    try {
      console.log(`ToolManager: Starting tool reload`);

      await this.ready;
      this.pluginManager.unloadAllPlugins();
      await this.pluginManager.loadAllPlugins();
      const allTools = this.pluginManager.getAllTools();
      console.log(`ToolManager: Tools reloaded successfully, count: ${Object.keys(allTools).length}`);
      console.log(`ToolManager: Available tools: ${Object.keys(allTools).join(', ')}`);
    } catch (error) {
      console.error('Error reloading tools:', error);
    }
  }

  async executeTool(toolName, args, agent = null) {
    if (!this.isToolEnabled(toolName)) throw new Error('Tool is unavailable.');

    try {
      const parsedArgs = this.parseArgs(args);
      return await this.pluginManager.executeTool(toolName, parsedArgs, agent);
    } catch (error) {
      console.error(`Tool execution error: ${toolName}`, error);
      throw new Error(`Tool execution error: ${error.message}`);
    }
  }

  isToolEnabled(toolName) {
    if (!Array.isArray(this.enabledTools)) return true;
    const name = String(toolName || '');
    if (this.enabledTools.includes(name)) return true;
    if (name.includes('.')) return false;
    const shortName = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    return this.enabledTools.includes(shortName) || this.enabledTools.some(enabled => String(enabled).slice(String(enabled).lastIndexOf('.') + 1) === shortName);
  }

  getEnabledTools() {
    const allTools = this.getAvailableTools();
    return allTools.filter(toolName => this.isToolEnabled(toolName));
  }

  parseArgs(args) {
    try {
      if (typeof args === 'string') {
        return JSON.parse(args);
      }
      return args;
    } catch (error) {
      // If JSON parsing fails, treat as simple string argument
      return { input: args };
    }
  }

  getAvailableTools() {
    return this.pluginManager ? Object.keys(this.pluginManager.getAllTools()) : [];
  }

  getAllPluginsInfo() {
    return this.pluginManager ? this.pluginManager.getAllPluginsInfo() : [];
  }

  getPluginInfo(pluginName) {
    return this.pluginManager ? this.pluginManager.getPluginInfo(pluginName) : null;
  }

  async enablePlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.enablePlugin(pluginName);
    }
  }

  async disablePlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.disablePlugin(pluginName);
    }
  }

  async reloadPlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.reloadPlugin(pluginName);
    }
  }
}

module.exports = ToolManager;
