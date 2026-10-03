const CronTask = require('./CronTask');
const DataManager = require('../storage/DataManager');
const crypto = require('crypto');
const { getLang } = require('../config/lang');

class CronManager {
  constructor(io, agentManager) {
    this.tasks = new Map();
    this.io = io;
    this.agentManager = agentManager;
    this.dataManager = new DataManager('./data', agentManager);
    this.lang = getLang();
    
    // Load from storage
    this.loadCronTasksFromStorage();
  }

  createTask(agentId, schedule, message, name) {
    const id = crypto.randomUUID();
    const task = new CronTask(id, agentId, schedule, message, name, this.io, this.agentManager);
    this.tasks.set(id, task);
    
    this.dataManager.saveCronTask(task);
    
    this.io.emit('cron-task-created', {
      task: task.toJSON()
    });
    
    return task;
  }

  deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.stop();
      this.tasks.delete(taskId);
      
      this.dataManager.deleteCronTask(taskId);
      
      this.io.emit('cron-task-deleted', {
        taskId: taskId
      });
      
      return true;
    }
    return false;
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map(task => task.toJSON());
  }

  startTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.start();
      return true;
    }
    return false;
  }

  stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.stop();
      return true;
    }
    return false;
  }

  pauseTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.pause();
      return true;
    }
    return false;
  }

  resumeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      try {
        // If task is in 'idle' status, call start instead of resume
        if (task.status === 'idle') {
          task.start();
          console.log(`Cron task ${taskId} was in 'idle' status, started with start()`);
        } else {
          task.resume();
        }
        // Save to storage
        this.dataManager.updateCronTask(task);
        return true;
      } catch (error) {
        console.error(`Error resuming cron task ${taskId}:`, error);
        this.io.emit('cron-task-error', {
          taskId: taskId,
          error: error.message
        });
        return false;
      }
    }
    return false;
  }

  updateTaskSchedule(taskId, newSchedule) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.updateSchedule(newSchedule);
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskMessage(taskId, newMessage) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.updateMessage(newMessage);
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskName(taskId, newName) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.name = newName;
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskAgent(taskId, newAgentId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.agentId = newAgentId;
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  getTasksByAgent(agentId) {
    return Array.from(this.tasks.values())
      .filter(task => task.agentId === agentId)
      .map(task => task.toJSON());
  }

  broadcastStatus() {
    this.io.emit('cron-tasks-status', {
      tasks: this.getAllTasks()
    });
  }

  startAll() {
    this.tasks.forEach(task => {
      if (task.status === 'idle') {
        task.start();
      }
    });
  }

  stopAll() {
    this.tasks.forEach(task => {
      task.stop();
    });
  }

  loadCronTasksFromStorage() {
    try {
      const tasksData = this.dataManager.loadCronTasks();
      
      const tasksToStart = [];
      
      tasksData.forEach(taskData => {
        const task = new CronTask(
          taskData.id,
          taskData.agentId,
          taskData.schedule,
          taskData.message,
          taskData.name,
          this.io,
          this.agentManager,
          this.dataManager
        );
        
        // Assign status correctly - only start those in 'running' status
        const savedStatus = taskData.status || 'idle';
        task.status = savedStatus;
        
        task.lastRun = taskData.lastRun;
        task.nextRun = taskData.nextRun;
        task.createdAt = taskData.createdAt;
        
        // Only tasks in 'running' status will be started
        // Tasks in 'stopped', 'paused', 'idle' status will not be started
        if (task.status === 'running') {
          task.status = 'idle'; // First make idle so start() can work
          tasksToStart.push(task.id);
          console.log(`${this.lang.t('cronTaskStarted')} ${task.id} (${this.lang.t('running')})`);
        } else {
          console.log(`${this.lang.t('taskNotStarted')} ${task.id} (${task.status})`);
        }
        
        this.tasks.set(task.id, task);
        
        // Notify web interface when task is created
        this.io.emit('cron-task-created', {
          task: task.toJSON()
        });
      });
      
      console.log(`${this.lang.t('loadedFromStorage')}: ${tasksData.length} cron tasks`);
      
      // Start tasks in running status
      if (tasksToStart.length > 0) {
        console.log(`${tasksToStart.length} ${this.lang.t('cronTaskStarted')}...`);
        tasksToStart.forEach(taskId => {
          const task = this.tasks.get(taskId);
          if (task) {
            try {
              console.log(`${this.lang.t('cronTaskStarted')} ${taskId} (${task.name}), schedule: ${task.schedule}`);
              task.start();
              console.log(`${this.lang.t('taskStarted')} ${taskId} (${task.name}), status: ${task.status}`);
              
              // Timing preservation
              if (task.preserveTiming) {
                task.preserveTiming();
              }
            } catch (err) {
              console.error(`${this.lang.t('error')} ${taskId}:`, err);
              // Set task to idle status on error
              task.status = 'idle';
            }
          } else {
            console.error(`${this.lang.t('error')} ${taskId}: ${this.lang.t('notSelected')}`);
          }
        });
      }
      
      // Broadcast status of all tasks
      this.broadcastStatus();
    } catch (error) {
      console.error(`${this.lang.t('error')} ${this.lang.t('loadingFromStorage')}:`, error);
    }
  }

  saveAllCronTasksToStorage() {
    try {
      this.dataManager.saveCronTasks(Array.from(this.tasks.values()));
    } catch (error) {
      console.error('Error saving cron tasks to storage:', error);
    }
  }

  cleanup() {
    console.log(`${this.lang.t('cleanupStarted')} CronManager`);
    
    // Stop running cron tasks and save their IDs
    const runningTaskIds = [];
    this.tasks.forEach((task, id) => {
      if (task.status === 'running') {
        runningTaskIds.push(id);
        console.log(`${this.lang.t('cronTaskStopped')} ${id} (${task.name})`);
        try {
          task.stop();
          console.log(`${this.lang.t('cronTaskStopped')} ${id} (${task.name})`);
        } catch (err) {
          console.error(`${this.lang.t('error')} ${id}:`, err);
        }
      }
    });
    
    // Save IDs of stopped tasks globally (for restart)
    global.stoppedCronTaskIds = runningTaskIds;
    console.log(`${runningTaskIds.length} ${this.lang.t('cronTaskStopped')}, IDs saved`);
    
    // Clear tasks
    this.tasks.clear();
    
    // Clear DataManager
    if (this.dataManager) {
      try {
        this.dataManager.cleanup();
      } catch (err) {
        console.error(`${this.lang.t('error')} DataManager:`, err);
      }
    }
    
    console.log(`${this.lang.t('cleanupCompleted')} CronManager`);
  }
}

module.exports = CronManager;