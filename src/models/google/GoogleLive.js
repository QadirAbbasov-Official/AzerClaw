const { GoogleGenAI, Modality, Type } = require('@google/genai');
const Agent = require('../../agents/Agent');
const lang = require('../../config/lang');

class GoogleLiveAgent extends Agent {
  constructor(id, name, prompt, io, apiKey, dataManager = null, cronManager = null, agentManager = null, model = 'gemini-3.1-flash-live-preview', voice = 'Puck') {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);
    this.apiKey = apiKey;
    this.voice = voice || 'Puck'; // Set voice for Google Live
    this.liveSession = null;
    this.isLiveSessionActive = false;
    this.clientSocket = null;
    this.mainAgent = null; // Main agent reference
    
    // Memory limit
    this.memoryLimit = 1000; // Maximum messages in history
    
    // Streaming response buffering (in GoogleAgent.js format)
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    // ===== ADVANCED CONNECTION MANAGEMENT SYSTEM =====
    // Connection status types
    this.connectionStatus = 'disconnected'; // 'connected', 'connecting', 'reconnecting', 'disconnected', 'offline'
    this.autoReconnect = true;
    this.reconnectAttempt = 0;
    this.reconnectCountdown = 0;
    this.pingMs = null;
    this.isOnline = true;
    this.disconnectReason = null;
    this.uptimeSeconds = 0;
    
    // Flags & Timers
    this.shouldMaintainConnection = false;
    this.isUserInitiatedDisconnect = false;
    this.reconnectTimeout = null;
    this.reconnectCountdownInterval = null;
    this.pingInterval = null;
    this.lastPongReceived = 0;
    this.uptimeInterval = null;
    this.isConnectingToLiveSession = false;
    
    // Network event listeners setup
    this._setupNetworkListeners();
  }
  
  // ===== NETWORK EVENT LISTENERS =====
  _setupNetworkListeners() {
    // Work only when live session is active
    if (!this.isLiveSessionActive) {
      return;
    }
    
    // Online event handler
    this.handleOnline = () => {
      this.isOnline = true;
      console.log('Internet restored. Auto-reconnecting...');
      
      if (this.shouldMaintainConnection && 
          this.connectionStatus !== 'connected' && 
          this.connectionStatus !== 'connecting') {
        
        // Clean up and reconnect
        this._clearReconnectTimers();
        this.startLiveSession(this.clientSocket, true);
      }
      
      // Frontend'e bildir
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'online',
        message: 'Internet connection restored'
      });
    };
    
    // Offline event handler
    this.handleOffline = () => {
      this.isOnline = false;
      this.connectionStatus = 'offline';
      console.log('Internet connection lost. Offline.');
      
      // Clear the state
      this._clearReconnectTimers();
      
      // Frontend'e bildir
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'offline',
        message: 'Internet connection lost. Will auto-connect when internet returns.'
      });
      
      // Close live session
      if (this.liveSession) {
        try {
          this.liveSession.close();
        } catch (error) {
          console.error('Error closing live session:', error);
        }
        this.liveSession = null;
        this.isLiveSessionActive = false;
      }
    };
    
    // Add event listeners (works in browser, needed in Node.js if required)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }
  
  // ===== RECONNECT TIMERS CLEANUP =====
  _clearReconnectTimers() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.reconnectCountdownInterval) {
      clearInterval(this.reconnectCountdownInterval);
      this.reconnectCountdownInterval = null;
    }
  }
  
  // ===== UPTIME TRACKING =====
  _startUptimeTracking() {
    this.uptimeSeconds = 0;
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
    }
    
    this.uptimeInterval = setInterval(() => {
      this.uptimeSeconds++;
      
      // Send uptime update to frontend
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: this.connectionStatus,
        uptime: this.uptimeSeconds,
        ping: this.pingMs
      });
    }, 1000);
  }
  
  _stopUptimeTracking() {
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
    this.uptimeSeconds = 0;
  }
  
  _formatUptime(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  // ===== PING/PONG HEARTBEAT SYSTEM =====
  _startHeartbeat() {
    // Google Live API already does its own connection management
    // Extra heartbeat system may not be needed, disabled to prevent conflicts
    console.log('Google Live API uses its own connection management, skipping custom heartbeat');
    this.lastPongReceived = Date.now();
    
    // Disable heartbeat - Google Live API does its own connection management
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  _stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.pingMs = null;
  }
  
  _handlePong(timestamp) {
    // Google Live API uses its own connection management so ping/pong not needed
    // But empty implementation for frontend compatibility
    console.log('Pong received (Google Live API uses its own connection management)');
    this.lastPongReceived = Date.now();
  }
  
  // ===== CONNECTION DROP HANDLER =====
  _handleConnectionDrop(reason = 'Connection dropped unexpectedly') {
    console.log(`Agent ${this.id} connection drop: ${reason}`);
    
    // Detect and update running queue task
    this._handleQueueTaskOnConnectionLost();
    
    // Clean up session (may already be closed, check)
    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error('Error closing live session:', error);
      }
      this.liveSession = null;
    }
    
    this.isLiveSessionActive = false;
    this.clientSocket = null;
    
    // Stop heartbeat and uptime
    this._stopHeartbeat();
    this._stopUptimeTracking();
    
    // Clean up network listeners
    this._cleanupNetworkListeners();
    
    // Update status
    this.status = 'ready';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'ready'
    });
    
    // Update main agent status
    if (this.mainAgent) {
      this.mainAgent.status = 'ready';
    }
    
    // Auto-reconnect if user didn't manually close
    if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
      this._startAutoReconnect(reason);
    } else {
      // User manually closed or auto-reconnect disabled
      this.connectionStatus = 'disconnected';
      this._clearReconnectTimers();
      
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'disconnected',
        message: 'Connection closed. Start microphone for voice chat.',
        reason: reason
      });
    }
  }
  
  // ===== QUEUE TASK MANAGEMENT ON CONNECTION DROP =====
  _handleQueueTaskOnConnectionLost() {
    // Find running queue task
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    
    if (processingItem) {
      console.log(`Agent ${this.id} connection lost during processing queue item: ${processingItem.id}`);
      
      // Mark task status as 'connection_lost'
      processingItem.status = 'connection_lost';
      processingItem.connectionLostAt = new Date().toISOString();
      processingItem.originalContent = processingItem.content; // Save original content
      
      // Update task content - message to be sent when connection is restored
      const langInstance = lang.getLang();
      const reconnectionMessage = `${langInstance.t('reconnectionMessage')} ${processingItem.content}`;
      
      processingItem.content = reconnectionMessage;
      processingItem.label = this.buildQueueLabel(reconnectionMessage, processingItem.source, `⚠️ Connection lost: ${processingItem.label}`);
      
      // Broadcast queue update
      this.broadcastQueueUpdate();
      
      console.log(`Agent ${this.id} queue item marked as connection_lost and will be resent on reconnection`);
    }
  }
  
  // ===== RESUBMIT QUEUE TASK ON RECONNECTION =====
  _handleQueueTaskOnReconnection() {
    // Find tasks waiting for connection restoration
    const connectionLostItems = this.messageQueue.filter(item => item.status === 'connection_lost');
    
    if (connectionLostItems.length > 0) {
      console.log(`Agent ${this.id} found ${connectionLostItems.length} connection_lost queue items to resend`);
      
      connectionLostItems.forEach(item => {
        // Update task status to 'waiting'
        item.status = 'waiting';
        item.reconnectionAttempt = (item.reconnectionAttempt || 0) + 1;
        item.reconnectedAt = new Date().toISOString();
        
        console.log(`Agent ${this.id} queue item ${item.id} marked for reprocessing (attempt #${item.reconnectionAttempt})`);
      });
      
      // Broadcast queue update
      this.broadcastQueueUpdate();
      
      // Start processing first task
      if (this.isReadyForQueue()) {
        this.processNextInQueue();
      }
    }
  }
  
  // ===== CHECK IF TASK WAS ALREADY COMPLETED =====
  _checkIfTaskAlreadyCompleted(taskContent) {
    if (!taskContent || this.history.length === 0) {
      return false;
    }
    
    // Get original task content (original task inside message added after connection drop)
    const originalTask = this._extractOriginalTask(taskContent);
    if (!originalTask) {
      return false;
    }
    
    // Check if a similar task was completed in history
    // Check last 1000 messages (for performance)
    const recentHistory = this.history.slice(-1000);
    
    for (const message of recentHistory) {
      if (message.role === 'assistant' && message.content) {
        // Check if assistant's response is related to the task
        // Simple similarity check - more advanced algorithm can be added
        if (this._isTaskRelatedToResponse(originalTask, message.content)) {
          console.log(`Agent ${this.id} task appears to be already completed based on history`);
          return true;
        }
      }
    }
    
    return false;
  }
  
  // ===== EXTRACT ORIGINAL TASK FROM CONNECTION-LOST MESSAGE =====
  _extractOriginalTask(content) {
    if (!content) return null;

    // Message format added after connection drop:
    // "This task connection dropped, now resent to you. If you see this task for the first time, do it, if you saw it before, continue from where you left, if you finished it, ignore it. Original task: {original_task}"

    const match = content.match(/Original task:\s*(.+)$/);
    if (match && match[1]) {
      return match[1].trim();
    }

    // If format not found, return original content
    return content;
  }

  // ===== QUEUE READY CHECK FOR GOOGLELIVE =====
  isReadyForQueue() {
    this.normalizeAgentStatus();
    const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing' || item.status === 'connection_lost');

    // For GoogleLive: We can process messages from queue even if live session is active
    // Because queue messages will be sent to live session
    return this.status === 'ready' && !hasProcessingItem;
  }
  
  // ===== CHECK IF TASK IS RELATED TO RESPONSE =====
  _isTaskRelatedToResponse(task, response) {
    if (!task || !response) return false;
    
    // Simple keyword matching
    const taskLower = task.toLowerCase();
    const responseLower = response.toLowerCase();
    
    // Search for keywords from task in response
    const taskWords = taskLower.split(/\s+/).filter(word => word.length > 3); // Words longer than 3 characters
    
    let matchCount = 0;
    for (const word of taskWords) {
      if (responseLower.includes(word)) {
        matchCount++;
      }
    }
    
    // Assume task is related if more than 50% of words match
    const threshold = Math.max(2, Math.floor(taskWords.length * 0.5));
    return matchCount >= threshold;
  }
  
  // ===== AUTO-RECONNECT MECHANISM =====
  _startAutoReconnect(reason) {
    if (this.isUserInitiatedDisconnect || !this.shouldMaintainConnection) {
      console.log(`Agent ${this.id} skipping auto-reconnect (disconnect was intentional or connection maintenance disabled)`);
      return;
    }

    if (!this.isOnline) {
      this.connectionStatus = 'offline';
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'offline',
        message: 'Internet connection lost. Offline.',
        reason: reason
      });
      return;
    }
    
    this.connectionStatus = 'reconnecting';
    const nextAttempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = nextAttempt;
    
    // Update agent status: "waiting" while reconnecting
    this.status = 'waiting';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'waiting'
    });
    
    // Update main agent status
    if (this.mainAgent) {
      this.mainAgent.status = 'waiting';
    }
    
    // Backoff delay: 2s, 3s, 4s, 5s (capped at 6s)
    const delaySec = Math.min(2 + (nextAttempt - 1), 6);
    this.reconnectCountdown = delaySec;
    
    this.io.emit('live-connection-status', {
      agentId: this.id,
      status: 'reconnecting',
      message: `Connection dropped. Auto-reconnecting in ${delaySec} seconds (Attempt #${nextAttempt})...`,
      countdown: this.reconnectCountdown,
      attempt: nextAttempt,
      reason: reason
    });
    
    // Start countdown
    if (this.reconnectCountdownInterval) {
      clearInterval(this.reconnectCountdownInterval);
    }
    
    let count = delaySec;
    this.reconnectCountdownInterval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(this.reconnectCountdownInterval);
        this.reconnectCountdownInterval = null;
      } else {
        this.reconnectCountdown = count;
        this.io.emit('live-connection-status', {
          agentId: this.id,
          status: 'reconnecting',
          message: `Connection dropped. Auto-reconnecting in ${count} seconds (Attempt #${nextAttempt})...`,
          countdown: count,
          attempt: nextAttempt
        });
      }
    }, 1000);
    
    // Reconnect with timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      console.log(`Auto-reconnect executing (Attempt #${nextAttempt})...`);
      this.startLiveSession(this.clientSocket, true);
    }, delaySec * 1000);
  }

  async _executeModelMessage(content, options = {}) {
    // Send messages from queue system to live session
    console.log(`Agent ${this.id} _executeModelMessage called with content: ${content}`);
    console.log(`Agent ${this.id} source: ${options.source}`);
    console.log(`Agent ${this.id} live session active: ${this.isLiveSessionActive}`);
    console.log(`Agent ${this.id} live session exists: ${!!this.liveSession}`);
    
    // Check for tasks coming from connection drop
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem && processingItem.reconnectionAttempt > 0) {
      console.log(`Agent ${this.id} processing reconnection task (attempt #${processingItem.reconnectionAttempt})`);
      
      // Check if task was already completed
      // Check if there is a similar task in history
      const isAlreadyCompleted = this._checkIfTaskAlreadyCompleted(processingItem.originalContent || processingItem.content);
      
      if (isAlreadyCompleted) {
        console.log(`Agent ${this.id} task was already completed, skipping reconnection task`);
        // Mark task as completed and skip
        this.completeCurrentQueueItem();
        return;
      }
    }
    
    // History and frontend updates are done in base Agent.js, this is empty
    // We don't add to history to prevent duplicate messages
    
    if (this.liveSession && this.isLiveSessionActive) {
      console.log(`Agent ${this.id} sending queued message to live session`);

      try {
        // Send to live session (preserving cron format)
        this.liveSession.sendRealtimeInput({
          text: content // Send message in cron format
        });
        console.log(`Agent ${this.id} queued message sent successfully with cron format`);

        // Message sent but live session will respond asynchronously
        // completeCurrentQueueItem will be called in generationComplete
      } catch (error) {
        console.error(`Agent ${this.id} error sending queued message:`, error);
        // Complete queue task on error
        this.completeCurrentQueueItem();
      }
    } else {
      console.log(`Agent ${this.id} no active live session, cannot send queued message`);
      console.log(`Agent ${this.id} waiting for live session to be active`);
      // If no session, DON'T complete queue task - keep waiting
      // Leave task in waiting state, will be retried when session is active

      // Complete queue task on error
      if (options.source === 'cron') {
        console.log(`Agent ${this.id} cron task cannot be executed without live session, completing queue item`);
        this.completeCurrentQueueItem();
        this.processNextInQueue();
      }
    }
  }

  completeCurrentQueueItem() {
    console.log(`Agent ${this.id} completeCurrentQueueItem called`);
    console.log(`Agent ${this.id} queue before:`, this.messageQueue.map(item => ({ id: item.id, status: item.status })));

    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem) {
      console.log(`Agent ${this.id} marking item as completed: ${processingItem.id}`);
      processingItem.status = 'completed';
    }

    this.messageQueue = this.messageQueue.filter(item => item.status !== 'completed');
    console.log(`Agent ${this.id} queue after filtering, length: ${this.messageQueue.length}`);
    console.log(`Agent ${this.id} queue after:`, this.messageQueue.map(item => ({ id: item.id, status: item.status })));

    // Update and broadcast main agent's queue
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
      console.log(`Agent ${this.id} updated main agent queue and broadcasted`);

      // Update main agent's history
      this.mainAgent.history = this.history;
      if (this.mainAgent.dataManager) {
        this.mainAgent.dataManager.saveAgent(this.mainAgent);
      }
    } else {
      // If the main agent is unavailable, broadcast and save locally
      this.broadcastQueueUpdate();
      console.log(`Agent ${this.id} broadcasted queue update (no main agent)`);

      // Save to storage
      if (this.dataManager) {
        console.log(`Agent ${this.id} saving agent to storage`);
        try {
          this.dataManager.saveAgent(this);
          console.log(`Agent ${this.id} agent saved to storage successfully`);
        } catch (error) {
          console.error(`Agent ${this.id} error saving agent to storage:`, error);
        }
      }
    }

    // Check if there are other waiting or running tasks in queue
    const hasMoreItems = this.messageQueue.some(item => item.status === 'waiting' || item.status === 'processing');

    if (hasMoreItems) {
      // Automatically process next task (only if live session is active)
      if (this.isLiveSessionActive) {
        setTimeout(() => {
          this.processNextInQueue();
        }, 100);
      }
    } else {
      // All tasks completed!
      if (!this.isTrueLiveMode) {
        this.status = 'ready';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'ready'
        });
        if (this.mainAgent) {
          this.mainAgent.status = 'ready';
        }

        // If True Live mode is off, automatically close session
        if (this.isLiveSessionActive) {
          console.log(`Agent ${this.id} all queue tasks completed and True Live mode is OFF. Closing live session automatically.`);
          setTimeout(() => {
            this.stopLiveSession(true);
          }, 100);
        }
      } else {
        // If True Live mode is on, keep status as live
        this.status = 'live';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'live'
        });
        if (this.mainAgent) {
          this.mainAgent.status = 'live';
        }
      }
    }
  }

  processNextInQueue() {
    console.log(`Agent ${this.id} processNextInQueue called`);
    console.log(`Agent ${this.id} queue length: ${this.messageQueue.length}`);
    console.log(`Agent ${this.id} queue items:`, this.messageQueue.map(item => ({ id: item.id, status: item.status, label: item.label })));
    
    // If there is a currently running task, don't move to next (guarantee sequential execution)
    const currentlyProcessing = this.messageQueue.some(item => item.status === 'processing');
    if (currentlyProcessing) {
      console.log(`Agent ${this.id} queue item is already processing, waiting for it to complete`);
      return;
    }

    const nextItem = this.messageQueue.find(item => item.status === 'waiting');
    if (nextItem) {
      console.log(`Agent ${this.id} found waiting item: ${nextItem.id}, marking as processing`);
      nextItem.status = 'processing';
      nextItem.startedAt = new Date().toISOString();
      
      // Keep status as "live" in live mode
      this.status = 'live';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'live'
      });
      
      // Update main agent status
      if (this.mainAgent) {
        this.mainAgent.status = 'live';
      }
      
      // Update main agent's queue
      if (this.mainAgent) {
        this.mainAgent.messageQueue = this.messageQueue;
        this.mainAgent.broadcastQueueUpdate();
      } else {
        this.broadcastQueueUpdate();
      }
      
      // Send to live session
      this._executeModelMessage(nextItem.content, {
        source: nextItem.source,
        taskName: nextItem.taskName,
        taskSchedule: nextItem.taskSchedule,
        taskTimestamp: nextItem.taskTimestamp,
        senderAgentId: nextItem.senderAgentId,
        senderAgentName: nextItem.senderAgentName,
        originalMessage: nextItem.originalMessage
      });
    } else {
      console.log(`Agent ${this.id} no waiting item found in queue`);

      // Keep status as "live" in live mode
      this.status = 'live';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'live'
      });

      // Update main agent status
      if (this.mainAgent) {
        this.mainAgent.status = 'live';
        this.mainAgent.io.emit('agent-status', {
          agentId: this.mainAgent.id,
          status: 'live'
        });
      }
    }
  }
  
  // Override enqueueMessage to auto-process when live session is active
  enqueueMessage(content, options = {}) {
    if (this.status === 'stopped') {
      console.log(`Agent ${this.id} is stopped, message cannot be queued.`);
      return null;
    }

    this.normalizeAgentStatus();

    const source = options.source || 'user';
    const item = {
      id: crypto.randomUUID(),
      content,
      source,
      label: this.buildQueueLabel(content, source, options.label),
      status: 'waiting',
      addedAt: new Date().toISOString(),
      taskName: options.taskName,
      taskSchedule: options.taskSchedule,
      taskTimestamp: options.taskTimestamp,
      senderAgentId: options.senderAgentId,
      senderAgentName: options.senderAgentName,
      originalMessage: options.originalMessage
    };

    this.messageQueue.push(item);
    this.broadcastQueueUpdate();

    // Update main agent's queue
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
    }

    // If live session is currently starting, don't interfere with message (will be processed when session opens)
    if (this.isConnectingToLiveSession) {
      console.log(`Agent ${this.id} live session is connecting, item queued`);
      return item.id;
    }

    // If live session is not active, automatically start live session to process task
    if (!this.isLiveSessionActive) {
      console.log(`Agent ${this.id} live session not active, starting automatic live session for queued item`);
      this.isConnectingToLiveSession = true;
      this.startLiveSession(this.clientSocket).finally(() => {
        this.isConnectingToLiveSession = false;
      }).catch(err => {
        console.error(`Agent ${this.id} error starting automatic live session:`, err);
      });
    } else {
      const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing');
      if (!hasProcessingItem) {
        console.log(`Agent ${this.id} live session active and no processing item, auto-processing queue item`);
        setTimeout(() => {
          this.processNextInQueue();
        }, 100);
      } else {
        console.log(`Agent ${this.id} live session active but has processing item, item will wait`);
      }
    }

    return item.id;
  }
  
  // API Key update (called by AgentManager)
  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log(`GoogleLiveAgent ${this.id} API key updated:`, newApiKey ? '***SET***' : '***EMPTY***');
  }

  async start() {
    await super.start();
    console.log(`GoogleLiveAgent ${this.id} started (ready for live session)`);
    
    // Don't start queue processor - we will use main agent's queue
  }

  async startLiveSession(clientSocket, isAutoReconnect = false) {
    try {
      if (this.isLiveSessionActive) {
        console.log(`Agent ${this.id} live session already active`);

        // If there is a backend restoration session and now client socket arrived,
        // update client socket
        if (!this.clientSocket && clientSocket) {
          console.log(`Agent ${this.id} updating client socket for existing backend restoration session`);
          this.clientSocket = clientSocket;
        }

        this.isConnectingToLiveSession = false;
        return true; // Already active, count as success
      }

      // Start session even if no socket for backend restoration
      const isBackendRestoration = !clientSocket;
      if (isBackendRestoration) {
        console.log(`Agent ${this.id} starting live session for backend restoration (no client socket)`);
      }

      // Auto-reconnect olmayan durumlarda reset
      if (!isAutoReconnect) {
        this.reconnectAttempt = 0;
        this.disconnectReason = null;
        this.isUserInitiatedDisconnect = false;
      } else {
        // Process tasks from connection drop in auto-reconnect situation
        this._handleQueueTaskOnReconnection();
      }
      
      // Clear reconnect timers
      this._clearReconnectTimers();

      // Connection ayarla
      this.shouldMaintainConnection = true;
      this.connectionStatus = isAutoReconnect ? 'reconnecting' : 'connecting';
      
      // Update agent status: "waiting" while reconnecting
      this.status = 'waiting';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'waiting'
      });
      
      // Update main agent status
      if (this.mainAgent) {
        this.mainAgent.status = 'waiting';
      }
      
      // Notify frontend about connecting
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: this.connectionStatus,
        message: isAutoReconnect ? 'Reconnecting...' : 'Connecting...'
      });


      console.log(`Agent ${this.id} starting Google Live session`);

      const ai = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Prepare tool definitions
      const tools = this._getToolDeclarations();

      // Prepare system prompt
      const systemInstruction = this._buildSystemInstruction();

      // Start Google Live session (like in test code)
      const session = await ai.live.connect({
        model: this.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemInstruction,
          tools: tools
        },
        callbacks: {
          onmessage: async (message) => {
            // Process messages even if no socket for backend restoration
            if (clientSocket) {
              await this._handleLiveMessage(message, clientSocket);
            } else {
              // Normal message processing for backend restoration
              await this._handleLiveMessage(message, null);
            }
          },
          onerror: (err) => {
            console.warn('Gemini Live session error:', err?.message || err);
            // Google Live API manages its own connection, start auto-reconnect on error
            if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
              console.log('Google Live API error detected, triggering auto-reconnect...');
              this._handleConnectionDrop('Gemini Live stream connection lost: ' + (err?.message || 'Session error'));
            }
          },
          onclose: (closeEvt) => {
            console.log('Gemini Live session closed:', closeEvt);
            // Google Live API manages its own connection, start auto-reconnect on close
            if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
              console.log('Google Live API close detected, triggering auto-reconnect...');
              this._handleConnectionDrop('Gemini Live session ended');
            }
          }
        }
      });

      this.liveSession = session;
      this.clientSocket = clientSocket; // Can be null for backend restoration
      this.isLiveSessionActive = true;
      this.connectionStatus = 'connected';
      this.reconnectCountdown = 0;
      this.reconnectAttempt = 0;
      this.disconnectReason = null;

      console.log(`Agent ${this.id} live session established, clientSocket: ${clientSocket ? 'provided' : 'backend restoration'}`);

      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      console.log(`Agent ${this.id} Google Live session started successfully`);

      // Update agent status: "live" when connection successful
      this.status = 'live';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'live'
      });
      
      // Update main agent status
      if (this.mainAgent) {
        this.mainAgent.status = 'live';
      }
      
      // Frontend'e bildir
      this.io.emit('live-session-started', { agentId: this.id });
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'connected',
        message: 'You can talk with Gemini Live! It hears you at all times.',
        uptime: 0,
        ping: null
      });
      
      // Start heartbeat and uptime
      this._startHeartbeat();
      this._startUptimeTracking();
      
      // Start network listeners (only when live session is active)
      this._setupNetworkListeners();
      
      // Process waiting tasks in queue (only those in waiting state)
      const waitingItems = this.messageQueue.filter(item => item.status === 'waiting');
      if (waitingItems.length > 0) {
        console.log(`Agent ${this.id} processing ${waitingItems.length} waiting queued items after session start`);
        // Start queue processing with delay so session is fully stable
        setTimeout(() => {
          this.processNextInQueue();
        }, 1000);
      } else {
        console.log(`Agent ${this.id} no waiting items in queue, skipping queue processing`);
      }
      
      // If main agent exists, synchronize its queue
      if (this.mainAgent) {
        this.mainAgent.messageQueue = this.messageQueue;
        this.mainAgent.broadcastQueueUpdate();
      }

      this.isConnectingToLiveSession = false;
      return true; // Successfully connected

    } catch (error) {
      this.isConnectingToLiveSession = false;
      console.error(`Agent ${this.id} error starting live session:`, error);
      
      // Update status: ready
      this.status = 'ready';
      this.connectionStatus = 'disconnected';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'ready'
      });
      
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'disconnected',
        message: 'Connection error: ' + error.message,
        error: error.message
      });
      
      // Auto-reconnect denemesi
      if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
        this._startAutoReconnect(error.message);
      }
      
      throw error;
    }
  }

  stopLiveSession(force = false, suppressStatusEvents = false) {
    if (!this.isLiveSessionActive) {
      return;
    }

    // Session closing (user or automatic completion)
    this.isUserInitiatedDisconnect = true;
    this.shouldMaintainConnection = false;
    this._clearReconnectTimers();

    // Queue check: if not force and there are tasks in queue, prevent closing
    const hasQueueItems = this.messageQueue.some(item => item.status === 'waiting' || item.status === 'processing');
    if (hasQueueItems && !force) {
      console.log(`Agent ${this.id} cannot switch to normal mode - live queue has tasks`);
      this.io.emit('agent-error', {
        agentId: this.id,
        error: 'Cannot switch to normal mode - Live has tasks in queue. Complete all tasks first.'
      });
      return;
    }

    console.log(`Agent ${this.id} stopping Google Live session (user initiated)`);

    // Clear buffer
    if (this.textTimeout) {
      clearTimeout(this.textTimeout);
      this.textTimeout = null;
    }
    if (this.textBuffer && this.textBuffer.trim()) {
      // Send text from buffer
      this.history.push({
        role: 'assistant',
        content: this.textBuffer,
        timestamp: new Date().toISOString()
      });

      this.io.emit('agent-message', {
        agentId: this.id,
        message: {
          content: this.textBuffer,
          role: 'assistant',
          timestamp: new Date().toISOString()
        }
      });
      this.textBuffer = '';
    }

    // Stop heartbeat and uptime
    this._stopHeartbeat();
    this._stopUptimeTracking();
    
    // Clear reconnect timers
    this._clearReconnectTimers();
    
    // Clean up network listeners
    this._cleanupNetworkListeners();

    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error(`Error closing live session:`, error);
      }
      this.liveSession = null;
    }

    this.isLiveSessionActive = false;
    this.clientSocket = null;
    this.connectionStatus = 'disconnected';

    // Update status: ready
    this.status = 'ready';
    if (!suppressStatusEvents) {
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'ready'
      });
    }

    // Update main agent status
    if (this.mainAgent) {
      this.mainAgent.status = 'ready';
    }

    this.clientSocket = null;
    this.isLiveSessionActive = false;

    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }

    console.log(`Agent ${this.id} Google Live session stopped (user initiated)`);

    // Frontend'e bildir
    if (!suppressStatusEvents) {
      this.io.emit('live-session-stopped', { agentId: this.id });
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'disconnected',
        message: 'Connection closed. Start microphone for voice chat.'
      });
    }
    
    // Don't clear waiting tasks - keep for normal mode transition
    // Update main agent's queue (clearing)
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
      
      // Update main agent's history
      this.mainAgent.history = this.history;
      if (this.mainAgent.dataManager) {
        this.mainAgent.dataManager.saveAgent(this.mainAgent);
      }
    }
  }

  // ===== TRUE LIVE MODE ALIAS METHODS =====
  // AgentManager expects these methods. True Live and normal Live use the same Google Live API.
  
  setTrueLiveMode(enabled) {
    // Enable/disable True Live mode (flag)
    this.isTrueLiveMode = enabled;
    this.trueLiveMode = enabled;
    console.log(`Agent ${this.id} True Live mode set to: ${enabled}`);

    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }
  }

  async startTrueLiveSession(clientSocket) {
    // True Live session = normal Live session
    return await this.startLiveSession(clientSocket || this.clientSocket);
  }

  stopTrueLiveSession() {
    // Stopping True Live is the same as stopping normal Live.
    this.stopLiveSession();
  }

  handleTrueLiveAudioInput(audioData) {
    // True Live ses girdisi = normal ses girdisi
    this.handleLiveAudioInputFromClient(audioData);
  }

  handleTrueLiveTextInput(text) {
    // True Live metin girdisi = normal metin girdisi
    this.handleLiveTextInput(text);
  }

  handleLiveAudioInput(audioData) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping audio input`);
      return;
    }

    try {
      // Send audio directly like in test code
      this.liveSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: "audio/pcm;rate=16000"
        }
      });
    } catch (error) {
      console.error(`Error sending audio to live session:`, error);
    }
  }

  handleLiveAudioInputFromClient(audioData) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping audio input`);
      return;
    }

    try {
      // Send base64 audio data from client
      this.liveSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: "audio/pcm;rate=16000"
        }
      });
    } catch (error) {
      console.error(`Error sending audio to live session:`, error);
    }
  }

  handleLiveTextInput(text, options = {}) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping text input`);
      return;
    }

    console.log(`Agent ${this.id} handling text input: ${text.substring(0, 50)}...`);

    try {
      // Determine role (same logic as normal mode)
      let messageRole = 'user';
      if (options.source === 'cron') {
        messageRole = 'cron';
      } else if (options.source === 'agent') {
        messageRole = 'agent';
      }
      
      // Determine message content (preserve cron format)
      const messageContent = text; // text already comes in cron format
      
      // Add to history (with correct role)
      const userMessage = {
        role: messageRole,
        content: messageContent,
        timestamp: new Date().toISOString(),
        source: options.source || 'user',
        taskName: options.taskName,
        taskSchedule: options.taskSchedule,
        taskTimestamp: options.taskTimestamp,
        senderAgentId: options.senderAgentId,
        senderAgentName: options.senderAgentName,
        originalMessage: options.originalMessage
      };
      this.history.push(userMessage);
      this.sortHistoryByTimestamp();
      this.applyMemoryLimit();
      
      // Send to live session (preserving cron format)
      console.log(`Agent ${this.id} sending text to live session: ${messageContent.substring(0, 50)}...`);
      this.liveSession.sendRealtimeInput({
        text: messageContent
      });
      console.log(`Agent ${this.id} text sent successfully`);
      
      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Send agent-message event to frontend (to show in chat - with correct role)
      this.io.emit('agent-message', {
        agentId: this.id,
        message: userMessage
      });
      
      // Update main agent's history
      if (this.mainAgent) {
        this.mainAgent.history = this.history;
        if (this.mainAgent.dataManager) {
          this.mainAgent.dataManager.saveAgent(this.mainAgent);
        }
      }
    } catch (error) {
      console.error(`Error sending text to live session:`, error);
    }
  }
  
  // ===== PONG HANDLER (for pong messages from frontend) =====
  handlePong(timestamp) {
    this._handlePong(timestamp);
  }
  
  // ===== AUTO-RECONNECT CONTROL =====
  setAutoReconnect(enabled) {
    this.autoReconnect = enabled;
    console.log(`Agent ${this.id} auto-reconnect ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  // ===== CLEANUP NETWORK LISTENERS =====
  _cleanupNetworkListeners() {
    if (typeof window !== 'undefined') {
      if (this.handleOnline) {
        window.removeEventListener('online', this.handleOnline);
      }
      if (this.handleOffline) {
        window.removeEventListener('offline', this.handleOffline);
      }
    }
  }
  
  // ===== MANUAL RECONNECT =====
  async manualReconnect() {
    console.log(`Agent ${this.id} manual reconnect requested`);
    this.isUserInitiatedDisconnect = false;
    this.shouldMaintainConnection = true;
    this.reconnectAttempt = 0;
    this.disconnectReason = null;
    
    // First close existing session
    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error('Error closing live session for manual reconnect:', error);
      }
      this.liveSession = null;
    }
    
    this.isLiveSessionActive = false;
    this._clearReconnectTimers();
    
    // Reconnect
    return await this.startLiveSession(this.clientSocket, true);
  }

  async _handleLiveMessage(message, clientSocket) {
    // Check audio content - Only forward audio data to client if True Live mode is active
    const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audio && this.isTrueLiveMode) {
      // Send base64 audio data directly
      this.io.emit('live-audio-response', { agentId: this.id, audioData: audio });
    }

    // Log for backend restoration
    if (!clientSocket) {
      console.log(`Agent ${this.id} handling message in backend restoration mode`);
    }

    // Check text content
    const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
    if (text) {
      console.log(`Agent ${this.id} received text chunk, current status: ${this.status}`);
      
      // Streaming buffer in GoogleAgent.js format
      if (!this.isStreamingResponse) {
        this.isStreamingResponse = true;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = new Date().toISOString();
        
        // Keep status as "live" in live mode, not "taskWorking"
        this.status = 'live';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'live'
        });
        
        // Update main agent status
        if (this.mainAgent) {
          this.mainAgent.status = 'live';
        }
        
        console.log(`Agent ${this.id} status kept as Live (live mode)`);
      }

      // Add chunk to streaming buffer
      this.currentResponseBuffer += text;

      // Stream text to client for real-time display (GoogleAgent.js format)
      this.io.emit('agent-stream', {
        agentId: this.id,
        chunk: text,
        timestamp: this.currentResponseStartTime
      });

      // Save each chunk to history for persistence (GoogleAgent.js format)
      this.history.push({
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
        isStreamChunk: true,
        streamStartTime: this.currentResponseStartTime
      });

      // Apply memory limit (less frequent for streaming)
      if (this.history.length % 10 === 0) {
        this.applyMemoryLimit();
      }

      // Save to storage after each chunk
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Don't send agent-message - only use agent-stream
      // Frontend already processes and merges stream events
    }

    // Check user speech transcript
    const inputTrans = message.serverContent?.inputTranscription?.text;
    if (inputTrans) {
      // Add to speech history (user role since it's user voice input)
      const userMessage = {
        role: 'user',
        content: inputTrans,
        timestamp: new Date().toISOString(),
        source: 'user' // Voice inputs are always user source
      };
      this.history.push(userMessage);
      
      // Sort history and apply memory limit
      this.sortHistoryByTimestamp();
      this.applyMemoryLimit();
      
      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      // Send in normal agent message format
      this.io.emit('agent-message', {
        agentId: this.id,
        message: userMessage
      });
    }

    // Check model speech transcript
    const geminiTrans = message.serverContent?.outputTranscription?.text;
    if (geminiTrans) {
      console.log(`Agent ${this.id} received audio transcription, current status: ${this.status}`);
      
      // Streaming buffer in GoogleAgent.js format
      if (!this.isStreamingResponse) {
        this.isStreamingResponse = true;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = new Date().toISOString();
        
        // Update status: taskWorking
        this.status = 'taskWorking';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'taskWorking'
        });
        
        // Update main agent status
        if (this.mainAgent) {
          this.mainAgent.status = 'taskWorking';
        }
        
        console.log(`Agent ${this.id} status changed to taskWorking (audio)`);
      }

      // Add chunk to streaming buffer
      this.currentResponseBuffer += geminiTrans;

      // Stream text to client for real-time display (GoogleAgent.js format)
      this.io.emit('agent-stream', {
        agentId: this.id,
        chunk: geminiTrans,
        timestamp: this.currentResponseStartTime
      });

      // Save each chunk to history for persistence (GoogleAgent.js format)
      this.history.push({
        role: 'assistant',
        content: geminiTrans,
        timestamp: new Date().toISOString(),
        isStreamChunk: true,
        streamStartTime: this.currentResponseStartTime
      });

      // Apply memory limit (less frequent for streaming)
      if (this.history.length % 10 === 0) {
        this.applyMemoryLimit();
      }

      // Save to storage after each chunk
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Don't send agent-message - only use agent-stream
      // Frontend already processes and merges stream events
    }

    // Check interruption
    if (message.serverContent?.interrupted) {
      // Reset streaming buffer (GoogleAgent.js format)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
      
      // Save remaining text in buffer to history
      if (this.currentResponseBuffer && this.currentResponseBuffer.trim()) {
        const assistantMessage = {
          role: 'assistant',
          content: this.currentResponseBuffer,
          timestamp: new Date().toISOString()
        };
        this.history.push(assistantMessage);
        
        // Sort history and apply memory limit
        this.sortHistoryByTimestamp();
        this.applyMemoryLimit();
        
        // Save to storage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }

        this.io.emit('agent-message', {
          agentId: this.id,
          message: assistantMessage
        });
      }
      
      this.io.emit('live-interrupted', { agentId: this.id });
    }

    // Check for turn complete (GoogleAgent.js format)
    if (message.serverContent?.turnComplete) {
      console.log(`Agent ${this.id} turn complete, changing status to live`);
      
      // Reset streaming buffer (GoogleAgent.js format)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
      
      // Update status: live (speech ended, session still open)
      this.status = 'live';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'live'
      });
      
      // Update main agent status
      if (this.mainAgent) {
        this.mainAgent.status = 'live';
      }
      
      // If there is a task in processing state in queue, complete it and move to next
      const processingItem = this.messageQueue.find(item => item.status === 'processing');
      if (processingItem) {
        console.log(`Agent ${this.id} found processing item in queue: ${processingItem.id}, completing it`);
        this.completeCurrentQueueItem();
      } else {
        console.log(`Agent ${this.id} no processing item found in queue`);
      }
    }

    // Check for generation complete (GoogleAgent.js format)
    if (message.serverContent?.generationComplete) {
      console.log(`Agent ${this.id} generation complete`);
      
      // Reset streaming buffer (GoogleAgent.js format)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
    }

    // Check tool call
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        await this._handleToolCall(call, clientSocket);
      }
    }
  }

  async _handleToolCall(call, clientSocket) {
    const { name, args, id } = call;
    const callId = id || `call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    console.log(`TOOL CALL from Gemini: ${name}`, args);

    // Auto-add senderAgentId for sendMessageToAgent
    let toolArgs = args;
    if ((name === 'sendMessageToAgent' || name === 'agent.sendMessageToAgent') && !toolArgs.senderAgentId) {
      toolArgs = { ...toolArgs, senderAgentId: this.id };
    }

    // Report tool usage (normal mode format)
    this.io.emit('agent-tool-usage', {
      agentId: this.id,
      toolUsage: {
        tool: name,
        args: toolArgs,
        result: null
      }
    });

    // Execute tool
    let output;
    let error = null;
    try {
      // Execute via ToolManager (both normal and plugin tools)
      if (this.toolManager) {
        output = await this.toolManager.executeTool(name, toolArgs, this);
      } else {
        output = { success: false, message: 'ToolManager not available' };
        error = 'ToolManager not available';
      }
    } catch (err) {
      console.error(`Error executing tool ${name}:`, err);
      output = { success: false, message: err.message };
      error = err.message;
    }

    // Save tool result to history (GoogleAgent format)
    if (error) {
      // Error case
      const toolErrorMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        toolUsage: {
          tool: name,
          args: args,
          error: error,
          type: 'error'
        }
      };
      this.history.push(toolErrorMessage);
      
      // Sort history to maintain correct order
      this.sortHistoryByTimestamp();
      
      // Apply memory limit
      this.applyMemoryLimit();
      
      // Save to storage after tool error
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Report tool error (GoogleAgent format)
      this.io.emit('agent-tool-result', {
        agentId: this.id,
        toolUsage: {
          tool: name,
          args: args,
          result: { error: error },
          timestamp: toolErrorMessage.timestamp
        }
      });
      
      // Send tool error to Google Live (GoogleAgent format)
      try {
        await this.liveSession.sendToolResponse({
          functionResponses: [{
            id: id,
            name: name,
            response: { error: error }
          }]
        });
      } catch (sendError) {
        console.error(`Error sending tool error response to Gemini:`, sendError);
      }
    } else {
      // Success case
      const toolResultMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        toolUsage: {
          tool: name,
          args: args,
          result: output,
          type: 'result'
        }
      };
      this.history.push(toolResultMessage);
      
      // Sort history to maintain correct order
      this.sortHistoryByTimestamp();
      
      // Apply memory limit
      this.applyMemoryLimit();
      
      // Save to storage after tool execution
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      // Report tool result (GoogleAgent format)
      this.io.emit('agent-tool-result', {
        agentId: this.id,
        toolUsage: {
          tool: name,
          args: args,
          result: output,
          timestamp: toolResultMessage.timestamp
        }
      });

      // Send tool result to Google Live (GoogleAgent format)
      try {
        await this.liveSession.sendToolResponse({
          functionResponses: [{
            id: id,
            name: name,
            response: { response: output }
          }]
        });
      } catch (sendError) {
        console.error(`Error sending tool response to Gemini:`, sendError);
      }
    }
  }

  _buildSystemInstruction() {
    let instruction = `${this.prompt || ''}${this.getAdminProfileContext()}`;

    // Add conversation history (last 1000 messages)
    if (this.history && this.history.length > 0) {
      const recentHistory = this.history.slice(-1000);
      instruction += '\n\nPrevious conversation history:\n';
      recentHistory.forEach(msg => {
        instruction += `${msg.role}: ${msg.content}\n`;
      });
    }



    return instruction;
  }

  _getToolDeclarations() {
    const tools = [];

    console.log(`Agent ${this.id} getting tool declarations`);
    console.log(`Agent ${this.id} toolManager exists: ${!!this.toolManager}`);
    console.log(`Agent ${this.id} toolManager.tools size: ${this.toolManager?.tools?.size || 0}`);

    // Get tools from ToolManager (including plugin tools)
    if (this.toolManager) {
      // Normal tool'lar
      if (this.toolManager.tools) {
        for (const [toolName, tool] of this.toolManager.tools) {
          if (!this.toolManager.isToolEnabled(toolName)) continue;
          console.log(`Agent ${this.id} checking tool: ${toolName}, has definition: ${!!tool.definition}`);
          if (tool.definition) {
            tools.push({
              functionDeclarations: [
                {
                  name: toolName,
                  description: tool.definition.description || '',
                  parameters: tool.definition.parameters || {
                    type: Type.OBJECT,
                    properties: {},
                    required: []
                  }
                }
              ]
            });
            console.log(`Agent ${this.id} added tool declaration: ${toolName}`);
          }
        }
      }

      // Plugin tools
      if (this.toolManager.pluginManager && this.toolManager.pluginManager.plugins) {
        console.log(`Agent ${this.id} checking plugin tools, plugins count: ${Object.keys(this.toolManager.pluginManager.plugins).length}`);
        for (const [pluginName, plugin] of this.toolManager.pluginManager.plugins) {
          if (plugin.enabled && plugin.tools) {
            // Plugin tools is an object, not an array
            for (const [toolName, tool] of Object.entries(plugin.tools)) {
              if (!this.toolManager.isToolEnabled(`${pluginName}.${toolName}`)) continue;
              if (tool && tool.description && tool.parameters) {
                tools.push({
                  functionDeclarations: [
                    {
                      name: `${pluginName}.${toolName}`, // Use fullName (plugin.toolName format)
                      description: tool.description || '',
                      parameters: tool.parameters || {
                        type: Type.OBJECT,
                        properties: {},
                        required: []
                      }
                    }
                  ]
                });
                console.log(`Agent ${this.id} added plugin tool declaration: ${pluginName}.${toolName}`);
              }
            }
          }
        }
      }
    }

    console.log(`Agent ${this.id} total tool declarations: ${tools.length}`);
    return tools;
  }

  async _executeModelMessage(content, options = {}) {
    // GoogleLiveAgent ONLY works in live mode, doesn't work in normal mode
    console.log(`GoogleLiveAgent ${this.id} _executeModelMessage called`);
    
    // If live session is active, send there
    if (this.isLiveSessionActive && this.liveSession) {
      // Keep status as "live" in live mode, not "taskWorking"
      this.status = 'live';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'live'
      });
      
      this.handleLiveTextInput(content, options);
      return;
    }

    // If no live session, GoogleLiveAgent doesn't work in normal mode
    console.log(`GoogleLiveAgent ${this.id} cannot process message - no live session active`);
    this.io.emit('agent-error', {
      agentId: this.id,
      error: 'GoogleLiveAgent only works in live mode. Start live session first.'
    });
    
    // Complete queue task
    this.completeCurrentQueueItem();
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
    this.session = [];
    
    // Reset streaming buffer
    this.textBuffer = '';
    if (this.textTimeout) {
      clearTimeout(this.textTimeout);
      this.textTimeout = null;
    }
    
    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }
    
    this.io.emit('agent-history-cleared', {
      agentId: this.id
    });
    
    console.log(`Agent ${this.id} history cleared`);
    return { success: true };
  }

  _stopModelSession() {
    // Close live session
    this.stopLiveSession();
  }

  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log(`GoogleLiveAgent ${this.id} API key updated`);

    // If there is an active live session, restart
    if (this.isLiveSessionActive) {
      this.stopLiveSession();
      if (this.clientSocket) {
        this.startLiveSession(this.clientSocket);
      }
    }
  }

  _updateVoiceSession(voice) {
    this.voice = voice;
    console.log(`GoogleLiveAgent ${this.id} voice updated to: ${voice}`);

    // If there is an active live session, restart
    if (this.isLiveSessionActive) {
      this.stopLiveSession();
      if (this.clientSocket) {
        this.startLiveSession(this.clientSocket);
      }
    }
  }

  sortHistoryByTimestamp() {
    this.history.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeA - timeB;
    });
    console.log(`Agent ${this.id} history sorted by timestamp`);
  }

  applyMemoryLimit() {
    if (this.history.length > this.memoryLimit) {
      const removedCount = this.history.length - this.memoryLimit;
      this.history = this.history.slice(-this.memoryLimit);
      console.log(`Agent ${this.id} memory limit applied: removed ${removedCount} old messages`);
    }
  }
}

module.exports = GoogleLiveAgent;
