/**
 * PluginManager - Plugin loading and management system
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const decache = require('decache');
const AdmZip = require('adm-zip');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class PluginManager {
  // Static array to track all instances for cleanup
  static instances = [];
  
  constructor(io, cronManager = null, agentManager = null) {
    this.plugins = new Map();
    this.io = io;
    this.cronManager = cronManager;
    this.agentManager = agentManager;
    this.pluginsDir = path.join(__dirname, '../../plugins');
    this.watcher = null;
    this.initializeWatcher();
    
    // Register instance for cleanup
    PluginManager.instances.push(this);
  }

  /**
   * Load all plugins
   */
  async loadAllPlugins() {
    try {
      const pluginDirs = this.getPluginDirectories();
      
      for (const pluginDir of pluginDirs) {
        await this.loadPlugin(pluginDir);
      }
      
      console.log(`Loaded ${this.plugins.size} plugins`);
      return this.plugins;
    } catch (error) {
      console.error('Error loading plugins:', error);
      throw error;
    }
  }

  /**
   * Find plugin directories
   */
  getPluginDirectories() {
    if (!fs.existsSync(this.pluginsDir)) {
      console.log('Plugins directory does not exist');
      return [];
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  /**
   * Load a single plugin
   */
  async loadPlugin(pluginName) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      const mainPath = path.join(pluginPath, 'main.js');
      const infoPath = path.join(pluginPath, 'info.json');

      // Check if main.js exists
      if (!fs.existsSync(mainPath)) {
        console.warn(`Plugin ${pluginName} missing main.js, skipping`);
        return null;
      }

      // Load info.json if exists
      let config = {
        name: pluginName,
        version: '1.0.0',
        description: '',
        author: 'Unknown',
        category: 'utility',
        enabled: true,
        hasGUI: false,
        guiFiles: null
      };

      if (fs.existsSync(infoPath)) {
        try {
          const infoData = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          config = { ...config, ...infoData };
        } catch (error) {
          console.error(`Error parsing info.json for ${pluginName}:`, error);
        }
      }

      // Decache all JS files in the plugin directory before loading
      const pluginFiles = fs.readdirSync(pluginPath);
      pluginFiles.forEach(file => {
        if (file.endsWith('.js')) {
          const filePath = path.join(pluginPath, file);
          decache(filePath);
        }
      });

      // Load plugin main class
      const PluginClass = require(mainPath);
      
      // Create plugin instance with dependencies
      let pluginInstance;
      try {
        const effectiveCronManager = this.cronManager || global.cronManager;
        if (this.needsCronManager(pluginName)) {
          pluginInstance = new PluginClass(effectiveCronManager);
        } else if (this.needsAgentManager(pluginName)) {
          pluginInstance = new PluginClass(this.agentManager);
        } else {
          // Only pass io if it's a valid socket.io instance
          const validIo = this.io && typeof this.io.emit === 'function' ? this.io : null;
          pluginInstance = new PluginClass(validIo);
        }
      } catch (error) {
        console.error(`Error creating plugin instance ${pluginName}:`, error);
        return null;
      }

      // Check if plugin is enabled
      const isEnabled = config.enabled !== false;
      if (!isEnabled) {
        console.log(`Plugin ${pluginName} is disabled, loading but not registering tools`);
      }

      // Get tools from plugin
      const tools = isEnabled ? pluginInstance.getTools() : {};

      // Store plugin
      this.plugins.set(pluginName, {
        name: pluginName,
        version: config.version,
        description: config.description,
        author: config.author,
        category: config.category,
        config: config,
        instance: pluginInstance,
        tools: tools,
        enabled: isEnabled,
        toolNames: Object.keys(tools),
        hasGUI: config.hasGUI || false,
        guiFiles: config.guiFiles || null
      });

      console.log(`Loaded plugin: ${pluginName} v${config.version} ${isEnabled ? '(enabled)' : '(disabled)'}`);
      return this.plugins.get(pluginName);
    } catch (error) {
      console.error(`Error loading plugin ${pluginName}:`, error);
      return null;
    }
  }

  /**
   * Determine which dependency the plugin needs
   */
  needsCronManager(pluginName) {
    return ['cron'].includes(pluginName);
  }

  needsAgentManager(pluginName) {
    return ['agent'].includes(pluginName);
  }

  setCronManager(cronManager) {
    this.cronManager = cronManager;
    this.plugins.forEach((plugin, pluginName) => {
      if (this.needsCronManager(pluginName) && plugin.instance) {
        plugin.instance.cronManager = cronManager;
      }
    });
  }

  /**
   * Reload plugin
   */
  async reloadPlugin(pluginName) {
    this.unloadPlugin(pluginName);
    return await this.loadPlugin(pluginName);
  }

  /**
   * Remove plugin
   */
  unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      if (typeof plugin.instance?.close === 'function') {
        try {
          plugin.instance.close();
        } catch (error) {
          console.error(`Error closing plugin ${pluginName}:`, error.message);
        }
      }
      this.plugins.delete(pluginName);
      console.log(`Unloaded plugin: ${pluginName}`);
      return true;
    }
    return false;
  }

  /**
   * Remove all plugins
   */
  unloadAllPlugins() {
    const pluginNames = Array.from(this.plugins.keys());
    pluginNames.forEach(name => this.unloadPlugin(name));
    console.log('Unloaded all plugins');
  }

  /**
   * Return plugin information
   */
  getPluginInfo(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return null;
    }

    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      category: plugin.category,
      tools: plugin.toolNames || Object.keys(plugin.tools),
      enabled: plugin.enabled !== false,
      hasGUI: plugin.hasGUI || false,
      guiFiles: plugin.guiFiles || null
    };
  }

  /**
   * Return all plugin information
   */
  getAllPluginsInfo() {
    return Array.from(this.plugins.values()).map(plugin => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      category: plugin.category,
      tools: plugin.toolNames || Object.keys(plugin.tools),
      enabled: plugin.enabled !== false,
      hasGUI: plugin.hasGUI || false,
      guiFiles: plugin.guiFiles || null
    }));
  }

  /**
   * Return plugin tools
   */
  getPluginTools(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return null;
    }
    return plugin.tools;
  }

  /**
   * Return all tools (from all plugins)
   */
  getAllTools() {
    const allTools = {};
    
    this.plugins.forEach((plugin, pluginName) => {
      Object.entries(plugin.tools).forEach(([toolName, toolConfig]) => {
        allTools[`${pluginName}.${toolName}`] = {
          ...toolConfig,
          plugin: pluginName,
          fullName: `${pluginName}.${toolName}`
        };
      });
    });

    return allTools;
  }

  /**
   * Execute tool
   */
  async executeTool(toolName, args, agent = null) {
    // Parse tool name (could be "plugin.tool" or just "tool")
    let pluginName, actualToolName;
    
    if (toolName.includes('.')) {
      [pluginName, actualToolName] = toolName.split('.');
    } else {
      // Find tool in any plugin
      for (const [pname, plugin] of this.plugins.entries()) {
        if (plugin.tools[toolName]) {
          pluginName = pname;
          actualToolName = toolName;
          break;
        }
      }
    }

    if (!pluginName || !actualToolName) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    const tool = plugin.tools[actualToolName];
    if (!tool) {
      throw new Error(`Tool ${actualToolName} not found in plugin ${pluginName}`);
    }

    try {
      return await tool.handler(args, agent);
    } catch (error) {
      throw new Error(`Tool execution error: ${error.message}`);
    }
  }

  /**
   * Enable plugin
   */
  async enablePlugin(pluginName) {
    const infoPath = path.join(this.pluginsDir, pluginName, 'info.json');
    
    if (fs.existsSync(infoPath)) {
      const config = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      config.enabled = true;
      fs.writeFileSync(infoPath, JSON.stringify(config, null, 2));
    }
    
    // Reload the plugin with tools enabled
    await this.reloadPlugin(pluginName);
    return true;
  }

  /**
   * Disable plugin
   */
  async disablePlugin(pluginName) {
    const infoPath = path.join(this.pluginsDir, pluginName, 'info.json');
    
    if (fs.existsSync(infoPath)) {
      const config = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      config.enabled = false;
      fs.writeFileSync(infoPath, JSON.stringify(config, null, 2));
    }
    
    // Reload the plugin with tools disabled
    await this.reloadPlugin(pluginName);
    return true;
  }

  /**
   * Start watcher to monitor plugin files
   */
  initializeWatcher() {
    // Watch the plugins directory
    this.watcher = chokidar.watch(this.pluginsDir, {
      ignored: /(^|[\/\\])\../, // Ignore hidden files
      persistent: true,
      ignoreInitial: true
    });

    // Catch watcher errors
    this.watcher.on('error', (error) => {
      console.error('Plugin watcher error:', error);
    });

    // Monitor all file changes
    this.watcher.on('change', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      const fileName = path.basename(filePath);
      
      // Special message for info.json
      if (fileName === 'info.json') {
        console.log(`Plugin ${pluginName} info.json changed, checking...`);
      } else {
        console.log(`Plugin ${pluginName} file changed: ${fileName}, reloading...`);
      }
      
      try {
        // Decache the old module (if it's a JS file)
        if (filePath.endsWith('.js')) {
          decache(filePath);
        }
        
        // Reload the plugin
        const result = await this.reloadPlugin(pluginName);
        
        if (result) {
          if (fileName === 'info.json') {
            console.log(`Plugin ${pluginName} info.json change applied`);
          } else {
            console.log(`Plugin ${pluginName} successfully reloaded`);
          }
          
          // Notify agents about the update
          if (this.agentManager) {
            this.agentManager.broadcastStatus();
          }
        } else {
          console.log(`Plugin ${pluginName} reload failed (file missing or error)`);
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} reload error:`, error);
      }
    });

    // Watch for file deletion
    this.watcher.on('unlink', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      console.log(`Plugin ${pluginName} file deleted: ${path.basename(filePath)}, unloading plugin...`);
      
      try {
        this.unloadPlugin(pluginName);
        console.log(`Plugin ${pluginName} successfully removed`);
        
        if (this.agentManager) {
          this.agentManager.broadcastStatus();
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} removal error:`, error);
      }
    });

    // Watch for plugin directory deletion
    this.watcher.on('unlinkDir', async (dirPath) => {
      const pluginName = path.basename(dirPath);
      console.log(`Plugin directory ${pluginName} deleted, unloading plugin...`);
      
      try {
        this.unloadPlugin(pluginName);
        console.log(`Plugin ${pluginName} unloaded successfully`);
        
        if (this.agentManager) {
          this.agentManager.broadcastStatus();
        }
      } catch (error) {
        console.error(`Error unloading plugin ${pluginName}:`, error);
      }
    });

    // Monitor file creation
    this.watcher.on('add', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      console.log(`Plugin ${pluginName} file added: ${path.basename(filePath)}, loading plugin...`);
      
      try {
        // If plugin is already loaded, reload
        if (this.plugins.has(pluginName)) {
          const result = await this.reloadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} successfully reloaded`);
          } else {
            console.log(`Plugin ${pluginName} reload failed`);
          }
        } else {
          // Load as new plugin
          const result = await this.loadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} successfully loaded`);
            
            if (this.agentManager) {
              this.agentManager.broadcastStatus();
            }
          }
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} loading error:`, error);
      }
    });

    // Monitor plugin directory creation
    this.watcher.on('addDir', async (dirPath) => {
      const pluginName = path.basename(dirPath);
      console.log(`Plugin directory ${pluginName} added, loading plugin...`);
      
      try {
        // Wait for plugin files to be created
        setTimeout(async () => {
          const result = await this.loadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} loaded successfully`);
            
            if (this.agentManager) {
              this.agentManager.broadcastStatus();
            }
          }
        }, 500); // 500ms wait time
      } catch (error) {
        console.error(`Error loading plugin ${pluginName}:`, error);
      }
    });

    console.log('Plugin file watcher initialized');
  }

  /**
   * Stop watcher
   */
  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      console.log('Plugin file watcher stopped');
    }
  }

  /**
   * Clean up all plugin manager instances
   */
  static stopAllWatchers() {
    PluginManager.instances.forEach(instance => {
      instance.stopWatcher();
    });
    PluginManager.instances = [];
    console.log('All plugin watchers stopped');
  }

  /**
   * Load plugin from zip file
   */
  async installFromZip(zipPath, removeZip = true) {
    try {
      console.log(`Installing plugin from zip: ${zipPath}`);
      
      // Extract zip file
      const pluginName = await this.extractZip(zipPath);
      
      if (!pluginName) {
        throw new Error('Failed to extract zip file');
      }
      
      // Load dependencies
      await this.installDependencies(pluginName);
      
      // Load plugin
      const result = await this.loadPlugin(pluginName);
      
      // Delete zip file (optional)
      if (removeZip && fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
        console.log(`Zip file removed: ${zipPath}`);
      }
      
      return {
        success: true,
        pluginName,
        plugin: result
      };
    } catch (error) {
      console.error('Error installing plugin from zip:', error);
      throw error;
    }
  }

  /**
   * Extract zip file
   */
  async extractZip(zipPath) {
    try {
      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();
      
      // Determine plugin name and detect main folder in zip
      let pluginName = null;
      let rootFolder = null;
      
      // Check structure inside zip
      for (const entry of zipEntries) {
        const entryName = entry.entryName;
        
        // If entry is a directory and at root level
        if (entry.isDirectory && !entryName.includes('/')) {
          rootFolder = entryName;
          pluginName = entryName;
          break;
        }
        
        // If main.js file exists, get plugin name from parent directory
        if (entryName.endsWith('main.js')) {
          const parts = entryName.split('/');
          if (parts.length > 1) {
            if (!rootFolder) {
              rootFolder = parts[0];
            }
            pluginName = parts[0];
            break;
          }
        }
      }
      
      // If plugin name cannot be found, use zip file name
      if (!pluginName) {
        pluginName = path.basename(zipPath, '.zip');
      }
      
      const pluginPath = path.join(this.pluginsDir, pluginName);
      
      // If plugin directory already exists, throw error
      if (fs.existsSync(pluginPath)) {
        throw new Error(`Plugin directory already exists: ${pluginName}`);
      }
      
      // Create plugin directory
      fs.mkdirSync(pluginPath, { recursive: true });
      
      // If there is a main folder in zip, extract files directly to pluginPath
      if (rootFolder) {
        console.log(`Detected root folder in zip: ${rootFolder}, extracting contents directly`);
        
        // Iterate through all entries in zip
        zipEntries.forEach(entry => {
          const entryName = entry.entryName;
          
          // If entry is in rootFolder
          if (entryName.startsWith(rootFolder + '/') || entryName === rootFolder) {
            // Remove rootFolder prefix
            const relativePath = entryName.substring(rootFolder.length).replace(/^\//, '');
            
            if (relativePath) { // If not empty
              const targetPath = path.join(pluginPath, relativePath);
              
              if (entry.isDirectory) {
                // Create directory
                if (!fs.existsSync(targetPath)) {
                  fs.mkdirSync(targetPath, { recursive: true });
                }
              } else {
                // Extract file
                const entryData = entry.getData();
                fs.writeFileSync(targetPath, entryData);
              }
            }
          }
        });
      } else {
        // If no main folder, extract normally
        zip.extractAllTo(pluginPath, true);
      }
      
      console.log(`Extracted zip to: ${pluginPath}`);
      
      return pluginName;
    } catch (error) {
      console.error('Error extracting zip:', error);
      throw error;
    }
  }

  /**
   * Load dependencies from plugin's package.json
   */
  async installDependencies(pluginName) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      const packageJsonPath = path.join(pluginPath, 'package.json');
      
      if (!fs.existsSync(packageJsonPath)) {
        console.log(`No package.json found for plugin ${pluginName}, skipping dependency installation`);
        return;
      }
      
      console.log(`Installing dependencies for plugin ${pluginName}...`);
      
      // Run npm install
      const { stdout, stderr } = await execAsync(`cd "${pluginPath}" && npm install`, {
        cwd: pluginPath,
        timeout: 120000 // 2-minute timeout
      });
      
      if (stdout) console.log(`npm install stdout: ${stdout}`);
      if (stderr) console.log(`npm install stderr: ${stderr}`);
      
      console.log(`Dependencies installed for plugin ${pluginName}`);
    } catch (error) {
      console.error(`Error installing dependencies for plugin ${pluginName}:`, error);
      // Dependency loading error should not prevent plugin loading
      console.warn('Continuing without dependencies installation');
    }
  }

  /**
   * Deletes a plugin
   */
  async deletePlugin(pluginName, removeDependencies = false) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      
      if (!fs.existsSync(pluginPath)) {
        throw new Error(`Plugin directory not found: ${pluginName}`);
      }
      
      // Remove plugin from memory
      this.unloadPlugin(pluginName);
      
      // Remove dependencies (optional)
      if (removeDependencies) {
        await this.removePluginDependencies(pluginName);
      }
      
      // Remove the plugin directory
      fs.rmSync(pluginPath, { recursive: true, force: true });
      
      console.log(`Plugin ${pluginName} deleted successfully${removeDependencies ? ' with dependencies' : ''}`);
      
      return {
        success: true,
        pluginName,
        removedDependencies: removeDependencies
      };
    } catch (error) {
      console.error(`Error deleting plugin ${pluginName}:`, error);
      throw error;
    }
  }

  /**
   * Remove plugin dependencies
   */
  async removePluginDependencies(pluginName) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      const packageJsonPath = path.join(pluginPath, 'package.json');
      
      if (!fs.existsSync(packageJsonPath)) {
        console.log(`No package.json found for plugin ${pluginName}, skipping dependency removal`);
        return;
      }
      
      console.log(`Removing dependencies for plugin ${pluginName}...`);
      
      // Run npm uninstall (delete node_modules)
      const nodeModulesPath = path.join(pluginPath, 'node_modules');
      
      if (fs.existsSync(nodeModulesPath)) {
        fs.rmSync(nodeModulesPath, { recursive: true, force: true });
        console.log(`Removed node_modules for plugin ${pluginName}`);
      }
      
      // Delete package-lock.json file
      const packageLockPath = path.join(pluginPath, 'package-lock.json');
      if (fs.existsSync(packageLockPath)) {
        fs.unlinkSync(packageLockPath);
        console.log(`Removed package-lock.json for plugin ${pluginName}`);
      }
      
    } catch (error) {
      console.error(`Error removing dependencies for plugin ${pluginName}:`, error);
      // Dependency removal error should not prevent deletion
      console.warn('Continuing without full dependency removal');
    }
  }

  /**
   * Return plugin dependency information
   */
  getPluginDependencies(pluginName) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      const packageJsonPath = path.join(pluginPath, 'package.json');
      
      if (!fs.existsSync(packageJsonPath)) {
        return null;
      }
      
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      return {
        dependencies: packageJson.dependencies || {},
        devDependencies: packageJson.devDependencies || {},
        hasDependencies: !!(packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0)
      };
    } catch (error) {
      console.error(`Error reading dependencies for plugin ${pluginName}:`, error);
      return null;
    }
  }
}

module.exports = PluginManager;
