const PluginManager = require('./PluginManager');

class ToolManager {
  constructor(cronManager = null, enabledTools = null, agentManager = null, io = null) {
    this.cronManager = cronManager;
    this.agentManager = agentManager;
    this.enabledTools = enabledTools; // If null, all tools are enabled
    this.io = io;
    
    // Use PluginManager instead of direct tool registration
    this.pluginManager = new PluginManager(io, cronManager, agentManager);
    this.pluginManager.loadAllPlugins().then(() => {
      console.log(`ToolManager: Plugin loading completed`);
    });
  }

  async reloadTools() {
    try {
      console.log(`ToolManager: Starting tool reload`);

      // Reload plugins
      await this.pluginManager.loadAllPlugins();
      const allTools = this.pluginManager.getAllTools();
      console.log(`ToolManager: Tools reloaded successfully, count: ${Object.keys(allTools).length}`);
      console.log(`ToolManager: Available tools: ${Object.keys(allTools).join(', ')}`);
    } catch (error) {
      console.error('Error reloading tools:', error);
    }
  }

  async executeTool(toolName, args) {
    // Check if tool is enabled
    // Handle both "toolName" and "plugin.toolName" formats
    const isToolEnabled = this.enabledTools && (
      this.enabledTools.includes(toolName) || 
      this.enabledTools.some(enabled => enabled.endsWith(`.${toolName}`))
    );
    
    if (this.enabledTools && !isToolEnabled) {
      throw new Error(`Tool ${toolName} is not enabled for this agent`);
    }

    try {
      const parsedArgs = this.parseArgs(args);
      return await this.pluginManager.executeTool(toolName, parsedArgs);
    } catch (error) {
      console.error(`Tool execution error: ${toolName}`, error);
      throw new Error(`Tool execution error: ${error.message}`);
    }
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
