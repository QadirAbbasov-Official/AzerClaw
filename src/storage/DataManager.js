const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

class DataManager {
  constructor(dataDir = './data', agentManager = null) {
    this.dataDir = dataDir;
    this.agentsDir = path.join(dataDir, 'agents');
    this.cronTasksFile = path.join(dataDir, 'cron-tasks.json');
    this.agentManager = agentManager;
    
    // Ensure data directory exists
    this.ensureDataDirectory();
    this.agentStateDb = new DatabaseSync(path.join(this.dataDir, 'Agent State.db'));
    this.agentStateDb.exec('PRAGMA busy_timeout = 5000');
    this.agentStateDb.exec(`CREATE TABLE IF NOT EXISTS agent_state (
      agent_id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      status TEXT NOT NULL,
      queue_json TEXT NOT NULL,
      current_message_json TEXT,
      is_true_live_mode INTEGER NOT NULL,
      is_live_session_active INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    this.saveAgentStateStatement = this.agentStateDb.prepare(`INSERT INTO agent_state
      (agent_id, agent_name, status, queue_json, current_message_json, is_true_live_mode, is_live_session_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET agent_name=excluded.agent_name, status=excluded.status,
      queue_json=excluded.queue_json, current_message_json=excluded.current_message_json,
      is_true_live_mode=excluded.is_true_live_mode, is_live_session_active=excluded.is_live_session_active,
      updated_at=excluded.updated_at`);
  }

  saveAgentState(agent, agentData) {
    this.saveAgentStateStatement.run(
      agent.id, agent.name, agentData.status, JSON.stringify(agentData.messageQueue || []),
      agent.currentMessage ? JSON.stringify(agent.currentMessage) : null,
      agentData.isTrueLiveMode ? 1 : 0, agentData.isLiveSessionActive ? 1 : 0, new Date().toISOString()
    );
  }

  loadAgentState(agentId) {
    const row = this.agentStateDb.prepare('SELECT status, queue_json, current_message_json, is_true_live_mode, is_live_session_active FROM agent_state WHERE agent_id = ?').get(agentId);
    if (!row) return null;
    return {
      status: row.status,
      messageQueue: JSON.parse(row.queue_json || '[]'),
      currentMessage: row.current_message_json ? JSON.parse(row.current_message_json) : null,
      isTrueLiveMode: Boolean(row.is_true_live_mode),
      isLiveSessionActive: Boolean(row.is_live_session_active)
    };
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
          status: agent.status || 'ready',
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
        this.saveAgentState(agent, agentData);
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
          const savedState = this.loadAgentState(agentData.id);
          if (savedState) Object.assign(agentData, savedState);
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
        status: agent.status || 'ready',
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
      this.saveAgentState(agent, agentData);
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
      this.agentStateDb.prepare('DELETE FROM agent_state WHERE agent_name = ?').run(agentName);
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
      this.agentStateDb?.close();
      console.log('DataManager successfully cleaned up');
    } catch (err) {
      console.error('Error cleaning up DataManager:', err);
    }
  }
}

module.exports = DataManager;
