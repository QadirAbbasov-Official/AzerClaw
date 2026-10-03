const fs = require('fs');
const path = require('path');

class DataManager {
  constructor(dataDir = './data', agentManager = null) {
    this.dataDir = dataDir;
    this.agentsDir = path.join(dataDir, 'agents');
    this.cronTasksFile = path.join(dataDir, 'cron-tasks.json');
    this.agentManager = agentManager;
    
    // Ensure data directory exists
    this.ensureDataDirectory();
  }

  ensureDataDirectory() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.agentsDir)) {
      fs.mkdirSync(this.agentsDir, { recursive: true });
    }
  }

  getAgentFilePath(agentName) {
    return path.join(this.agentsDir, agentName, 'agent.json');
  }

  getAgentDirPath(agentName) {
    return path.join(this.agentsDir, agentName);
  }

  // Agent Methods
  saveAgents(agents) {
    try {
      agents.forEach(agent => {
        const agentData = {
          id: agent.id,
          name: agent.name,
          prompt: agent.prompt,
          model: agent.model,
          provider: agent.provider, // Save provider information
          history: agent.history,
          session: agent.session,
          enabledTools: agent.enabledTools || [],
          createdAt: agent.createdAt || new Date().toISOString(),
          voice: agent.voice || 'Puck', // Save voice setting
          messageQueue: agent.messageQueue || [], // Save queue tasks
          isTrueLiveMode: agent.isTrueLiveMode || false, // Save true live mode status
          isLiveSessionActive: agent.isLiveSessionActive || false // Save live session status
        };

        const agentDirPath = this.getAgentDirPath(agent.name); // Use agent name
        const agentFilePath = this.getAgentFilePath(agent.name); // Use agent name

        // Create agent directory if it doesn't exist
        if (!fs.existsSync(agentDirPath)) {
          fs.mkdirSync(agentDirPath, { recursive: true });
        }

        fs.writeFileSync(agentFilePath, JSON.stringify(agentData, null, 2));
      });
      console.log(`Saved ${agents.length} agents to individual directories`);
    } catch (error) {
      console.error('Error saving agents:', error);
    }
  }

  loadAgents() {
    try {
      if (!fs.existsSync(this.agentsDir)) {
        return [];
      }
      
      const directories = fs.readdirSync(this.agentsDir);
      const agentsData = [];
      
      directories.forEach(dir => {
        const agentDirPath = path.join(this.agentsDir, dir);
        const agentFilePath = path.join(agentDirPath, 'agent.json');
        
        // Check if it's a directory and contains agent.json
        if (fs.statSync(agentDirPath).isDirectory() && fs.existsSync(agentFilePath)) {
          const data = fs.readFileSync(agentFilePath, 'utf8');
          const agentData = JSON.parse(data);
          agentsData.push(agentData);
        }
      });
      
      console.log(`Loaded ${agentsData.length} agents from individual directories`);
      return agentsData;
    } catch (error) {
      console.error('Error loading agents:', error);
      return [];
    }
  }

  saveAgent(agent) {
    try {
      const agentData = {
        id: agent.id,
        name: agent.name,
        prompt: agent.prompt,
        model: agent.model,
        provider: agent.provider, // Save provider information
        history: agent.history,
        session: agent.session,
        enabledTools: agent.enabledTools || [],
        createdAt: agent.createdAt || new Date().toISOString(),
        voice: agent.voice || 'Puck', // Save voice setting
        messageQueue: agent.messageQueue || [], // Save queue tasks
        isTrueLiveMode: agent.isTrueLiveMode || false, // Save true live mode status
        isLiveSessionActive: agent.isLiveSessionActive || false // Save live session status
      };

      const agentDirPath = this.getAgentDirPath(agent.name); // Use agent name
      const agentFilePath = this.getAgentFilePath(agent.name); // Use agent name

      // Create agent directory if it doesn't exist
      if (!fs.existsSync(agentDirPath)) {
        fs.mkdirSync(agentDirPath, { recursive: true });
      }

      fs.writeFileSync(agentFilePath, JSON.stringify(agentData, null, 2));
      console.log(`Agent ${agent.name} saved to directory ${agentDirPath} (history size: ${agent.history.length}, model: ${agent.model}, provider: ${agent.provider}, queue size: ${agent.messageQueue.length}, trueLiveMode: ${agent.isTrueLiveMode})`);
    } catch (error) {
      console.error('Error saving agent:', error);
    }
  }

  deleteAgent(agentName) {
    try {
      const agentDirPath = this.getAgentDirPath(agentName); // Use agent name
      if (fs.existsSync(agentDirPath)) {
        // Delete entire directory recursively
        fs.rmSync(agentDirPath, { recursive: true, force: true });
        console.log(`Agent ${agentName} directory deleted`);
      }
    } catch (error) {
      console.error('Error deleting agent:', error);
    }
  }

  // Cron Task Methods
  saveCronTasks(tasks) {
    try {
      const tasksData = tasks.map(task => ({
        id: task.id,
        agentId: task.agentId,
        schedule: task.schedule,
        message: task.message,
        name: task.name,
        status: task.status,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        createdAt: task.createdAt
      }));
      
      fs.writeFileSync(this.cronTasksFile, JSON.stringify(tasksData, null, 2));
      console.log('Cron tasks saved to file');
    } catch (error) {
      console.error('Error saving cron tasks:', error);
    }
  }

  loadCronTasks() {
    try {
      if (fs.existsSync(this.cronTasksFile)) {
        const data = fs.readFileSync(this.cronTasksFile, 'utf8');
        const tasksData = JSON.parse(data);
        console.log(`Loaded ${tasksData.length} cron tasks from file`);
        return tasksData;
      }
      return [];
    } catch (error) {
      console.error('Error loading cron tasks:', error);
      return [];
    }
  }

  saveCronTask(task) {
    try {
      const tasks = this.loadCronTasks();
      const existingIndex = tasks.findIndex(t => t.id === task.id);
      
      const taskData = {
        id: task.id,
        agentId: task.agentId,
        schedule: task.schedule,
        message: task.message,
        name: task.name,
        status: task.status,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
        createdAt: task.createdAt
      };
      
      if (existingIndex >= 0) {
        tasks[existingIndex] = taskData;
      } else {
        tasks.push(taskData);
      }
      
      fs.writeFileSync(this.cronTasksFile, JSON.stringify(tasks, null, 2));
      console.log(`Cron task ${task.id} saved to file`);
    } catch (error) {
      console.error('Error saving cron task:', error);
    }
  }

  deleteCronTask(taskId) {
    try {
      const tasks = this.loadCronTasks();
      const filteredTasks = tasks.filter(t => t.id !== taskId);
      fs.writeFileSync(this.cronTasksFile, JSON.stringify(filteredTasks, null, 2));
      console.log(`Cron task ${taskId} deleted from file`);
    } catch (error) {
      console.error('Error deleting cron task:', error);
    }
  }

  updateCronTask(task) {
    this.saveCronTask(task);
  }

  cleanup() {
    // DataManager cleanup - flush any pending data
    try {
      // Ensure all data is saved before cleanup
      console.log('DataManager cleaning up, saving data...');
      // Save agent data
      if (this.agentManager && this.agentManager.agents) {
        this.saveAgents(Array.from(this.agentManager.agents.values()));
      }
      console.log('DataManager successfully cleaned up');
    } catch (err) {
      console.error('Error cleaning up DataManager:', err);
    }
  }
}

module.exports = DataManager;