const cron = require('node-cron');
const { getLang } = require('../config/lang');

class CronTask {
  constructor(id, agentId, schedule, message, name, io, agentManager, dataManager = null) {
    this.id = id;
    this.agentId = agentId;
    this.schedule = schedule; // cron expression
    this.message = message;
    this.name = name;
    this.io = io;
    this.agentManager = agentManager;
    this.dataManager = dataManager;
    this.lang = getLang();
    this.status = 'idle'; // idle, running, paused, error
    this.lastRun = null;
    this.nextRun = null;
    this.task = null;
    this.createdAt = new Date().toISOString();
  }

  start() {
    if (this.status === 'running') return;
    
    try {
      // Validate cron expression
      if (!cron.validate(this.schedule)) {
        throw new Error(`Invalid cron expression: ${this.schedule}`);
      }

      this.task = cron.schedule(this.schedule, () => {
        this.execute();
      }, {
        scheduled: true,
        timezone: 'Europe/Istanbul'
      });

      this.status = 'running';
      this.nextRun = this.getNextRunTime();
      
      this.io.emit('cron-task-updated', {
        task: this.toJSON()
      });

      // Trigger save through agentManager
      if (this.agentManager && this.agentManager.dataManager) {
        this.agentManager.dataManager.updateCronTask(this);
      }

      console.log(`${this.lang.t('cronTaskStartedWithSchedule')} ${this.id}: ${this.schedule}`);
    } catch (error) {
      this.status = 'error';
      this.io.emit('cron-task-error', {
        taskId: this.id,
        error: error.message
      });
      throw error;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
    this.status = 'idle';
    this.nextRun = null;
    
    this.io.emit('cron-task-updated', {
      task: this.toJSON()
    });
    
    // Save to storage
    if (this.agentManager && this.agentManager.dataManager) {
      this.agentManager.dataManager.updateCronTask(this);
    }
    
    console.log(`${this.lang.t('cronTaskStopped')} ${this.id}`);
  }

  pause() {
    if (this.task) {
      this.task.stop();
    }
    this.status = 'paused';
    
    this.io.emit('cron-task-updated', {
      task: this.toJSON()
    });
    
    // Save to storage
    if (this.agentManager && this.agentManager.dataManager) {
      this.agentManager.dataManager.updateCronTask(this);
    }
    
    console.log(`${this.lang.t('cronTaskPaused')} ${this.id}`);
  }

  resume() {
    if (this.status === 'paused') {
      // If task object doesn't exist, restart
      if (!this.task) {
        this.start();
      } else {
        this.task.start();
        this.status = 'running';
        this.nextRun = this.getNextRunTime();
        
        this.io.emit('cron-task-updated', {
          task: this.toJSON()
        });
        
        // Save to storage
        if (this.agentManager && this.agentManager.dataManager) {
          this.agentManager.dataManager.updateCronTask(this);
        }
      }
    }
  }

  async execute() {
    console.log(`${this.lang.t('cronTaskExecuting')} ${this.id} for agent ${this.agentId}`);
    
    try {
      const agent = this.agentManager.getAgent(this.agentId);
      if (agent) {
        if (agent.status === 'stopped') {
          console.log(`${this.lang.t('cronTaskAgentStopped')} ${this.agentId}`);
          return;
        }

        this.lastRun = new Date().toISOString();
        this.status = 'executing';
        
        this.io.emit('cron-task-executing', {
          taskId: this.id,
          timestamp: this.lastRun
        });

        // Add cron task prefix to make agent understand this is a cron task
        const cronMessage = `Cron Task: ${this.name}\n\n${this.message}`;
        
        // If live mode is active, use directly or trueLiveSession queue
        const targetAgent = (agent.trueLiveSession && agent.trueLiveSession.isLiveSessionActive) ? agent.trueLiveSession : agent;
        console.log(`Cron task using queue for agent ${this.agentId}`);
        targetAgent.enqueueMessage(cronMessage, {
          source: 'cron',
          label: this.name
            ? `${this.name}: ${this.message.substring(0, 50)}`
            : this.message.substring(0, 60),
          taskName: this.name,
          taskSchedule: this.schedule,
          taskTimestamp: this.lastRun,
          originalMessage: this.message
        });
        
        this.io.emit('cron-task-executed', {
          taskId: this.id,
          agentId: this.agentId,
          message: this.message,
          taskName: this.name,
          taskSchedule: this.schedule,
          timestamp: this.lastRun
        });
      } else {
        throw new Error(`Agent ${this.agentId} not found`);
      }
    } catch (error) {
      console.error(`Cron task ${this.id} execution error:`, error);
      this.io.emit('cron-task-error', {
        taskId: this.id,
        error: error.message
      });
    } finally {
      this.status = 'running';
      this.nextRun = this.getNextRunTime();
      
      this.io.emit('cron-task-updated', {
        task: this.toJSON()
      });
    }
  }

  updateSchedule(newSchedule) {
    if (this.status === 'running') {
      this.stop();
    }
    
    this.schedule = newSchedule;
    
    if (this.status === 'running' || this.status === 'paused') {
      this.start();
    }
    
    // Save to storage
    if (this.agentManager && this.agentManager.dataManager) {
      this.agentManager.dataManager.updateCronTask(this);
    }
  }

  updateMessage(newMessage) {
    this.message = newMessage;
    
    this.io.emit('cron-task-updated', {
      task: this.toJSON()
    });
  }

  getNextRunTime() {
    if (!this.task || this.status !== 'running') return null;
    
    try {
      // Estimate next run time based on cron expression
      const task = cron.schedule(this.schedule, () => {}, { scheduled: false });
      const nextDates = task.nextDates(1);
      task.stop();
      
      return nextDates[0] ? nextDates[0].toISOString() : null;
    } catch (error) {
      return null;
    }
  }

  toJSON() {
    return {
      id: this.id,
      agentId: this.agentId,
      schedule: this.schedule,
      message: this.message,
      name: this.name,
      status: this.status,
      lastRun: this.lastRun,
      nextRun: this.nextRun,
      createdAt: this.createdAt
    };
  }
}

module.exports = CronTask;