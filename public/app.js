// Socket.IO Connection
const socket = io();

// State Management
let currentAgent = null;
let agents = [];
let cronTasks = [];
let systemVersion = null;
let currentLanguage = 'tr';
let availableModels = [];
let availableProviders = {};
let updateInfo = null;
let isUpdating = false;
let loadedPluginGUIs = new Map();
let pluginsWithGUI = new Set(); // Store plugin names that have GUI support

// Make currentAgent available globally for plugin GUIs
window.currentAgent = currentAgent;

// DOM Elements
const agentList = document.getElementById('agent-list');
const createAgentBtn = document.getElementById('create-agent-btn');
const createAgentModal = document.getElementById('create-agent-modal');
const saveAgentBtn = document.getElementById('save-agent-btn');
const closeModalButtons = document.querySelectorAll('.close-modal');
const agentNameInput = document.getElementById('agent-name');
const agentPromptInput = document.getElementById('agent-prompt');
const agentModelInput = document.getElementById('agent-model');

// Mobile Menu Toggle
const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
const sidebar = document.querySelector('.sidebar');

const currentAgentName = document.getElementById('current-agent-name');
const currentAgentStatus = document.getElementById('current-agent-status');
const startAgentBtn = document.getElementById('start-agent-btn');
const stopAgentBtn = document.getElementById('stop-agent-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const settingsAgentBtn = document.getElementById('settings-agent-btn');
const deleteAgentBtn = document.getElementById('delete-agent-btn');

// Settings Modal Elements
const agentSettingsModal = document.getElementById('agent-settings-modal');
const editAgentNameInput = document.getElementById('edit-agent-name');
const editAgentPromptInput = document.getElementById('edit-agent-prompt');
const editAgentModelInput = document.getElementById('edit-agent-model');
const editAgentVoiceInput = document.getElementById('edit-agent-voice');
const editAgentErrorNotification = document.getElementById('edit-agent-error-notification');
const saveAgentSettingsBtn = document.getElementById('save-agent-settings-btn');
const toolsContainer = document.getElementById('tools-container');
const createAgentToolsContainer = document.getElementById('create-agent-tools-container');

const messagesContainer = document.getElementById('messages-container');
const chatArea = document.getElementById('chat-area');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const trueLiveBtn = document.getElementById('true-live-btn');
const liveConnectBtn = document.getElementById('live-connect-btn');
const queuePanel = document.getElementById('queue-panel');
const queueList = document.getElementById('queue-list');
const queueCount = document.getElementById('queue-count');

// Live Connection Status Elements
const liveConnectionBar = document.getElementById('live-connection-bar');
const connectionStatusText = document.getElementById('connection-status-text');
const connectionUptime = document.getElementById('connection-uptime');
const manualReconnectBtn = document.getElementById('manual-reconnect-btn');

// Plugin Elements
const pluginsContainer = document.getElementById('plugins-container');
const pluginDetailsModal = document.getElementById('plugin-details-modal');
const pluginUploadModal = document.getElementById('plugin-upload-modal');
const pluginDeleteModal = document.getElementById('plugin-delete-modal');
const uploadPluginBtn = document.getElementById('upload-plugin-btn');
const pluginFileInput = document.getElementById('plugin-file');
const uploadPluginSubmit = document.getElementById('upload-plugin-submit');
const deletePluginBtn = document.getElementById('delete-plugin-btn');
const confirmDeletePlugin = document.getElementById('confirm-delete-plugin');
const removeDependenciesCheckbox = document.getElementById('remove-dependencies');
const dependencyInfo = document.getElementById('dependency-info');
const dependenciesList = document.getElementById('dependencies-list');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const settingsList = document.getElementById('settings-list');
const modelSettingsModal = document.getElementById('model-settings-modal');

// Update Elements
const updateNotification = document.getElementById('update-notification');
const updateBtn = document.getElementById('update-btn');
const updateModal = document.getElementById('update-modal');
const currentVersionSpan = document.getElementById('current-version');
const newVersionSpan = document.getElementById('new-version');
const updateDescription = document.getElementById('update-description');
const updateReleaseNotes = document.getElementById('update-release-notes');
const releaseNotesContent = document.getElementById('release-notes-content');
const updateProgress = document.getElementById('update-progress');
const updateProgressFill = document.getElementById('update-progress-fill');
const updateProgressText = document.getElementById('update-progress-text');
const startUpdateBtn = document.getElementById('start-update-btn');
const restartModal = document.getElementById('restart-modal');
const restartMessage = document.getElementById('restart-message');
const restartCountdown = document.getElementById('restart-countdown');
const countdownNumber = document.getElementById('countdown-number');

// Settings Input Elements
const googleApiKeyInput = document.getElementById('google-api-key');
const geminiApiKeyInput = document.getElementById('gemini-api-key');
const serverPortInput = document.getElementById('server-port');
const serverHostInput = document.getElementById('server-host');

// Update Settings Input Elements
const updateCheckOnStartupInput = document.getElementById('update-check-on-startup');
const updateCheckIntervalInput = document.getElementById('update-check-interval');
const updateAutoUpdateInput = document.getElementById('update-auto-update');

let currentQueue = [];
let plugins = [];

// Toast notification system
function showToast(message, type = 'info') {
    // Remove existing toast if any
    const existingToast = document.querySelector('.toast-notification');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.textContent = message;
    
    // Add to body
    document.body.appendChild(toast);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// Voice/Live Audio State
let isLiveConnected = false;
let isTrueLiveMode = false;
let recognition = null;
let synthesis = window.speechSynthesis;
let audioContext = null;
let mediaStream = null;

// Live Connection Status State
let liveConnectionStatus = 'disconnected'; // 'connected', 'connecting', 'reconnecting', 'disconnected', 'offline'
let liveConnectionUptime = 0;
let liveConnectionPing = null;
let liveReconnectCountdown = 0;
let liveReconnectAttempt = 0;

// True Live Audio State
let trueLiveInputAudioContext = null;
let trueLiveOutputAudioContext = null;
let trueLiveMediaStream = null;
let trueLiveProcessor = null;
let trueLiveActiveSources = [];
let trueLiveNextStartTime = 0;

// Scroll to bottom function for both chat area and messages container
function scrollToBottom() {
    if (chatArea) {
        chatArea.scrollTop = chatArea.scrollHeight;
    }
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Live Connection Status Update Function
function updateLiveConnectionStatus(status, message, data = {}) {
    liveConnectionStatus = status;
    
    const isActiveConnection = (status === 'connected' || status === 'connecting' || status === 'reconnecting');

    // ${lang.t('connectionShowBar')}
    if (!isActiveConnection) {
        liveConnectionBar.classList.add('hidden');
        return;
    }
    
    liveConnectionBar.classList.remove('hidden');
    
    const statusTexts = {
        'connected': '🟢 ' + lang.t('connected'),
        'connecting': '🟡 ' + lang.t('connecting'),
        'reconnecting': '🟠 ' + lang.t('reconnecting'),
        'disconnected': '🔴 ' + lang.t('offline'),
        'offline': '⚪ ' + lang.t('offline')
    };
    
    connectionStatusText.textContent = statusTexts[status] || status;
    liveConnectionBar.className = 'live-connection-bar status-' + status;
    
    if (data.uptime !== undefined) {
        liveConnectionUptime = data.uptime;
        connectionUptime.textContent = formatUptime(data.uptime);
    }
    
    if (data.countdown !== undefined) {
        liveReconnectCountdown = data.countdown;
        connectionStatusText.textContent = `🟠 ${lang.t('reconnecting')} (${data.countdown}s)`;
    }
    
    if (message) {
        console.log('Connection status message:', message);
    }
}

// Format uptime seconds to MM:SS
function formatUptime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Manual Reconnect Button Handler
manualReconnectBtn.addEventListener('click', () => {
    if (currentAgent) {
        console.log('Manual reconnect requested');
        socket.emit('manual-reconnect-live', { agentId: currentAgent.id });
    }
});

// Cron Elements
const createCronModal = document.getElementById('create-cron-modal');
const editCronModal = document.getElementById('edit-cron-modal');
const saveCronBtn = document.getElementById('save-cron-btn');
const updateCronBtn = document.getElementById('update-cron-btn');
const cronAgentSelect = document.getElementById('cron-agent');
const editCronAgentSelect = document.getElementById('edit-cron-agent');
const editCronIdInput = document.getElementById('edit-cron-id');



// Settings Event Listeners
function setupSettingsEventListeners() {
    document.addEventListener('language-changed', () => loadCustomProviderApiKeys());
    document.getElementById('custom-provider-api-keys')?.addEventListener('click', (event) => {
        const providerId = event.target.dataset.provider;
        if (event.target.classList.contains('btn-save-custom-provider-key')) saveCustomProviderApiKey(providerId);
        if (event.target.classList.contains('btn-delete-custom-provider-key')) deleteCustomProviderApiKey(providerId);
        if (event.target.classList.contains('btn-toggle-password')) togglePasswordVisibility(event.target.dataset.target);
    });
    // API Key save buttons
    document.querySelectorAll('.btn-save-key').forEach(btn => {
        btn.addEventListener('click', () => {
            const provider = btn.dataset.provider;
            saveApiKey(provider);
        });
    });
    
    // API Key delete buttons
    document.querySelectorAll('.btn-delete-key').forEach(btn => {
        btn.addEventListener('click', () => {
            const provider = btn.dataset.provider;
            deleteApiKey(provider);
        });
    });
    
    // Password toggle buttons
    document.querySelectorAll('.btn-toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            togglePasswordVisibility(target);
        });
    });
    
    // Server settings save button
    const saveServerSettingsBtn = document.getElementById('save-server-settings');
    if (saveServerSettingsBtn) {
        saveServerSettingsBtn.addEventListener('click', saveServerSettings);
    }
    
    // Language settings save button
    const saveLanguageSettingsBtn = document.getElementById('save-language-settings');
    if (saveLanguageSettingsBtn) {
        saveLanguageSettingsBtn.addEventListener('click', saveLanguageSettings);
    }

    // Update settings save button
    const saveUpdateSettingsBtn = document.getElementById('save-update-settings');
    if (saveUpdateSettingsBtn) {
        saveUpdateSettingsBtn.addEventListener('click', saveUpdateSettings);
    }

    // Check update now button
    const checkUpdateNowBtn = document.getElementById('check-update-now');
    if (checkUpdateNowBtn) {
        checkUpdateNowBtn.addEventListener('click', checkForUpdates);
    }

    // Language select change event
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        languageSelect.addEventListener('change', (e) => {
            const selectedLanguage = e.target.value;
            lang.setLanguage(selectedLanguage);
        });
    }
}

// Initialize
function init() {
    setupEventListeners();
    setupSettingsEventListeners();
    requestStatusUpdate();
    requestCronStatus();
    requestPluginsStatus();
    renderSettingsList();
    loadPluginGUIs(); // Load plugin GUIs
}

function requestPluginsStatus() {
    socket.emit('request-plugins');
}

function requestCronStatus() {
    socket.emit('request-cron-tasks');
}

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            
            // Update tab buttons
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update tab content
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            const targetId = tab === 'agents' ? 'agent-list' : `${tab}-list`;
            const tabContent = document.getElementById(targetId);
            if (tabContent) {
                tabContent.classList.add('active');
            } else if (tab === 'plugins') {
                const pluginsContent = document.getElementById('plugins-list');
                if (pluginsContent) {
                    pluginsContent.classList.add('active');
                }
            }
            
            // Tab specific actions
            if (tab === 'cron') {
                addCronTabButton();
            } else {
                removeCronTabButton();
            }
            
            if (tab === 'agents') {
                updateAgentList();
            }
            
            if (tab === 'plugins') {
                loadPlugins();
                setupPluginEventListeners();
            }
        });
    });

    // Create Agent Modal
    createAgentBtn.addEventListener('click', async () => {
        createAgentModal.classList.add('active');
        agentNameInput.focus();
        await Promise.all([loadAvailableModels(), loadToolsForCreateAgent()]);
    });

    closeModalButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Find the closest modal and close it
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
                if (modal.id === 'create-agent-modal') {
                    clearAgentForm();
                } else if (modal.id === 'create-cron-modal') {
                    clearCronForm();
                }
            }
        });
    });

    saveAgentBtn.addEventListener('click', createAgent);

    // Agent name input - auto add to prompt on input
    agentNameInput.addEventListener('input', () => {
        const currentPrompt = agentPromptInput.value;
        const agentName = agentNameInput.value.trim();
        
        if (!agentName) return;
        
        // Check if agent name is already in prompt and update all occurrences
        const namePattern = new RegExp(`${lang.t('yourNameIs')}\\s*[^.]*\\.`, 'gi');
        const hasNamePattern = namePattern.test(currentPrompt);
        
        if (hasNamePattern) {
            // Update all existing name occurrences with new name
            const newPrompt = currentPrompt.replace(namePattern, `${lang.t('yourNameIs')} ${agentName}.`);
            agentPromptInput.value = newPrompt;
        } else {
            // Add agent name to prompt if not already there (only once)
            const newPrompt = `${lang.t('yourNameIs')} ${agentName}. `;
            if (!currentPrompt.trim().startsWith(lang.t('yourNameIs'))) {
                agentPromptInput.value = newPrompt + currentPrompt;
            }
        }
    });

    // Settings Modal
    settingsAgentBtn.addEventListener('click', openAgentSettings);
    
    // Update Modal
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            if (updateInfo) {
                showUpdateModal(updateInfo);
            }
        });
    }
    
    if (startUpdateBtn) {
        startUpdateBtn.addEventListener('click', startUpdate);
    }
    
    if (saveAgentSettingsBtn) {
        saveAgentSettingsBtn.addEventListener('click', saveAgentSettings);
    }

    // Edit Cron Modal - populate agent select when modal opens
    document.querySelectorAll('.edit-cron-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            updateEditCronAgentSelect();
        });
    });

    // Create Cron Modal
    document.querySelector('[data-tab="cron"]').addEventListener('click', () => {
        updateCronAgentSelect();
    });

    saveCronBtn.addEventListener('click', createCronTask);
    updateCronBtn.addEventListener('click', updateCronTask);

    // Agent Controls
    startAgentBtn.addEventListener('click', () => {
        if (currentAgent) {
            socket.emit('start-agent', { agentId: currentAgent.id });
        }
    });

    stopAgentBtn.addEventListener('click', () => {
        if (currentAgent) {
            socket.emit('stop-agent', { agentId: currentAgent.id });
        }
    });

    clearHistoryBtn.addEventListener('click', () => {
        if (currentAgent) {
            if (isAgentWorking(currentAgent)) {
                alert(lang.t('agentTaskRunning'));
                return;
            }
            if (confirm(lang.t('confirmClearHistory'))) {
                socket.emit('clear-history', { agentId: currentAgent.id });
            }
        }
    });

    deleteAgentBtn.addEventListener('click', () => {
        if (currentAgent && confirm(lang.t('confirmDeleteAgent'))) {
            socket.emit('delete-agent', { agentId: currentAgent.id });
            currentAgent = null;
            updateAgentHeader();
            clearMessages();
            renderQueuePanel([]);
            disableAgentControls();
        }
    });

    // Message Input
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Live Connect Button
    liveConnectBtn.addEventListener('click', toggleLiveConnection);

    // Mic Button
    if (micBtn) {
        micBtn.addEventListener('click', toggleMicrophone);
    }

    // True Live Button
    if (trueLiveBtn) {
        trueLiveBtn.addEventListener('click', toggleTrueLiveMode);
    }

    // Socket Events
    socket.on('agents-status', handleAgentsStatus);
    socket.on('agent-created', handleAgentCreated);
    socket.on('agent-updated', handleAgentUpdated);
    socket.on('agent-deleted', handleAgentDeleted);
    socket.on('agent-message', handleAgentMessage);
    socket.on('agent-stream', handleAgentStream);
    socket.on('agent-tool-usage', handleAgentToolUsage);
    socket.on('agent-tool-result', handleAgentToolResult);
    socket.on('agent-status', handleAgentStatus);
    socket.on('agent-error', handleAgentError);
    socket.on('agent-history', handleAgentHistory);
    socket.on('agent-history-cleared', handleAgentHistoryCleared);
    socket.on('agent-queue-update', handleAgentQueueUpdate);
    
    // Cron Events
    socket.on('cron-tasks-status', handleCronTasksStatus);
    socket.on('cron-task-created', handleCronTaskCreated);
    socket.on('cron-task-deleted', handleCronTaskDeleted);
    socket.on('cron-task-updated', handleCronTaskUpdated);
    socket.on('cron-task-executed', handleCronTaskExecuted);
    socket.on('cron-task-error', handleCronTaskError);

    // Server Events
    socket.on('server-restarted', handleServerRestarted);
    socket.on('plugins-status', handlePluginsStatus);
    
    // Update Events
    socket.on('update-available', handleUpdateAvailable);
    socket.on('no-update', handleNoUpdate);
    socket.on('update-error', handleUpdateError);
    socket.on('update-progress', handleUpdateProgress);
    socket.on('update-complete', handleUpdateComplete);
    socket.on('update-started', handleUpdateStarted);
    socket.on('update-failed', handleUpdateFailed);
    socket.on('system-restarting', handleSystemRestarting);
    
    // Fetch system version
    fetchSystemVersion();
    
    // Fetch current language
    fetchLanguage();
    
    // Fetch update status (to show last check result)
    fetchUpdateStatus();
    
    // Update UI with current language
    lang.updateUI();
}

function requestStatusUpdate() {
    socket.emit('request-status');
}

// System Version
async function fetchSystemVersion() {
    try {
        const response = await fetch('/api/version');
        const data = await response.json();
        systemVersion = data.version;
        
        const versionInfo = document.getElementById('version-info');
        if (versionInfo) {
            versionInfo.textContent = `${lang.t('version')}: ${data.version}`;
        }
        const collapsedVersion = document.getElementById('collapsed-sidebar-version');
        if (collapsedVersion) collapsedVersion.textContent = `v${data.version}`;
        
        console.log('System version:', data.version);
    } catch (error) {
        console.error('Error fetching system version:', error);
        const versionInfo = document.getElementById('version-info');
        if (versionInfo) {
            versionInfo.textContent = `${lang.t('version')}: Error`;
        }
        const collapsedVersion = document.getElementById('collapsed-sidebar-version');
        if (collapsedVersion) collapsedVersion.textContent = 'v—';
    }
}

// Language
async function fetchLanguage() {
    try {
        const response = await fetch('/api/language');
        const data = await response.json();
        currentLanguage = data.currentLanguage;
        lang.setLanguage(currentLanguage);
        
        // Update language select in settings
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
            languageSelect.value = currentLanguage;
        }
    } catch (error) {
        console.error('Error fetching language:', error);
    }
}

// Update Status
async function fetchUpdateStatus() {
    try {
        const response = await fetch('/api/update/status');
        const data = await response.json();
        
        if (data.status && data.status.lastCheckResult) {
            const lastCheckResult = data.status.lastCheckResult;
            
            if (lastCheckResult.hasUpdate && lastCheckResult.updateInfo) {
                // Show update notification if there's a pending update
                updateInfo = lastCheckResult.updateInfo;
                showUpdateNotification(updateInfo);
            }
        }
    } catch (error) {
        console.error('Error fetching update status:', error);
    }
}

// Update System Functions
async function checkForUpdates() {
    try {
        const response = await fetch('/api/update/check');
        const data = await response.json();
        
        console.log('Check update response:', data);
        
        if (data.updateInfo) {
            updateInfo = data.updateInfo;
            console.log('Update info received:', updateInfo);
            showUpdateNotification(data.updateInfo);
        } else {
            console.log('No update available');
            if (updateNotification) {
                updateNotification.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
    }
}

function showUpdateModal(info) {
    if (updateModal) {
        currentVersionSpan.textContent = systemVersion || '1.0.0';
        // Use newVersion field from socket event, fallback to version
        const version = info.newVersion || info.version || '';
        newVersionSpan.textContent = version;
        updateDescription.textContent = info.description || lang.t('updateNoDescription');
        
        if (info.releaseNotes) {
            updateReleaseNotes.style.display = 'block';
            releaseNotesContent.textContent = info.releaseNotes;
        } else {
            updateReleaseNotes.style.display = 'none';
        }
        
        updateProgress.style.display = 'none';
        startUpdateBtn.disabled = false;
        startUpdateBtn.textContent = lang.t('update');
        
        updateModal.classList.add('active');
    }
}

async function startUpdate() {
    if (!updateInfo || isUpdating) return;
    
    isUpdating = true;
    startUpdateBtn.disabled = true;
    startUpdateBtn.textContent = lang.t('updating');
    updateProgress.style.display = 'block';
    
    try {
        const response = await fetch('/api/update/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ updateInfo })
        });
        
        const data = await response.json();
        
        if (data.result && data.result.success) {
            // Update will proceed, listen for progress
        } else {
            throw new Error('Update failed to start');
        }
    } catch (error) {
        console.error('Error starting update:', error);
        isUpdating = false;
        startUpdateBtn.disabled = false;
        startUpdateBtn.textContent = lang.t('update');
        alert(lang.t('updateFailed') + ': ' + error.message);
    }
}

function showRestartModal() {
    if (restartModal) {
        updateModal.classList.remove('active');
        restartModal.classList.add('active');

        // Hide connection attempts initially
        const connectionAttemptsDiv = document.getElementById('connection-attempts');
        if (connectionAttemptsDiv) {
            connectionAttemptsDiv.style.display = 'none';
        }

        // Show update complete message first
        restartMessage.textContent = lang.t('updateComplete');
        restartCountdown.style.display = 'none';

        // Wait 3 seconds then start connection check
        setTimeout(() => {
            restartMessage.textContent = lang.t('serverRestarting');
            checkServerConnection();
        }, 3000);
    }
}

function checkServerConnection() {
    let connectionAttempts = 0;
    const maxAttempts = 30; // 30 seconds attempts
    const checkInterval = 1000; // 1 second intervals

    const connectionAttemptsDiv = document.getElementById('connection-attempts');
    const attemptNumber = document.getElementById('attempt-number');
    const maxAttemptsSpan = document.getElementById('max-attempts');

    // Show connection attempts
    if (connectionAttemptsDiv) {
        connectionAttemptsDiv.style.display = 'block';
        maxAttemptsSpan.textContent = maxAttempts;
    }

    const connectionCheck = setInterval(() => {
        connectionAttempts++;

        // Update attempt number
        if (attemptNumber) {
            attemptNumber.textContent = connectionAttempts;
        }

        // Check if server is running
        fetch('/api/version', { method: 'GET' })
            .then(response => {
                if (response.ok) {
                    clearInterval(connectionCheck);

                    // Hide connection attempts
                    if (connectionAttemptsDiv) {
                        connectionAttemptsDiv.style.display = 'none';
                    }

                    restartMessage.textContent = lang.t('connectionEstablished');
                    restartCountdown.style.display = 'block';

                    let countdown = 5;
                    countdownNumber.textContent = countdown;

                    const countdownInterval = setInterval(() => {
                        countdown--;
                        countdownNumber.textContent = countdown;

                        if (countdown <= 0) {
                            clearInterval(countdownInterval);
                            // Redirect to current URL
                            window.location.href = window.location.href;
                        }
                    }, 1000);
                }
            })
            .catch(error => {
                console.log('Connection attempt', connectionAttempts, 'failed:', error.message);

                if (connectionAttempts >= maxAttempts) {
                    clearInterval(connectionCheck);

                    // Hide connection attempts
                    if (connectionAttemptsDiv) {
                        connectionAttemptsDiv.style.display = 'none';
                    }

                    restartMessage.textContent = lang.t('connectionFailed');
                    restartCountdown.style.display = 'none';
                }
            });
    }, checkInterval);
}

async function setLanguage(language) {
    try {
        const response = await fetch('/api/language', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ language })
        });
        
        if (response.ok) {
            const data = await response.json();
            currentLanguage = data.currentLanguage;
            lang.setLanguage(currentLanguage);
            console.log('Language changed to:', currentLanguage);
        }
    } catch (error) {
        console.error('Error setting language:', error);
    }
}

async function saveLanguageSettings() {
    const languageSelect = document.getElementById('language-select');
    const selectedLanguage = languageSelect ? languageSelect.value : 'tr';
    
    await setLanguage(selectedLanguage);
    
    // Show success message
    alert(lang.t('languageSaved'));
}

async function saveUpdateSettings() {
    try {
        const updateSettings = {
            checkOnStartup: updateCheckOnStartupInput ? updateCheckOnStartupInput.checked : true,
            checkInterval: updateCheckIntervalInput ? parseInt(updateCheckIntervalInput.value) : 5,
            autoUpdate: updateAutoUpdateInput ? updateAutoUpdateInput.checked : false
        };

        console.log('Sending update settings:', updateSettings);

        const response = await fetch('/api/update/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateSettings)
        });

        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        if (data.settings) {
            console.log('Update settings saved:', data.settings);
            showNotification(lang.t('updateSettingsSaved'), 'success');
        } else {
            throw new Error('Failed to save update settings');
        }
    } catch (error) {
        console.error('Error saving update settings:', error);
        showNotification(lang.t('apiKeySaveErrorDetail'), 'error');
    }
}

// Update Event Handlers
function handleUpdateAvailable(data) {
    console.log('Update available:', data);
    updateInfo = data;
    
    // Ensure systemVersion is set before showing notification
    if (!systemVersion) {
        fetchSystemVersion().then(() => {
            showUpdateNotification(data);
        });
    } else {
        showUpdateNotification(data);
    }
}

function showUpdateNotification(info) {
    if (updateNotification) {
        updateNotification.style.display = 'flex';
        updateBtn.onclick = () => showUpdateModal(info);
        
        // Update version info immediately in the notification
        const currentVersionDisplay = updateNotification.querySelector('.current-version');
        const newVersionDisplay = updateNotification.querySelector('.new-version');
        
        if (currentVersionDisplay) {
            currentVersionDisplay.textContent = systemVersion || '1.0.0';
            console.log('Current version set to:', systemVersion || '1.0.0');
        }
        if (newVersionDisplay) {
            // Use newVersion field from socket event, fallback to version
            const version = info.newVersion || info.version || '';
            newVersionDisplay.textContent = version;
            console.log('New version set to:', version);
        }
    }
}

function handleNoUpdate(data) {
    console.log('No update available:', data);
    if (updateNotification) {
        updateNotification.style.display = 'none';
    }
}

function handleUpdateError(data) {
    console.error('Update error:', data);
    showNotification(lang.t('updateError') + ': ' + data.error, 'error');
}

function handleUpdateProgress(data) {
    console.log('Update progress:', data);
    if (updateProgress) {
        updateProgress.style.display = 'block';
        updateProgressFill.style.width = data.progress + '%';
        updateProgressText.textContent = data.message;
    }
}

function handleUpdateComplete(data) {
    console.log('Update complete:', data);
    isUpdating = false;
    showRestartModal();
}

function handleUpdateStarted(data) {
    console.log('Update started:', data);
    isUpdating = true;
    if (startUpdateBtn) {
        startUpdateBtn.textContent = lang.t('updating');
        startUpdateBtn.disabled = true;
    }
}

function handleUpdateFailed(data) {
    console.error('Update failed:', data);
    isUpdating = false;
    if (startUpdateBtn) {
        startUpdateBtn.textContent = lang.t('update');
        startUpdateBtn.disabled = false;
    }
    showNotification(lang.t('updateFailed') + ': ' + data.error, 'error');
}

function handleSystemRestarting(data) {
    console.log('System restarting:', data);
    showRestartModal();
}

// Cron Tab Management
function addCronTabButton() {
    if (!document.getElementById('create-cron-btn')) {
        const createBtn = document.createElement('button');
        createBtn.id = 'create-cron-btn';
        createBtn.className = 'btn-primary';
        createBtn.style.marginTop = '10px';
        createBtn.style.marginBottom = '10px';
        createBtn.style.width = '100%';
        createBtn.style.padding = '12px';
        createBtn.innerHTML = '<span>+</span> ' + lang.t('newTask');
        createBtn.addEventListener('click', () => {
            createCronModal.classList.add('active');
            updateCronAgentSelect();
        });
        
        const cronList = document.getElementById('cron-list');
        if (cronList) {
            cronList.insertBefore(createBtn, cronList.firstChild);
        }
    }
}

function removeCronTabButton() {
    const createBtn = document.getElementById('create-cron-btn');
    if (createBtn) {
        createBtn.remove();
    }
}

function updateCronAgentSelect() {
    if (!cronAgentSelect) return;
    
    cronAgentSelect.innerHTML = '';
    if (agents.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No agents available';
        cronAgentSelect.appendChild(option);
        return;
    }
    
    agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        cronAgentSelect.appendChild(option);
    });
}

function updateEditCronAgentSelect() {
    if (!editCronAgentSelect) return;
    
    editCronAgentSelect.innerHTML = '';
    if (agents.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No agents available';
        editCronAgentSelect.appendChild(option);
        return;
    }
    
    agents.forEach(agent => {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name;
        editCronAgentSelect.appendChild(option);
    });
}

// Cron Task Management
function createCronTask() {
    const name = document.getElementById('cron-name').value.trim();
    const agentId = document.getElementById('cron-agent').value;
    const schedule = document.getElementById('cron-schedule').value.trim();
    const message = document.getElementById('cron-message').value.trim();

    if (!name || !agentId || !schedule || !message) {
        alert(lang.t('fillAllFields'));
        return;
    }

    socket.emit('create-cron-task', { name, agentId, schedule, message });
    createCronModal.classList.remove('active');
    clearCronForm();
}

function clearCronForm() {
    document.getElementById('cron-name').value = '';
    document.getElementById('cron-schedule').value = '';
    document.getElementById('cron-message').value = '';
}

function editCronTask(taskId) {
    const task = cronTasks.find(t => t.id === taskId);
    if (task) {
        if (editCronIdInput) {
            editCronIdInput.value = task.id;
        }
        document.getElementById('edit-cron-name').value = task.name;
        document.getElementById('edit-cron-schedule').value = task.schedule;
        document.getElementById('edit-cron-message').value = task.message;
        
        // Update the edit cron agent select and set the selected agent
        updateEditCronAgentSelect();
        if (editCronAgentSelect && task.agentId) {
            editCronAgentSelect.value = task.agentId;
        }
        
        editCronModal.classList.add('active');
    }
}

function updateCronTask() {
    const taskId = editCronIdInput ? editCronIdInput.value : '';
    const name = document.getElementById('edit-cron-name').value.trim();
    const agentId = editCronAgentSelect ? editCronAgentSelect.value : '';
    const schedule = document.getElementById('edit-cron-schedule').value.trim();
    const message = document.getElementById('edit-cron-message').value.trim();

    if (!name || !agentId || !schedule || !message) {
        alert(lang.t('fillAllFields'));
        return;
    }

    socket.emit('update-cron-task', { taskId, name, agentId, schedule, message });
    editCronModal.classList.remove('active');
}

function deleteCronTask(taskId) {
    if (confirm(lang.t('delete') + '?')) {
        socket.emit('delete-cron-task', { taskId });
    }
}

function startCronTask(taskId) {
    socket.emit('start-cron-task', { taskId });
}

function stopCronTask(taskId) {
    socket.emit('stop-cron-task', { taskId });
}

function pauseCronTask(taskId) {
    socket.emit('pause-cron-task', { taskId });
}

function resumeCronTask(taskId) {
    socket.emit('resume-cron-task', { taskId });
}

function updateCronList() {
    const cronList = document.getElementById('cron-list');
    if (!cronList) return;
    
    const existingCreateBtn = document.getElementById('create-cron-btn');
    
    // Clear existing tasks and empty messages (keep create button)
    const existingTasks = cronList.querySelectorAll('.cron-item');
    existingTasks.forEach(task => task.remove());
    const existingEmptyMessages = cronList.querySelectorAll('.empty-message');
    existingEmptyMessages.forEach(msg => msg.remove());
    
    if (cronTasks.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-message';
        emptyMessage.style.textAlign = 'center';
        emptyMessage.style.padding = '20px';
        emptyMessage.style.color = '#a0a0a0';
        emptyMessage.textContent = lang.t('noCronTasks');
        cronList.appendChild(emptyMessage);
        return;
    }
    
    cronTasks.forEach(task => {
        const taskItem = document.createElement('div');
        taskItem.className = 'cron-item';
        
        const agent = agents.find(a => a.id === task.agentId);
        const agentName = agent ? agent.name : 'Bilinmeyen Agent';
        
        // Create buttons using event listeners instead of onclick
        const taskItemHeader = document.createElement('div');
        taskItemHeader.className = 'cron-item-header';
        taskItemHeader.innerHTML = `
            <span class="cron-name">${task.name}</span>
            <span class="cron-status cron-status-${task.status}">${getCronStatusText(task.status)}</span>
        `;
        
        const taskItemInfo = document.createElement('div');
        taskItemInfo.className = 'cron-info';
        taskItemInfo.innerHTML = `
            <div>Agent: ${agentName}</div>
            <div class="cron-schedule">${task.schedule}</div>
            <div>Mesaj: ${task.message.substring(0, 50)}...</div>
        `;
        
        const taskItemControls = document.createElement('div');
        taskItemControls.className = 'cron-controls';
        
        // Status button
        const statusBtn = document.createElement('button');
        if (task.status === 'running') {
            statusBtn.className = 'btn-warning';
            statusBtn.textContent = lang.t('pause');
            statusBtn.onclick = () => pauseCronTask(task.id);
        } else if (task.status === 'paused') {
            statusBtn.className = 'btn-success';
            statusBtn.textContent = lang.t('resume');
            statusBtn.onclick = () => resumeCronTask(task.id);
        } else {
            statusBtn.className = 'btn-success';
            statusBtn.textContent = lang.t('start');
            statusBtn.onclick = () => startCronTask(task.id);
        }
        
        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-primary';
        editBtn.textContent = lang.t('edit');
        editBtn.onclick = () => editCronTask(task.id);
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger';
        deleteBtn.textContent = lang.t('delete');
        deleteBtn.onclick = () => deleteCronTask(task.id);
        
        taskItemControls.appendChild(statusBtn);
        taskItemControls.appendChild(editBtn);
        taskItemControls.appendChild(deleteBtn);
        
        taskItem.appendChild(taskItemHeader);
        taskItem.appendChild(taskItemInfo);
        taskItem.appendChild(taskItemControls);
        
        cronList.appendChild(taskItem);
    });
}

function getCronStatusText(status) {
    const statusMap = {
        'idle': lang.t('idle'),
        'running': lang.t('running'),
        'paused': lang.t('paused'),
        'error': lang.t('error'),
        'executing': lang.t('executing')
    };
    return statusMap[status] || status;
}

// Agent Management
function createAgent() {
    const name = agentNameInput.value.trim();
    const prompt = agentPromptInput.value.trim();
    const model = agentModelInput.value;
    const provider = agentModelInput.selectedOptions[0]?.dataset.provider || null;

    if (!name || !prompt) {
        alert(lang.t('enterAgentName'));
        return;
    }

    // Collect selected tools
    const selectedTools = [];
    const toolCheckboxes = document.querySelectorAll('.create-agent-tool-checkbox:checked');
    toolCheckboxes.forEach(checkbox => {
        selectedTools.push(checkbox.dataset.toolName);
    });

    socket.emit('create-agent', { name, prompt, model, provider, enabledTools: selectedTools });
    createAgentModal.classList.remove('active');
    clearAgentForm();
}

function clearAgentForm() {
    agentNameInput.value = '';
    agentPromptInput.value = '';
    agentModelInput.value = 'gemini-2.5-flash';
}

async function selectAgent(agentId) {
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
        if (currentAgent && currentAgent.id !== agentId) {
            if (isTrueLiveMode || trueLiveMediaStream || trueLiveInputAudioContext || trueLiveOutputAudioContext) releaseTrueLiveAudioForAgentSwitch();
            if (isLiveConnected || mediaStream) stopLiveConnection(true);
        }
        currentAgent = agent;
        window.currentAgent = currentAgent; // Update global reference for plugin GUIs
        updateAgentHeader();
        updateAgentList();
        enableAgentControls();
        loadAgentHistory(agentId);
        requestAgentQueue(agentId);
        
        // Hide live connection bar first (agent changed)
        liveConnectionBar.classList.add('hidden');
        
        // Show True Live button only for Google Live models
        if (trueLiveBtn) {
            const isGoogleLiveModel = agent.model && agent.model.includes('-live-preview');
            trueLiveBtn.style.display = isGoogleLiveModel ? 'block' : 'none';
            trueLiveBtn.disabled = !isGoogleLiveModel;
            
            // Get agent's true-live status from API
            fetch(`/api/agents/${agentId}/true-live-status`)
                .then(response => response.json())
                .then(async (data) => {
                    if (currentAgent?.id !== agentId) return;
                    const isStopped = currentAgent?.status === 'stopped';
                    const isTrueLive = !isStopped && !!(data.trueLiveMode || data.isTrueLiveMode);
                    const isLiveActive = !isStopped && !!(isTrueLive || data.isLiveSessionActive);

                    // 1. True Live Button and Microphone: Active only if user enabled True Live mode
                    if (isTrueLive) {
                        isTrueLiveMode = true;
                        trueLiveBtn.classList.add('active');
                        trueLiveBtn.innerHTML = '🔴 ' + lang.t('trueLiveActiveButton');
                        trueLiveBtn.title = lang.t('trueLiveActiveButton');
                        
                        // Close live microphone if open
                        if (isLiveConnected) {
                            stopLiveConnection();
                        }
                        
                        // Hide the Live Connect button
                        if (liveConnectBtn) {
                            liveConnectBtn.style.display = 'none';
                        }
                        
                        // Show microphone button and check its status
                        if (micBtn) {
                            micBtn.style.display = 'block';
                            micBtn.disabled = false;
                            
                            // Check microphone status
                            const micStatus = await checkMicrophoneStatus();
                            if (micStatus) {
                                micBtn.innerHTML = '🔴 ' + lang.t('microphoneActiveButton');
                                micBtn.classList.add('active');
                                micBtn.title = lang.t('microphoneActiveButton');
                            } else {
                                micBtn.innerHTML = '🎙️ <span data-lang="microphoneButton">' + lang.t('microphoneButton') + '</span>';
                                micBtn.classList.remove('active');
                                micBtn.title = lang.t('microphoneButton');
                            }
                        }
                        
                        // Initialize audio output context (requires user interaction)
                        if (!trueLiveOutputAudioContext) {
                            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                            trueLiveOutputAudioContext = new AudioCtxClass({ sampleRate: 24000 });
                            // Resume audio context (browser restriction)
                            if (trueLiveOutputAudioContext.state === 'suspended') {
                                trueLiveOutputAudioContext.resume();
                            }
                        }
                    } else {
                        isTrueLiveMode = false;
                        trueLiveBtn.classList.remove('active');
                        trueLiveBtn.innerHTML = '🎙️ <span data-lang="trueLiveButton">' + lang.t('trueLiveButton') + '</span>';
                        trueLiveBtn.title = lang.t('trueLiveButton');
                        
                        // Show Live Connect button
                        if (liveConnectBtn) {
                            liveConnectBtn.style.display = 'inline-block';
                        }
                        
                        // Hide the microphone button
                        if (micBtn) {
                            micBtn.style.display = 'none';
                        }
                    }

                    // 2. ${lang.t('liveConnectionBar')} (🟢 ${lang.t('connected')}): Show if connection is active
                    if (isLiveActive) {
                        liveConnectionBar.classList.remove('hidden');
                        updateLiveConnectionStatus(
                            data.connectionStatus || 'connected',
                            lang.t('canTalkWithGemini'),
                            { uptime: data.uptime || 0 }
                        );
                    } else {
                        liveConnectionBar.classList.add('hidden');
                    }
                })
                .catch(error => {
                    console.error('Error fetching true-live status:', error);
                });
        }
        
        // Update button based on queue status (default active if queue data not yet received)
        // Will be updated in handleAgentQueueUpdate when queue data arrives
    }
}

function requestAgentQueue(agentId) {
    socket.emit('request-agent-queue', { agentId });
}

function getQueueStatusText(status) {
    const statusMap = {
        processing: lang.t('processing'),
        waiting: lang.t('waiting'),
        stopped: lang.t('stopped'),
        connection_lost: lang.t('connectionLost')
    };
    return statusMap[status] || status;
}

function renderQueuePanel(queue) {
    if (!queuePanel || !queueList || !queueCount) return;

    currentQueue = queue || [];

    if (!currentAgent || currentQueue.length === 0) {
        queuePanel.classList.add('hidden');
        queueList.innerHTML = '';
        hideAIThinking(); // Hide AI thinking indicator when queue is empty
        return;
    }

    queuePanel.classList.remove('hidden');
    queueCount.textContent = `${currentQueue.length} ${lang.t('task')}`;

    queueList.innerHTML = currentQueue.map(item => `
        <div class="queue-item queue-item-${item.status}">
            <span class="queue-position">${item.position}</span>
            <div class="queue-item-content">
                <div class="queue-item-label" title="${escapeHtml(item.content || item.label)}">${escapeHtml(item.label)}</div>
                <div class="queue-item-source">${escapeHtml(item.sourceLabel || item.source || 'Mesaj')}</div>
                ${item.status === 'connection_lost' ? `
                    <div class="queue-item-reconnection-info">
                        <span class="reconnection-badge">⚠️ ${lang.t('connectionLost')}</span>
                        ${item.reconnectionAttempt ? `<span class="reconnection-attempt">${lang.t('reconnectionAttempt')}: #${item.reconnectionAttempt}</span>` : ''}
                    </div>
                ` : ''}
            </div>
            <span class="queue-item-status queue-status-${item.status}">${getQueueStatusText(item.status)}</span>
            <div class="queue-item-actions">
                ${item.status === 'processing' ? `
                    <button class="queue-action-btn queue-stop-btn" data-item-id="${item.id}" title="Durdur">⏹️</button>
                ` : item.status === 'connection_lost' ? `
                    <button class="queue-action-btn queue-wait-btn" data-item-id="${item.id}" title="${lang.t('connectionWaiting')}">⏳</button>
                    <button class="queue-action-btn queue-delete-btn" data-item-id="${item.id}" title="Sil">🗑️</button>
                ` : `
                    <button class="queue-action-btn queue-edit-btn" data-item-id="${item.id}" title="${lang.t('edit')}">✏️</button>
                    <button class="queue-action-btn queue-delete-btn" data-item-id="${item.id}" title="Sil">🗑️</button>
                `}
            </div>
        </div>
    `).join('');

    // Add event listeners for queue item actions
    document.querySelectorAll('.queue-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            deleteQueueItem(itemId);
        });
    });

    document.querySelectorAll('.queue-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            editQueueItem(itemId);
        });
    });

    document.querySelectorAll('.queue-stop-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.itemId;
            stopQueueItem(itemId);
        });
    });
}

function handleAgentQueueUpdate(data) {
    if (data.agentId === currentAgent?.id) {
        renderQueuePanel(data.queue);

        const isProcessing = (data.queue || []).some(item => item.status === 'processing');
        if (isProcessing) {
            showAIThinking();
        }

        // Preserve the True Live button state
        if (trueLiveBtn) {
            const isGoogleLiveModel = currentAgent && currentAgent.model && currentAgent.model.includes('-live-preview');
            trueLiveBtn.style.display = isGoogleLiveModel ? 'block' : 'none';
            trueLiveBtn.disabled = !isGoogleLiveModel;
        }
    }

    const agent = agents.find(a => a.id === data.agentId);
    if (agent) {
        agent.queueLength = (data.queue || []).length;
        updateAgentList();
    }
}

async function deleteQueueItem(itemId) {
    if (!currentAgent) return;

    try {
        const response = await fetch(`/api/agents/${currentAgent.id}/queue/${itemId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (data.success) {
            // Manually update queue to prevent delay
            currentQueue = currentQueue.filter(item => item.id !== itemId);
            renderQueuePanel(currentQueue);
            console.log('Queue item deleted successfully');
        } else {
            alert(lang.t('queueItemDeleteError') + ': ' + (data.error || data.message));
        }
    } catch (error) {
        console.error('Error deleting queue item:', error);
        alert(lang.t('queueItemDeleteError'));
    }
}

async function stopQueueItem(itemId) {
    if (!currentAgent) return;

    try {
        const response = await fetch(`/api/agents/${currentAgent.id}/queue/${itemId}/stop`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            // Manually update queue to prevent delay
            currentQueue = currentQueue.filter(item => item.id !== itemId);
            renderQueuePanel(currentQueue);
            console.log('Queue item stopped successfully');
        } else {
            alert(lang.t('queueItemStopError') + ': ' + (data.error || data.message));
        }
    } catch (error) {
        console.error('Error stopping queue item:', error);
        alert(lang.t('queueItemStopError'));
    }
}

async function editQueueItem(itemId) {
    if (!currentAgent) return;

    const item = currentQueue.find(q => q.id === itemId);
    if (!item) return;

    const newContent = prompt(lang.t('queueItemEdit'), item.content || item.label);
    if (newContent === null) return; // User cancelled

    if (!newContent.trim()) {
        alert(lang.t('emptyContent'));
        return;
    }

    try {
        const response = await fetch(`/api/agents/${currentAgent.id}/queue/${itemId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: newContent,
                label: newContent.substring(0, 80)
            })
        });

        const data = await response.json();

        if (data.success) {
            // Queue will be updated via socket event
            console.log('Queue item updated successfully');
        } else {
            alert(lang.t('queueItemUpdateError') + ': ' + (data.error || data.message));
        }
    } catch (error) {
        console.error('Error updating queue item:', error);
        alert(lang.t('queueItemUpdateError'));
    }
}

function updateAgentHeader() {
    if (currentAgent) {
        currentAgentName.textContent = currentAgent.name;
        currentAgentStatus.textContent = getStatusText(currentAgent.status);
        // Use status directly as CSS class name (no spaces, uses underscores)
        currentAgentStatus.className = `status-badge status-${currentAgent.status}`;
    } else {
        currentAgentName.textContent = lang.t('agentNotSelected');
        currentAgentStatus.textContent = lang.t('notSelected');
        currentAgentStatus.className = 'status-badge';
    }
    
    // Update clear history button state based on agent status
    if (currentAgent) {
        clearHistoryBtn.disabled = isAgentWorking(currentAgent);
    }
    
    updateInputState();
}

function updateInputState() {
    if (!currentAgent) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        messageInput.placeholder = lang.t('messagePlaceholder');
        return;
    }

    const agentStopped = currentAgent.status === 'stopped';
    if (agentStopped) {
        messageInput.disabled = true;
        sendBtn.disabled = true;
        messageInput.placeholder = lang.t('agentStoppedPlaceholder');
    } else {
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.placeholder = lang.t('messagePlaceholder');
    }

    if (startAgentBtn) startAgentBtn.disabled = !agentStopped;
    if (stopAgentBtn) stopAgentBtn.disabled = agentStopped;
    if (liveConnectBtn) liveConnectBtn.disabled = agentStopped || isTrueLiveMode;
    if (trueLiveBtn) trueLiveBtn.disabled = agentStopped || !currentAgent.model?.includes('-live-preview');
    if (micBtn) micBtn.disabled = agentStopped || !isTrueLiveMode;
}

function isAgentWorking(agent) {
    if (!agent) return true;
    const workingStatuses = ['running', 'taskWorking', 'reconnecting'];
    return workingStatuses.includes(agent.status) || agent.isProcessing === true;
}

function getStatusText(status) {
    const statusMap = {
        'idle': lang.t('idle'),
        'running': lang.t('running'),
        'stopped': lang.t('stopped'),
        'connected': lang.t('connected'),
        'disconnected': lang.t('disconnected'),
        'error': lang.t('error'),
        'connecting': lang.t('connecting'),
        'closing': lang.t('closing'),
        'taskWorking': lang.t('taskWorking'),
        'taskCompleted': lang.t('taskCompleted'),
        'ready': lang.t('ready'),
        'reconnecting': lang.t('reconnecting'),
        'live': lang.t('live'),
        'waiting': lang.t('waiting')
    };
    return statusMap[status] || status;
}

function enableAgentControls() {
    startAgentBtn.disabled = false;
    stopAgentBtn.disabled = false;
    settingsAgentBtn.disabled = false;
    deleteAgentBtn.disabled = false;
    liveConnectBtn.disabled = false;
    
    // Show True Live button only for Google Live models
    if (trueLiveBtn) {
        const isGoogleLiveModel = currentAgent.model && currentAgent.model.includes('-live-preview');
        trueLiveBtn.style.display = isGoogleLiveModel ? 'block' : 'none';
        trueLiveBtn.disabled = !isGoogleLiveModel;
    }
    
    // Microphone button visible in true-live mode
    if (micBtn) {
        micBtn.style.display = isTrueLiveMode ? 'block' : 'none';
        micBtn.disabled = !isTrueLiveMode;
    }
    
    updateInputState();
    
    if (!messageInput.disabled) {
        messageInput.focus();
    }
    
    // Clear history button state is handled in updateAgentHeader
}

function disableAgentControls() {
    startAgentBtn.disabled = true;
    stopAgentBtn.disabled = true;
    clearHistoryBtn.disabled = true;
    settingsAgentBtn.disabled = true;
    deleteAgentBtn.disabled = true;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    liveConnectBtn.disabled = true;
}

const agentAvatarPalette = ['#e95870', '#8b5cf6', '#0ea5a4', '#f97316', '#3b82f6', '#d946ef', '#16a34a', '#ca8a04'];
let agentAvatarColors = {};
try { agentAvatarColors = JSON.parse(localStorage.getItem('agentAvatarColors') || '{}'); } catch (_) { agentAvatarColors = {}; }

function getAgentAvatarColor(agentId) {
    if (!agentAvatarColors[agentId]) {
        agentAvatarColors[agentId] = agentAvatarPalette[Math.floor(Math.random() * agentAvatarPalette.length)];
        localStorage.setItem('agentAvatarColors', JSON.stringify(agentAvatarColors));
    }
    return agentAvatarColors[agentId];
}

function getAgentInitials(name) {
    const letters = Array.from((name || '').trim());
    if (!letters.length) return '?';
    return `${letters[0]}.${letters[letters.length - 1]}`.toLocaleUpperCase();
}

const agentAvatarsStorageKey = 'agentAvatars';
let agentAvatars = {};
let editedAgentAvatar = null;
let removeEditedAgentAvatar = false;
try { agentAvatars = JSON.parse(localStorage.getItem(agentAvatarsStorageKey) || '{}'); } catch (_) { agentAvatars = {}; }

function getAgentAvatarMarkup(agent, preview = false) {
    const image = preview ? editedAgentAvatar : agentAvatars[agent.id];
    if (image) return `<img class="agent-avatar-image" src="${escapeHtml(image)}" alt="">`;
    return `<span class="agent-avatar-initials">${escapeHtml(getAgentInitials(agent.name))}</span>`;
}

function getAgentAvatarStatusClass(agent) {
    if (agent.status === 'stopped') return 'avatar-stopped';
    if (agent.status === 'live') return 'avatar-live';
    if (agent.status === 'waiting') return 'avatar-waiting';
    if (agent.status === 'taskWorking' || agent.status === 'Gorev_yapiyor' || agent.isProcessing === true) return 'avatar-working';
    return 'avatar-active';
}

function updateAgentAvatarPreview() {
    const preview = document.getElementById('edit-agent-avatar-preview');
    if (!preview || !currentAgent) return;
    const agent = { ...currentAgent, name: editAgentNameInput?.value || currentAgent.name };
    preview.innerHTML = getAgentAvatarMarkup(agent, true);
}

const editAgentAvatarFileInput = document.getElementById('edit-agent-avatar-file');
const editAgentAvatarUploadButton = document.getElementById('edit-agent-avatar-upload');
const editAgentAvatarRemoveButton = document.getElementById('edit-agent-avatar-remove');
if (editAgentAvatarUploadButton && editAgentAvatarFileInput) {
    editAgentAvatarUploadButton.addEventListener('click', () => editAgentAvatarFileInput.click());
    editAgentAvatarFileInput.addEventListener('change', () => {
        const file = editAgentAvatarFileInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) {
            alert(lang.t('avatarImageError'));
            editAgentAvatarFileInput.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                editedAgentAvatar = canvas.toDataURL('image/jpeg', 0.85);
                removeEditedAgentAvatar = false;
                updateAgentAvatarPreview();
            };
            image.onerror = () => alert(lang.t('avatarImageError'));
            image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    });
}
if (editAgentAvatarRemoveButton) {
    editAgentAvatarRemoveButton.addEventListener('click', () => {
        editedAgentAvatar = null;
        removeEditedAgentAvatar = true;
        if (editAgentAvatarFileInput) editAgentAvatarFileInput.value = '';
        updateAgentAvatarPreview();
    });
}
if (editAgentNameInput) editAgentNameInput.addEventListener('input', updateAgentAvatarPreview);
if (editAgentNameInput && editAgentPromptInput) {
    editAgentNameInput.addEventListener('input', () => {
        const name = editAgentNameInput.value.trim();
        if (!name) return;

        const prompt = editAgentPromptInput.value;
        const namePrefix = lang.t('yourNameIs');
        const escapedPrefix = namePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const namePattern = new RegExp(`${escapedPrefix}\\s*[^.]*\\.`, 'gi');
        if (namePattern.test(prompt)) {
            editAgentPromptInput.value = prompt.replace(namePattern, `${namePrefix} ${name}.`);
        } else if (!prompt.trim().startsWith(namePrefix)) {
            editAgentPromptInput.value = `${namePrefix} ${name}. ${prompt}`;
        }
    });
}

function updateAgentList() {
    const desiredItems = [];
    const activeIds = new Set(agents.map(agent => String(agent.id)));

    agents.forEach(agent => {
        const agentId = String(agent.id);
        let agentItem = Array.from(agentList.children).find(item => item.dataset.agentId === agentId);
        if (!agentItem) {
            agentItem = document.createElement('div');
            agentItem.className = 'agent-item';
            agentItem.dataset.agentId = agentId;
            agentItem.innerHTML = `
                <div class="agent-avatar" aria-hidden="true"></div>
                <div class="agent-item-details">
                    <div class="agent-item-header">
                        <span class="agent-name"></span>
                        <span class="agent-status"></span>
                    </div>
                    <div class="agent-preview"></div>
                </div>
            `;
            agentItem.addEventListener('click', () => selectAgent(agent.id));
        }

        agentItem.classList.toggle('active', Boolean(currentAgent && currentAgent.id === agent.id));
        agentItem.title = agent.name || '';
        const avatar = agentItem.querySelector('.agent-avatar');
        avatar.className = `agent-avatar ${getAgentAvatarStatusClass(agent)}`;
        avatar.style.setProperty('--agent-avatar-bg', getAgentAvatarColor(agent.id));
        const avatarMarkup = getAgentAvatarMarkup(agent);
        if (avatar.innerHTML !== avatarMarkup) avatar.innerHTML = avatarMarkup;

        agentItem.querySelector('.agent-name').textContent = agent.name || '';
        const status = agentItem.querySelector('.agent-status');
        status.className = `agent-status status-${String(agent.status || 'ready').replace(/[^a-zA-Z0-9_-]/g, '')}`;
        status.textContent = getStatusText(agent.status);
        const prompt = (agent.prompt || '').substring(0, 50);
        agentItem.querySelector('.agent-preview').textContent = `${prompt}${(agent.prompt || '').length > 50 ? '…' : ''}${agent.queueLength > 0 ? ` · ${lang.t('queue')}: ${agent.queueLength}` : ''}`;
        desiredItems.push(agentItem);
    });

    Array.from(agentList.children).forEach(item => {
        if (!activeIds.has(item.dataset.agentId)) item.remove();
    });
    desiredItems.forEach((item, index) => {
        if (agentList.children[index] !== item) agentList.insertBefore(item, agentList.children[index] || null);
    });
}

// Plugin Management Functions
async function loadPlugins() {
    try {
        const response = await fetch('/api/plugins');
        const data = await response.json();
        plugins = data.plugins || [];
        renderPluginsList();
    } catch (error) {
        console.error('Error loading plugins:', error);
    }
}

function renderPluginsList() {
    if (!pluginsContainer) return;
    
    pluginsContainer.innerHTML = '';
    
    if (plugins.length === 0) {
        pluginsContainer.innerHTML = '<div class="empty-state">' + lang.t('noPlugins') + '</div>';
        return;
    }
    
    plugins.forEach(plugin => {
        const isEnabled = plugin.enabled !== false;
        const hasGUI = plugin.hasGUI || false;
        const pluginItem = document.createElement('div');
        pluginItem.className = `plugin-item ${isEnabled ? '' : 'disabled'}`;
        pluginItem.innerHTML = `
            <div class="plugin-item-header">
                <div class="plugin-info">
                    <span class="plugin-name">${plugin.name}</span>
                    <span class="plugin-version">v${plugin.version}</span>
                    <span class="plugin-category">${plugin.category}</span>
                    <span class="plugin-author">${plugin.author || 'Bilinmiyor'}</span>
                    ${!isEnabled ? '<span class="plugin-status-badge">' + lang.t('disabled') + '</span>' : ''}
                    ${hasGUI ? '<span class="plugin-gui-badge">GUI</span>' : ''}
                </div>
                <div class="plugin-actions">
                    ${!isEnabled ? `
                        <button class="plugin-enable-btn" 
                                data-plugin-name="${plugin.name}"
                                title="${lang.t('enable')}">
                            ✓ ${lang.t('enable')}
                        </button>
                    ` : `
                        <button class="plugin-disable-btn" 
                                data-plugin-name="${plugin.name}"
                                title="${lang.t('disabled')}">
                            ✗ ${lang.t('disabled')}
                        </button>
                    `}
                    <button class="plugin-info-btn" 
                            data-plugin-name="${plugin.name}"
                            title="${lang.t('details')}">
                        ℹ️
                    </button>
                    <button class="delete-plugin-btn"
                            data-plugin-name="${plugin.name}"
                            title="${lang.t('delete')}">
                        🗑️
                    </button>
                </div>
            </div>
            <div class="plugin-description">${plugin.description}</div>
            <div class="plugin-tools-count">${plugin.tools ? plugin.tools.length : 0} tool</div>
        `;

        // Add event listeners
        if (!isEnabled) {
            const enableBtn = pluginItem.querySelector('.plugin-enable-btn');
            enableBtn.addEventListener('click', () => togglePlugin(plugin.name));
        } else {
            const disableBtn = pluginItem.querySelector('.plugin-disable-btn');
            disableBtn.addEventListener('click', () => togglePlugin(plugin.name));
        }

        const infoBtn = pluginItem.querySelector('.plugin-info-btn');
        infoBtn.addEventListener('click', () => showPluginDetails(plugin.name));

        const deleteBtn = pluginItem.querySelector('.delete-plugin-btn');
        deleteBtn.addEventListener('click', () => openPluginDeleteModal(plugin.name));

        pluginsContainer.appendChild(pluginItem);
    });
}

async function togglePlugin(pluginName) {
    const plugin = plugins.find(p => p.name === pluginName);
    if (!plugin) return;
    
    const action = plugin.enabled !== false ? 'disable' : 'enable';
    
    try {
        const response = await fetch(`/api/plugins/${pluginName}/${action}`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            await loadPlugins(); // Reload plugins
        } else {
            showToast(lang.t('operationFailed') + ': ' + (data.error || data.message), 'error');
        }
    } catch (error) {
        console.error('Error toggling plugin:', error);
        showToast(lang.t('pluginToggleError'), 'error');
    }
}

async function showPluginDetails(pluginName) {
    try {
        const response = await fetch(`/api/plugins/${pluginName}`);
        const data = await response.json();
        
        if (data.plugin) {
            const plugin = data.plugin;
            
            document.getElementById('plugin-name').textContent = plugin.name;
            document.getElementById('plugin-version').textContent = `v${plugin.version}`;
            document.getElementById('plugin-description').textContent = plugin.description;
            document.getElementById('plugin-author').textContent = plugin.author || 'Bilinmiyor';
            document.getElementById('plugin-category').textContent = plugin.category || 'Genel';

            const guiSupportElement = document.getElementById('plugin-gui-support');
            if (plugin.hasGUI === true) {
                guiSupportElement.textContent = lang.t('guiSupportYes');
                guiSupportElement.style.color = '#e94560';
                guiSupportElement.style.fontWeight = '600';
            } else {
                guiSupportElement.textContent = lang.t('guiSupportNo');
                guiSupportElement.style.color = '#888';
                guiSupportElement.style.fontWeight = 'normal';
            }
            
            const toolsContainer = document.getElementById('plugin-tools-list');
            toolsContainer.innerHTML = '';
            
            if (plugin.tools && plugin.tools.length > 0) {
                plugin.tools.forEach(tool => {
                    const toolItem = document.createElement('div');
                    toolItem.className = 'plugin-tool-item';
                    toolItem.textContent = tool;
                    toolsContainer.appendChild(toolItem);
                });
            } else {
                toolsContainer.innerHTML = '<div class="empty-state">No tools available</div>';
            }
            
            pluginDetailsModal.classList.add('active');
        } else {
            showToast(lang.t('pluginNotFound'), 'error');
        }
    } catch (error) {
        console.error('Error loading plugin details:', error);
        alert(lang.t('pluginDetailsError'));
    }
}

// Plugin Event Listeners
function setupPluginEventListeners() {
    console.log('Setting up plugin event listeners...');

    // Upload plugin button
    if (uploadPluginBtn) {
        console.log('Upload plugin button found:', uploadPluginBtn);
        uploadPluginBtn.addEventListener('click', openPluginUploadModal);
        console.log('Upload plugin button event listener added');
    } else {
        console.error('Upload plugin button not found!');
    }

    // Upload plugin submit
    if (uploadPluginSubmit) {
        uploadPluginSubmit.addEventListener('click', uploadPlugin);
    }

    // Delete plugin buttons
    document.querySelectorAll('.delete-plugin-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const pluginName = e.target.dataset.pluginName;
            openPluginDeleteModal(pluginName);
        });
    });

    // Confirm delete plugin
    if (confirmDeletePlugin) {
        confirmDeletePlugin.addEventListener('click', confirmDeletePluginHandler);
    }

    // Close modal buttons
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            if (modal) {
                modal.classList.remove('active');
            }
        });
    });
}

function closeAllModals() {
    if (pluginUploadModal) pluginUploadModal.classList.remove('active');
    if (pluginDeleteModal) pluginDeleteModal.classList.remove('active');
    if (pluginDetailsModal) pluginDetailsModal.classList.remove('active');
}

// Plugin Upload Functions
function openPluginUploadModal() {
    console.log('Opening plugin upload modal...');
    console.log('Plugin upload modal:', pluginUploadModal);

    if (pluginUploadModal) {
        pluginUploadModal.classList.add('active');
        pluginFileInput.value = '';
        document.getElementById('upload-progress').style.display = 'none';
    } else {
        console.error('Plugin upload modal not found!');
    }
}

async function uploadPlugin() {
    const file = pluginFileInput.files[0];
    
    if (!file) {
        showToast(lang.t('selectFile'), 'error');
        return;
    }

    const formData = new FormData();
    formData.append('plugin', file);

    // Show progress
    const progressContainer = document.getElementById('upload-progress');
    const uploadProgressFill = document.getElementById('upload-progress-fill');
    const uploadProgressText = document.getElementById('upload-progress-text');

    progressContainer.style.display = 'block';
    uploadProgressFill.style.width = '0%';
    uploadProgressText.textContent = '0%';

    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;
        uploadProgressFill.style.width = progress + '%';
        uploadProgressText.textContent = Math.round(progress) + '%';
    }, 200);

    try {
        const response = await fetch('/api/plugins/upload', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);
        uploadProgressFill.style.width = '100%';
        uploadProgressText.textContent = '100%';

        const data = await response.json();

        if (data.success) {
            showToast(lang.t('pluginInstalled') + ': ' + data.pluginName, 'success');
            await loadPlugins(); // Reload plugins
            requestStatusUpdate();
            if (data.resetWarnings?.length) showToast(lang.t('pluginRuntimeResetWarning'), 'error');
            closeAllModals();
        } else {
            showToast(lang.t('pluginInstallError') + ': ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error uploading plugin:', error);
        showToast(lang.t('pluginUploadError'), 'error');
    } finally {
        document.getElementById('upload-progress').style.display = 'none';
    }
}

// Plugin Delete Functions
let currentDeletePluginName = null;

function openPluginDeleteModal(pluginName) {
    currentDeletePluginName = pluginName;
    
    if (pluginDeleteModal) {
        pluginDeleteModal.classList.add('active');
        
        // Load plugin dependencies
        loadPluginDependencies(pluginName);
    }
}

async function loadPluginDependencies(pluginName) {
    try {
        const response = await fetch(`/api/plugins/${pluginName}/dependencies`);
        const data = await response.json();
        
        if (data.dependencies && data.dependencies.hasDependencies) {
            dependencyInfo.style.display = 'block';
            dependenciesList.innerHTML = '';
            
            Object.entries(data.dependencies.dependencies).forEach(([dep, version]) => {
                const depItem = document.createElement('div');
                depItem.className = 'dependency-item';
                depItem.textContent = `${dep}: ${version}`;
                dependenciesList.appendChild(depItem);
            });
        } else {
            dependencyInfo.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading plugin dependencies:', error);
        dependencyInfo.style.display = 'none';
    }
}

async function confirmDeletePluginHandler() {
    if (!currentDeletePluginName) return;
    
    const removeDependencies = removeDependenciesCheckbox.checked;
    const confirmDeleteBtn = document.getElementById('confirm-delete-plugin');
    
    // Disable button during deletion
    confirmDeleteBtn.disabled = true;
    
    // Show progress
    const deleteProgress = document.getElementById('delete-progress');
    const deleteProgressFill = document.getElementById('delete-progress-fill');
    const deleteProgressText = document.getElementById('delete-progress-text');
    
    deleteProgress.style.display = 'block';
    deleteProgressFill.style.width = '0%';
    deleteProgressText.textContent = lang.t('deleting');
    
    // Simulate progress
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress > 90) progress = 90;
        deleteProgressFill.style.width = progress + '%';
        deleteProgressText.textContent = Math.round(progress) + '%';
    }, 200);
    
    try {
        const response = await fetch(`/api/plugins/${currentDeletePluginName}?removeDependencies=${removeDependencies}`, {
            method: 'DELETE'
        });

        clearInterval(progressInterval);
        deleteProgressFill.style.width = '100%';
        deleteProgressText.textContent = '100%';

        const data = await response.json();

        if (data.success) {
            showToast(lang.t('pluginDeleted') + ': ' + data.pluginName, 'success');
            await loadPlugins(); // Reload plugins
            requestStatusUpdate();
            if (data.resetWarnings?.length) showToast(lang.t('pluginRuntimeResetWarning'), 'error');
            closeAllModals();
        } else {
            showToast(lang.t('pluginDeleteError') + ': ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('Error deleting plugin:', error);
        showToast(lang.t('pluginDeleteError'), 'error');
    } finally {
        deleteProgress.style.display = 'none';
        confirmDeleteBtn.disabled = false;
    }
}

// Message Handling
function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !currentAgent || currentAgent.status === 'stopped') return;

    socket.emit('send-message', { agentId: currentAgent.id, content });
    messageInput.value = '';

    if (currentAgent.status === 'ready' && currentQueue.length === 0) {
        showAIThinking();
    }
}

function formatTimestampWithMs(timestamp = null) {
    const d = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(d.getTime())) return '';
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
}

function addMessageToUI(role, content, toolUsage = null, timestamp = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // Use provided timestamp formatted with milliseconds
    const displayTimestamp = formatTimestampWithMs(timestamp);
    
    let messageHTML = `
        <div class="message-content">
            <div class="message-role-badge">Role: ${role}</div>
            <div class="message-timestamp-badge">Time: ${displayTimestamp}</div>
            <div class="message-text">${escapeHtml(content)}</div>
        </div>
    `;
    
    if (toolUsage) {
        messageHTML += `
            <div class="tool-usage">
                <div class="tool-usage-header">🔧 ${lang.t('toolUsage')}: ${toolUsage.tool}</div>
                <div class="tool-usage-content">
                    <div>${lang.t('arguments')}: ${escapeHtml(formatToolData(toolUsage.args))}</div>
                    <div>${lang.t('result')}: ${escapeHtml(formatToolData(toolUsage.result))}</div>
                </div>
            </div>
        `;
    }
    
    messageDiv.innerHTML = messageHTML;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function addSystemMessage(content) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    
    const displayTimestamp = formatTimestampWithMs(new Date().toISOString());
    
    const messageHTML = `
        <div class="message-content">
            <div class="message-role-badge">System</div>
            <div class="message-timestamp-badge">Time: ${displayTimestamp}</div>
            <div class="message-text">${escapeHtml(content)}</div>
        </div>
    `;
    
    messageDiv.innerHTML = messageHTML;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

function addCronMessageToUI(message) {
    const cronDiv = document.createElement('div');
    cronDiv.className = 'cron-message';
    
    // Format timestamps
    const displayTimestamp = formatTimestampWithMs(message.timestamp);
    const taskTimestamp = message.taskTimestamp ? formatTimestampWithMs(message.taskTimestamp) : displayTimestamp;
    
    // Format task time for display
    const taskTime = new Date(taskTimestamp);
    const formattedTime = taskTime.toLocaleTimeString('tr-TR', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
    });
    
    // Use original message if available, otherwise use content
    const originalMessage = message.originalMessage || message.content;
    
    cronDiv.innerHTML = `
        <div class="cron-message-content">
            <div class="cron-message-header">
                <span class="cron-icon">⏰</span>
                <span class="cron-title">${lang.t('cronTask')}: ${escapeHtml(message.taskName)}</span>
                <span class="cron-role">Role: ${message.role}</span>
                <span class="cron-timestamp">Time: ${displayTimestamp}</span>
            </div>
            <div class="cron-task-info">
                <div class="cron-task-name">
                    <strong>${lang.t('taskName')}:</strong> ${escapeHtml(message.taskName)}
                </div>
                <div class="cron-task-time">
                    <strong>${lang.t('runTime')}:</strong> ${formattedTime}
                </div>
                <div class="cron-task-schedule">
                    <strong>Zamanlama:</strong> ${escapeHtml(message.taskSchedule)}
                </div>
            </div>
            <div class="cron-task-message">
                <strong>${lang.t('taskMessage')}:</strong>
                <div class="cron-message-text">${escapeHtml(originalMessage)}</div>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(cronDiv);
    scrollToBottom();
}

function addSystemMessageToUI(message) {
    const systemDiv = document.createElement('div');
    systemDiv.className = 'system-message';

    // Format timestamp
    const displayTimestamp = formatTimestampWithMs(message.timestamp);

    // Try to parse the message content as JSON (structured system error)
    let errorData = null;
    try {
        errorData = JSON.parse(message.content);
    } catch (e) {
        // If not JSON, treat as plain text
    }

    if (errorData && errorData.role === 'system' && errorData.type === 'error') {
        // Structured system error message
        const formattedTime = new Date(errorData.timestamp).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        systemDiv.innerHTML = `
            <div class="system-message-content">
                <div class="system-message-header">
                    <span class="system-icon">⚠️</span>
                    <span class="system-title">${lang.t('systemError')}</span>
                    <span class="system-role">Role: ${message.role}</span>
                    <span class="system-timestamp">Time: ${displayTimestamp}</span>
                </div>
                <div class="system-error-info">
                    <div class="system-error-title">
                        <strong>${lang.t('title')}:</strong> ${escapeHtml(errorData.title)}
                    </div>
                    <div class="system-error-description">
                        <strong>${lang.t('description')}:</strong> ${escapeHtml(errorData.description)}
                    </div>
                    ${errorData.file ? `
                    <div class="system-error-file">
                        <strong>Dosya:</strong> ${escapeHtml(errorData.file)}
                    </div>
                    ` : ''}
                    ${errorData.code ? `
                    <div class="system-error-code">
                        <strong>Kod:</strong> ${escapeHtml(errorData.code)}
                    </div>
                    ` : ''}
                    <div class="system-error-time">
                        <strong>Zaman:</strong> ${formattedTime}
                    </div>
                </div>
            </div>
        `;
    } else {
        // Plain system message
        systemDiv.innerHTML = `
            <div class="system-message-content">
                <div class="system-message-header">
                    <span class="system-icon">🔧</span>
                    <span class="system-title">${lang.t('systemMessage')}</span>
                    <span class="system-role">Role: ${message.role}</span>
                    <span class="system-timestamp">Time: ${displayTimestamp}</span>
                </div>
                <div class="system-message-text">
                    ${escapeHtml(message.content)}
                </div>
            </div>
        `;
    }

    messagesContainer.appendChild(systemDiv);
    scrollToBottom();
}

// Add agent-to-agent message to plugin GUI
function addAgentToAgentMessageToPluginGUI(message) {
    const agentGUI = loadedPluginGUIs.get('agent');
    if (agentGUI && agentGUI.addAgentToAgentMessageToUI) {
        agentGUI.addAgentToAgentMessageToUI(message, true); // true = insert in order
    }
}

// Add tool to plugin GUI (generic function for all plugins)
function addToolToPluginGUI(toolUsage, timestamp) {
    // Extract plugin name from tool name (e.g., "datetime.getCurrentTime" -> "datetime")
    const toolName = toolUsage.tool || '';
    const parts = toolName.split('.');
    const pluginName = parts[0] || '';

    // Get the plugin GUI
    const pluginGUI = loadedPluginGUIs.get(pluginName);

    if (pluginGUI && pluginGUI.addToolDisplay) {
        // Call the plugin's standard addToolDisplay method
        pluginGUI.addToolDisplay(toolUsage, timestamp, null, true); // true = insert in order
    }
}

// Agent-to-agent message UI is now handled by the agent plugin GUI

function addToolMessageToUI(toolUsage, timestamp = null) {
    // Check if this tool belongs to a plugin with GUI support
    if (isToolFromPluginWithGUI(toolUsage.tool)) {
        // Skip tools from plugins with GUI - handled by plugin GUI
        console.log('Skipping tool message from plugin with GUI:', toolUsage.tool);
        return;
    }

    const toolIndicator = document.createElement('div');

    // Use provided timestamp formatted with milliseconds
    const displayTimestamp = formatTimestampWithMs(timestamp);
    
    if (toolUsage.type === 'result') {
        toolIndicator.className = 'tool-usage tool-completed';
        toolIndicator.innerHTML = `
            <div class="tool-usage-header">
                <span class="tool-icon">✅</span>
                <span class="tool-name">${lang.t('toolCompleted')}: ${toolUsage.tool}</span>
                <span class="tool-status">${lang.t('successful')}</span>
                <span class="tool-role">Role: assistant</span>
                <span class="tool-timestamp">Time: ${displayTimestamp}</span>
            </div>
            <div class="tool-usage-content">
                <div class="tool-args">
                    <strong>${lang.t('arguments')}:</strong>
                    <pre>${escapeHtml(formatToolData(toolUsage.args, true))}</pre>
                </div>
                <div class="tool-result">
                    <strong>${lang.t('result')}:</strong>
                    <pre>${escapeHtml(formatToolData(toolUsage.result, true))}</pre>
                </div>
            </div>
        `;
    } else if (toolUsage.type === 'error') {
        toolIndicator.className = 'tool-usage tool-error';
        toolIndicator.innerHTML = `
            <div class="tool-usage-header">
                <span class="tool-icon">❌</span>
                <span class="tool-name">${lang.t('toolError')}: ${toolUsage.tool}</span>
                <span class="tool-status">${lang.t('failed')}</span>
                <span class="tool-role">Role: assistant</span>
                <span class="tool-timestamp">Time: ${displayTimestamp}</span>
            </div>
            <div class="tool-usage-content">
                <div class="tool-args">
                    <strong>${lang.t('arguments')}:</strong>
                    <pre>${escapeHtml(formatToolData(toolUsage.args, true))}</pre>
                </div>
                <div class="tool-result">
                    <strong>Hata:</strong>
                    <pre>${escapeHtml(formatToolData(toolUsage.error))}</pre>
                </div>
            </div>
        `;
    }
    
    messagesContainer.appendChild(toolIndicator);
    scrollToBottom();
}

function addStreamToUI(chunk, timestamp = null, role = 'assistant') {
    // Find or create the last message with the specified role
    let lastMessage = messagesContainer.querySelector(`.message.${role}:last-child`);
    
    if (!lastMessage) {
        lastMessage = document.createElement('div');
        lastMessage.className = `message ${role}`;
        
        // Use provided timestamp formatted with milliseconds
        const displayTimestamp = formatTimestampWithMs(timestamp);
        
        const label = role === 'assistant' ? 'Assistant' : 'Siz';
        
        lastMessage.innerHTML = `
            <div class="message-content">
                <div class="message-role-badge">Role: ${role}</div>
                <div class="message-timestamp-badge">Time: ${displayTimestamp}</div>
                <div class="message-text"></div>
            </div>
        `;
        messagesContainer.appendChild(lastMessage);
    }
    
    const contentDiv = lastMessage.querySelector('.message-text');
    if (contentDiv) {
        contentDiv.innerHTML += escapeHtml(chunk);
    } else {
        // Fallback for messages without message-text div
        const messageContent = lastMessage.querySelector('.message-content');
        if (messageContent) {
            messageContent.innerHTML += escapeHtml(chunk);
        }
    }
    scrollToBottom();
}

// Add AI thinking indicator
function showAIThinking() {
    // Remove existing thinking indicator
    const existingThinking = document.querySelector('.ai-thinking');
    if (existingThinking) {
        existingThinking.remove();
    }
    
    const thinkingIndicator = document.createElement('div');
    thinkingIndicator.className = 'ai-thinking';
    thinkingIndicator.innerHTML = `
        <div class="thinking-spinner"></div>
        <span>${lang.t('aiThinking')}...</span>
    `;
    messagesContainer.appendChild(thinkingIndicator);
    scrollToBottom();
}

function hideAIThinking() {
    const thinkingIndicator = document.querySelector('.ai-thinking');
    if (thinkingIndicator) {
        thinkingIndicator.remove();
    }
}

function clearMessages() {
    messagesContainer.innerHTML = `
        <div class="welcome-message">
            <h3>${lang.t('welcomeTitle')}</h3>
            <p>${lang.t('welcomeDesc')}</p>
        </div>
    `;
    renderQueuePanel([]);
}

function loadAgentHistory(agentId) {
    socket.emit('get-history', { agentId });
}

// Socket Event Handlers
function handleAgentsStatus(data) {
    agents = data.agents || [];
    
    // Hide loading skeleton when agents are loaded
    hideAgentSkeleton();
    
    updateAgentList();
    
    // Update current agent info if selected
    if (currentAgent) {
        const updatedAgent = agents.find(a => a.id === currentAgent.id);
        if (updatedAgent) {
            currentAgent = updatedAgent;
            if (currentAgent.status === 'stopped') stopAgentLiveFeatures();
            updateAgentHeader();
        }
    }
}

function handleAgentCreated(data) {
    requestStatusUpdate();
}

function handleAgentUpdated(data) {
    requestStatusUpdate();
}

function handleAgentDeleted(data) {
    requestStatusUpdate();
}

function handleAgentMessage(data) {
    if (data.agentId === currentAgent?.id) {
        const { message } = data;
        
        // Skip tool-related messages as they are handled by tool events
        if (message.toolUsage && message.toolUsage.type) {
            return;
        }
        
        // Skip empty content messages
        if (!message.content || message.content.trim() === '') {
            return;
        }
        
        hideAIThinking();

        // Check if this message is already in UI to prevent duplicates
        const lastMessage = messagesContainer.querySelector('.message:last-child');
        const isDuplicate = lastMessage && 
                           lastMessage.querySelector('.message-content')?.textContent === message.content;
        
        if (!isDuplicate) {
            // Handle different message types based on role
            if (message.role === 'cron') {
                // Cron messages are now handled by the cron plugin GUI
            } else if (message.role === 'system') {
                addSystemMessageToUI(message);
            } else if (message.role === 'user') {
                addMessageToUI('user', message.content, null, message.timestamp);
            } else if (message.role === 'assistant') {
                // Always show assistant responses as assistant
                addMessageToUI('assistant', message.content, message.toolUsage, message.timestamp);
            }
        }
    }
}

function handleAgentStream(data) {
    if (data.agentId === currentAgent?.id) {
        hideAIThinking(); // Hide thinking indicator when streaming starts
        // Stream is always from assistant (agent responses)
        addStreamToUI(data.chunk, data.timestamp, 'assistant');
    }
}

function handleAgentToolUsage(data) {
    if (data.agentId === currentAgent?.id) {
        const { toolUsage } = data;

        // Check if this tool belongs to a plugin with GUI support
        if (isToolFromPluginWithGUI(toolUsage.tool)) {
            // Skip tools from plugins with GUI - handled by plugin GUI
            console.log('Skipping tool from plugin with GUI:', toolUsage.tool);
            return;
        }

        // Show tool usage indicator with loading animation
        const toolIndicator = document.createElement('div');
        toolIndicator.className = 'tool-usage tool-working';
        toolIndicator.id = `tool-${Date.now()}`;
        toolIndicator.innerHTML = `
            <div class="tool-usage-header">
                <span class="tool-icon">⚙️</span>
                <span class="tool-name">${lang.t('toolRunning')}: ${toolUsage.tool}</span>
                <span class="tool-status">${lang.t('running')}...</span>
                <span class="tool-role">Role: assistant</span>
                <span class="tool-timestamp">Time: ${formatTimestampWithMs()}</span>
            </div>
            <div class="tool-usage-content">
                <div class="tool-args">
                    <strong>${lang.t('arguments')}:</strong>
                    <pre>${escapeHtml(formatToolData(toolUsage.args, true))}</pre>
                </div>
                <div class="tool-loading">
                    <div class="loading-spinner"></div>
                    <span>${lang.t('toolExecuting')}...</span>
                </div>
            </div>
        `;
        messagesContainer.appendChild(toolIndicator);
        scrollToBottom();
    }
}

function handleAgentToolResult(data) {
    if (data.agentId === currentAgent?.id) {
        const { toolUsage } = data;

        // Check if this tool belongs to a plugin with GUI support
        if (isToolFromPluginWithGUI(toolUsage.tool)) {
            // Skip tools from plugins with GUI - handled by plugin GUI
            console.log('Skipping tool result from plugin with GUI:', toolUsage.tool);
            return;
        }

        // Update or add tool result
        let lastToolUsage = messagesContainer.querySelector('.tool-usage:last-child');
        if (lastToolUsage) {
            const displayTimestamp = formatTimestampWithMs(toolUsage.timestamp);
            
            // Check if result contains an error
            const hasError = toolUsage.result && typeof toolUsage.result === 'object' && toolUsage.result.error;
            const isStringError = typeof toolUsage.result === 'string' && toolUsage.result.includes('Tool execution error');
            
            if (hasError || isStringError) {
                // Error case
                const errorMessage = hasError ? toolUsage.result.error : toolUsage.result;
                lastToolUsage.className = 'tool-usage tool-error';
                lastToolUsage.innerHTML = `
                    <div class="tool-usage-header">
                        <span class="tool-icon">❌</span>
                        <span class="tool-name">${lang.t('toolError')}: ${toolUsage.tool}</span>
                        <span class="tool-status">${lang.t('failed')}</span>
                        <span class="tool-role">Role: assistant</span>
                        <span class="tool-timestamp">Time: ${displayTimestamp}</span>
                    </div>
                    <div class="tool-usage-content">
                        <div class="tool-args">
                            <strong>${lang.t('arguments')}:</strong>
                            <pre>${escapeHtml(formatToolData(toolUsage.args, true))}</pre>
                        </div>
                        <div class="tool-result tool-error">
                            <strong>Hata:</strong>
                            <pre>${escapeHtml(formatToolData(errorMessage))}</pre>
                        </div>
                    </div>
                `;
            } else {
                // Success case
                lastToolUsage.className = 'tool-usage tool-completed';
                lastToolUsage.innerHTML = `
                    <div class="tool-usage-header">
                        <span class="tool-icon">✅</span>
                        <span class="tool-name">${lang.t('toolCompleted')}: ${toolUsage.tool}</span>
                        <span class="tool-status">${lang.t('successful')}</span>
                        <span class="tool-role">Role: assistant</span>
                        <span class="tool-timestamp">Time: ${displayTimestamp}</span>
                    </div>
                    <div class="tool-usage-content">
                        <div class="tool-args">
                            <strong>${lang.t('arguments')}:</strong>
                            <pre>${escapeHtml(formatToolData(toolUsage.args, true))}</pre>
                        </div>
                        <div class="tool-result">
                            <strong>${lang.t('result')}:</strong>
                            <pre>${escapeHtml(formatToolData(toolUsage.result, true))}</pre>
                        </div>
                    </div>
                `;
            }
        }
        scrollToBottom();
    }
}

function handleAgentStatus(data) {
    if (data.agentId === currentAgent?.id) {
        currentAgent.status = data.status;
        if (data.status === 'stopped') stopAgentLiveFeatures();
        currentAgentStatus.textContent = getStatusText(data.status);
        // Use status directly as CSS class name (no spaces, uses underscores)
        currentAgentStatus.className = `status-badge status-${data.status}`;
        
        // Update clear history button state
        clearHistoryBtn.disabled = isAgentWorking(currentAgent);
        
        updateInputState();
    }
    requestStatusUpdate();
}

function stopAgentLiveFeatures() {
    if (isTrueLiveMode || trueLiveMediaStream) stopTrueLiveMode();
    if (isLiveConnected || mediaStream) stopLiveConnection();
    updateInputState();
}

function handleAgentError(data) {
    console.error('Agent error:', data.error);
    alert(`${lang.t('agentError')}: ${data.error}`);
}

function handleAgentHistory(data) {
    const { history } = data;
    clearMessages();
    
    if (history && history.length > 0) {
        // Sort history by timestamp to ensure correct order
        const sortedHistory = [...history].sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeA - timeB;
        });
        
        // Store sorted history globally for plugin GUIs to access
        window.agentHistory = sortedHistory;
        
        // Group consecutive assistant messages without toolUsage
        let currentAssistantMessage = null;
        let currentAssistantTimestamp = null;
        let currentStreamStartTime = null; // Track stream start time for grouping
        
        sortedHistory.forEach(msg => {
            if (msg.role === 'cron') {
                // Flush any pending assistant message
                if (currentAssistantMessage) {
                    addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                    currentAssistantMessage = null;
                    currentAssistantTimestamp = null;
                    currentStreamStartTime = null;
                }
                // Cron messages are now handled by the cron plugin GUI
            } else if (msg.role === 'agent') {
                // Flush any pending assistant message
                if (currentAssistantMessage) {
                    addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                    currentAssistantMessage = null;
                    currentAssistantTimestamp = null;
                    currentStreamStartTime = null;
                }
                // Add agent-to-agent message via plugin GUI
                addAgentToAgentMessageToPluginGUI(msg);
            } else if (msg.role === 'system') {
                // Flush any pending assistant message
                if (currentAssistantMessage) {
                    addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                    currentAssistantMessage = null;
                    currentAssistantTimestamp = null;
                    currentStreamStartTime = null;
                }
                addSystemMessageToUI(msg);
            } else if (msg.role === 'user') {
                // Flush any pending assistant message
                if (currentAssistantMessage) {
                    addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                    currentAssistantMessage = null;
                    currentAssistantTimestamp = null;
                    currentStreamStartTime = null;
                }
                addMessageToUI('user', msg.content, null, msg.timestamp);
            } else if (msg.role === 'assistant') {
                // Check if this is a tool-related message
                if (msg.toolUsage && msg.toolUsage.type) {
                    // Flush any pending assistant message before tool
                    if (currentAssistantMessage) {
                        addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                        currentAssistantMessage = null;
                        currentAssistantTimestamp = null;
                        currentStreamStartTime = null;
                    }
                    // Check if this tool belongs to a plugin with GUI
                    if (isToolFromPluginWithGUI(msg.toolUsage.tool)) {
                        addToolToPluginGUI(msg.toolUsage, msg.timestamp);
                    } else {
                        addToolMessageToUI(msg.toolUsage, msg.timestamp);
                    }
                } else if (msg.content) {
                    // Check if this is a stream chunk
                    if (msg.isStreamChunk) {
                        // Check if this chunk belongs to the same stream
                        if (msg.streamStartTime === currentStreamStartTime) {
                            // Same stream - append to current message
                            currentAssistantMessage += msg.content;
                        } else {
                            // Different stream - flush previous and start new
                            if (currentAssistantMessage) {
                                addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                            }
                            currentAssistantMessage = msg.content;
                            currentAssistantTimestamp = msg.streamStartTime || msg.timestamp;
                            currentStreamStartTime = msg.streamStartTime;
                        }
                    } else {
                        // Non-stream message - flush any pending stream message
                        if (currentAssistantMessage) {
                            addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
                            currentAssistantMessage = null;
                            currentAssistantTimestamp = null;
                            currentStreamStartTime = null;
                        }
                        // Start new non-stream message
                        currentAssistantMessage = msg.content;
                        currentAssistantTimestamp = msg.timestamp;
                    }
                }
            }
        });
        
        // Flush any remaining assistant message
        if (currentAssistantMessage) {
            addMessageToUI('assistant', currentAssistantMessage, null, currentAssistantTimestamp);
            currentAssistantMessage = null;
            currentAssistantTimestamp = null;
            currentStreamStartTime = null;
        }
        
        // Scroll to bottom after loading history
        scrollToBottom();
    }
}

function handleAgentHistoryCleared(data) {
    if (data.agentId === currentAgent?.id) {
        clearMessages();
        addSystemMessage(lang.t('historyCleared'));
    }
}

// Cron Event Handlers
function handleCronTasksStatus(data) {
    cronTasks = data.tasks || [];
    updateCronList();
}

function handleCronTaskCreated(data) {
    socket.emit('request-cron-tasks');
}

function handleCronTaskDeleted(data) {
    socket.emit('request-cron-tasks');
}

function handleCronTaskUpdated(data) {
    socket.emit('request-cron-tasks');
}

function handleCronTaskExecuted(data) {
    console.log('Cron task executed:', data);
    // Could show notification here
}

function handleCronTaskError(data) {
    console.error('Cron task error:', data.error);
    alert(`${lang.t('cronTaskError')}: ${data.error}`);
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

// Tool outputs are untrusted: display them as text, never as executable HTML.
function formatToolData(value, pretty = false) {
    if (typeof value === 'string') return value;
    try {
        const formatted = JSON.stringify(value, null, pretty ? 2 : 0);
        return formatted ?? String(value ?? '');
    } catch {
        return String(value ?? '');
    }
}

// Make cron functions globally available
window.editCronTask = editCronTask;
window.deleteCronTask = deleteCronTask;
window.startCronTask = startCronTask;
window.stopCronTask = stopCronTask;
window.pauseCronTask = pauseCronTask;
window.resumeCronTask = resumeCronTask;

// Agent Settings Functions
async function openAgentSettings() {
    if (!currentAgent) {
        alert(lang.t('selectAgentFirst'));
        return;
    }

    const agentId = currentAgent.id;
    if (editAgentModelInput) {
        editAgentModelInput.disabled = true;
        editAgentModelInput.innerHTML = `<option value="" selected>${escapeHtml(lang.t('modelsLoading'))}</option>`;
    }
    await loadAvailableModels();
    if (!currentAgent || currentAgent.id !== agentId) return;

    if (editAgentNameInput) {
        editAgentNameInput.value = currentAgent.name || '';
    }
    editedAgentAvatar = agentAvatars[currentAgent.id] || null;
    removeEditedAgentAvatar = false;
    if (editAgentAvatarFileInput) editAgentAvatarFileInput.value = '';
    updateAgentAvatarPreview();
    if (editAgentPromptInput) {
        editAgentPromptInput.value = currentAgent.prompt || '';
    }
    if (editAgentModelInput) {
        const currentModel = currentAgent.model || 'gemini-2.5-flash';
        if (![...editAgentModelInput.options].some(option => option.value === currentModel)) {
            const option = document.createElement('option');
            option.value = currentModel;
            option.dataset.provider = currentAgent.provider || '';
            option.textContent = currentModel;
            editAgentModelInput.insertBefore(option, editAgentModelInput.firstChild);
        }
        editAgentModelInput.value = currentModel;
        editAgentModelInput.disabled = false;
    }

    // Set voice input and show/hide voice selector based on model
    const voiceSettingsGroup = document.getElementById('voice-settings-group');
    if (editAgentVoiceInput) {
        editAgentVoiceInput.value = currentAgent.voice || 'Puck';
    }

    // Show voice selector only for Google Live models
    if (voiceSettingsGroup) {
        const isLiveModel = currentAgent.model && (currentAgent.model.includes('-live-preview') || currentAgent.model.includes('-live'));
        voiceSettingsGroup.style.display = isLiveModel ? 'block' : 'none';
    }

    agentSettingsModal.classList.add('active');
    await loadTools();
}

// Add event listener to model select to show/hide voice selector
if (editAgentModelInput) {
    editAgentModelInput.addEventListener('change', (e) => {
        const voiceSettingsGroup = document.getElementById('voice-settings-group');
        if (voiceSettingsGroup) {
            const selectedModel = e.target.value;
            const isLiveModel = selectedModel && (selectedModel.includes('-live-preview') || selectedModel.includes('-live'));
            voiceSettingsGroup.style.display = isLiveModel ? 'block' : 'none';
        }
    });
}

async function saveAgentSettings() {
    if (!currentAgent) return;

    const name = editAgentNameInput.value.trim();
    const prompt = editAgentPromptInput.value.trim();
    const model = editAgentModelInput.value;
    const provider = editAgentModelInput.selectedOptions[0]?.dataset.provider || null;
    const voice = editAgentVoiceInput ? editAgentVoiceInput.value : 'Puck';

    if (!name || !prompt) {
        alert(lang.t('enterAgentName'));
        return;
    }

    try {
        if (removeEditedAgentAvatar) delete agentAvatars[currentAgent.id];
        else if (editedAgentAvatar) agentAvatars[currentAgent.id] = editedAgentAvatar;
        localStorage.setItem(agentAvatarsStorageKey, JSON.stringify(agentAvatars));
    } catch (error) {
        console.error('Unable to save agent avatar:', error);
        alert(lang.t('avatarSaveError'));
        return;
    }

    // Update agent basic settings
    socket.emit('update-agent', { agentId: currentAgent.id, name, prompt, model, provider, voice });

    agentSettingsModal.classList.remove('active');
    updateAgentList(); // Refresh the agent list to show updated status
}

async function loadTools() {
    try {
        // Get all available plugins and their tools
        const pluginsResponse = await fetch('/api/plugins');
        const pluginsData = await pluginsResponse.json();
        const allPlugins = pluginsData.plugins || [];

        // Get enabled tools for current agent
        const enabledResponse = await fetch(`/api/agents/${currentAgent.id}/tools`);
        const enabledData = await enabledResponse.json();
        const enabledTools = enabledData.enabledTools || [];

        renderToolsByPlugins(allPlugins, enabledTools);
    } catch (error) {
        console.error('Error loading tools:', error);
        alert(lang.t('toolsLoadError'));
    }
}

async function loadToolsForCreateAgent() {
    try {
        // Get all available plugins and their tools
        const pluginsResponse = await fetch('/api/plugins');
        const pluginsData = await pluginsResponse.json();
        const allPlugins = pluginsData.plugins || [];

        // For new agent, enable all tools by default
        renderToolsByPluginsForCreate(allPlugins);
    } catch (error) {
        console.error('Error loading tools for create agent:', error);
    }
}

function renderToolsByPlugins(allPlugins, enabledTools) {
    if (!toolsContainer) return;
    
    toolsContainer.innerHTML = '';
    
    if (allPlugins.length === 0) {
        toolsContainer.innerHTML = '<div class="empty-state">' + lang.t('noPlugins') + '</div>';
        return;
    }
    
    allPlugins.forEach(plugin => {
        const pluginDiv = document.createElement('div');
        pluginDiv.className = 'plugin-tools-group';
        
        const isPluginEnabled = plugin.enabled !== false;
        const pluginTools = plugin.tools || [];
        
        pluginDiv.innerHTML = `
            <div class="plugin-tools-header">
                <div class="plugin-tools-info">
                    <span class="plugin-tools-name">${plugin.name}</span>
                    <span class="plugin-tools-version">v${plugin.version}</span>
                    <span class="plugin-tools-category">${plugin.category}</span>
                    ${!isPluginEnabled ? '<span class="plugin-status-badge">' + lang.t('disabled') + '</span>' : ''}
                </div>
                <div class="plugin-tools-count">${pluginTools.length} tool</div>
            </div>
            <div class="plugin-tools-list">
                ${pluginTools.map(tool => {
                    const fullToolName = `${plugin.name}.${tool}`;
                    const isEnabled = enabledTools.includes(fullToolName);
                    return `
                        <div class="tool-item ${!isPluginEnabled ? 'disabled' : ''}">
                            <div class="tool-info">
                                <div class="tool-name">${tool}</div>
                                <div class="tool-full-name">${fullToolName}</div>
                            </div>
                            <label class="tool-toggle ${!isPluginEnabled ? 'disabled' : ''}">
                                <input type="checkbox" 
                                       ${isEnabled ? 'checked' : ''} 
                                       ${!isPluginEnabled ? 'disabled' : ''}
                                       onchange="toggleTool('${fullToolName}', this.checked)">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        toolsContainer.appendChild(pluginDiv);
    });
}

function renderToolsByPluginsForCreate(allPlugins) {
    const container = document.getElementById('create-agent-tools-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (allPlugins.length === 0) {
        container.innerHTML = '<div class="empty-state">' + lang.t('noPlugins') + '</div>';
        return;
    }
    
    allPlugins.forEach(plugin => {
        const pluginDiv = document.createElement('div');
        pluginDiv.className = 'plugin-tools-group';
        
        const isPluginEnabled = plugin.enabled !== false;
        const pluginTools = plugin.tools || [];
        
        pluginDiv.innerHTML = `
            <div class="plugin-tools-header">
                <div class="plugin-tools-info">
                    <span class="plugin-tools-name">${plugin.name}</span>
                    <span class="plugin-tools-version">v${plugin.version}</span>
                    <span class="plugin-tools-category">${plugin.category}</span>
                    ${!isPluginEnabled ? '<span class="plugin-status-badge">' + lang.t('disabled') + '</span>' : ''}
                </div>
                <div class="plugin-tools-count">${pluginTools.length} tool</div>
            </div>
            <div class="plugin-tools-list">
                ${pluginTools.map(tool => {
                    const fullToolName = `${plugin.name}.${tool}`;
                    return `
                        <div class="tool-item ${!isPluginEnabled ? 'disabled' : ''}">
                            <div class="tool-info">
                                <div class="tool-name">${tool}</div>
                                <div class="tool-full-name">${fullToolName}</div>
                            </div>
                            <label class="tool-toggle ${!isPluginEnabled ? 'disabled' : ''}">
                                <input type="checkbox" 
                                       checked
                                       ${!isPluginEnabled ? 'disabled' : ''}
                                       class="create-agent-tool-checkbox"
                                       data-tool-name="${fullToolName}">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        container.appendChild(pluginDiv);
    });
}

async function toggleTool(toolName, enabled) {
    if (!currentAgent) {
        alert(lang.t('selectAgentFirst'));
        return;
    }

    try {
        const endpoint = enabled ? 'enable' : 'disable';
        const response = await fetch(`/api/agents/${currentAgent.id}/tools/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ toolName })
        });

        if (!response.ok) {
            throw new Error(lang.t('toolSettingError'));
        }

        console.log(`Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        console.error('Error toggling tool:', error);
        alert(lang.t('toolSettingToggleError'));
        // Revert the toggle
        await loadTools();
    }
}

// Make toggleTool globally available
window.toggleTool = toggleTool;

// Live Voice Connection Functions
function toggleLiveConnection() {
    if (!currentAgent) {
        alert(lang.t('selectAgentFirst'));
        return;
    }
    if (currentAgent.status === 'stopped') return;

    // Toggle live connection
    if (isLiveConnected) {
        stopLiveConnection();
    } else {
        startLiveConnection();
    }
}

async function startLiveConnection() {
    if (!currentAgent || currentAgent.status === 'stopped') return;
    try {
        // Request microphone access
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!currentAgent || currentAgent.status === 'stopped') {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
            return;
        }
        
        // Initialize Web Speech API for speech recognition
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = currentLanguage === 'tr' ? 'tr-TR' : currentLanguage === 'en' ? 'en-US' : currentLanguage;

        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            if (finalTranscript) {
                // Send final transcript to agent
                messageInput.value = finalTranscript;
                sendMessage();
                messageInput.value = '';
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error === 'not-allowed') {
                alert(lang.t('microphonePermissionDenied'));
                stopLiveConnection();
            }
        };

        recognition.onend = () => {
            if (isLiveConnected) {
                // Restart recognition if still connected
                recognition.start();
            }
        };

        // Start recognition
        recognition.start();

        // Update UI
        isLiveConnected = true;
        liveConnectBtn.classList.add('active');
        messageInput.disabled = true;
        sendBtn.disabled = true;

        // Add system message
        addSystemMessage(lang.t('liveVoiceConnectionStarted'));

    } catch (error) {
        console.error('Error starting live connection:', error);
        alert(lang.t('liveVoiceConnectionFailed') + ': ' + error.message);
    }
}

function stopLiveConnection(silent = false) {
    // Stop speech recognition
    if (recognition) {
        recognition.stop();
        recognition = null;
    }

    // Stop media stream
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Stop any ongoing speech
    if (synthesis) {
        synthesis.cancel();
    }

    // Update UI
    isLiveConnected = false;
    liveConnectBtn.classList.remove('active');
    messageInput.disabled = false;
    sendBtn.disabled = false;

    // Add system message
    if (!silent) addSystemMessage(lang.t('liveVoiceConnectionEnded'));
}

function playAudioResponse(audioData) {
    // Convert base64 audio data and play
    try {
        const audioBlob = base64ToBlob(audioData, 'audio/mp3');
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        
        audio.onended = () => {
            URL.revokeObjectURL(audioUrl);
        };
        
        // Play through output context in true-live mode
        if (isTrueLiveMode && trueLiveOutputAudioContext) {
            // Resume audio context (browser restriction)
            if (trueLiveOutputAudioContext.state === 'suspended') {
                trueLiveOutputAudioContext.resume();
            }
            
            const source = trueLiveOutputAudioContext.createMediaElementSource(audio);
            source.connect(trueLiveOutputAudioContext.destination);
            audio.play().catch(error => {
                console.error('Error playing audio:', error);
            });
        } else {
            audio.play().catch(error => {
                console.error('Error playing audio:', error);
            });
        }
    } catch (error) {
        console.error('Error processing audio:', error);
    }
}

// Microphone Status Check Function
async function checkMicrophoneStatus() {
    try {
        // Check microphone permission
        const permission = await navigator.permissions.query({ name: 'microphone' });
        if (permission.state === 'granted') {
            // Permission granted, check if stream exists
            return trueLiveMediaStream !== null;
        } else if (permission.state === 'prompt') {
            // Permission not yet granted
            return false;
        } else {
            // Permission denied
            return false;
        }
    } catch (error) {
        // The Permissions API is unsupported; check the stream state instead.
        return trueLiveMediaStream !== null;
    }
}

// Microphone Toggle Function
async function toggleMicrophone() {
    if (!currentAgent) {
        alert(lang.t('selectAgentFirst'));
        return;
    }
    if (currentAgent.status === 'stopped' || !isTrueLiveMode) return;
    const sessionAgentId = currentAgent.id;

    // Check microphone status
    const currentMicStatus = await checkMicrophoneStatus();
    if (!currentAgent || currentAgent.id !== sessionAgentId || currentAgent.status === 'stopped' || !isTrueLiveMode) return;

    if (currentMicStatus) {
        // Microphone already open, close it
        if (trueLiveProcessor) {
            trueLiveProcessor.disconnect();
            trueLiveProcessor = null;
        }
        if (trueLiveInputAudioContext) {
            trueLiveInputAudioContext.close();
            trueLiveInputAudioContext = null;
        }
        trueLiveMediaStream.getTracks().forEach(track => track.stop());
        trueLiveMediaStream = null;
        micBtn.innerHTML = '🎙️ <span data-lang="microphoneButton">' + lang.t('microphoneButton') + '</span>';
        micBtn.classList.remove('active');
        micBtn.title = lang.t('microphoneButton');
        addSystemMessage(lang.t('microphoneClosed'));
    } else {
        // Microphone closed, open and start audio processing
        try {
            trueLiveMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!currentAgent || currentAgent.id !== sessionAgentId || currentAgent.status === 'stopped' || !isTrueLiveMode) {
                trueLiveMediaStream.getTracks().forEach(track => track.stop());
                trueLiveMediaStream = null;
                return;
            }
            
            // Input Context at 16kHz
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            trueLiveInputAudioContext = new AudioCtxClass({ sampleRate: 16000 });
            
            // Create audio worklet for processing
            const source = trueLiveInputAudioContext.createMediaStreamSource(trueLiveMediaStream);
            trueLiveProcessor = trueLiveInputAudioContext.createScriptProcessor(4096, 1, 1);
            
            trueLiveProcessor.onaudioprocess = (event) => {
                const inputData = event.inputBuffer.getChannelData(0);
                
                // Convert float32 to int16 PCM
                const pcmBuffer = floatTo16BitPCM(inputData);
                
                // Convert to base64 and send to server
                const base64 = base64ArrayBuffer(pcmBuffer);
                socket.emit('true-live-audio-input', {
                    agentId: sessionAgentId,
                    audioData: base64
                });
            };
            
            source.connect(trueLiveProcessor);
            trueLiveProcessor.connect(trueLiveInputAudioContext.destination);
            
            // Initialize audio output connection
            if (!trueLiveOutputAudioContext) {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                trueLiveOutputAudioContext = new AudioCtxClass({ sampleRate: 24000 });
            }
            
            micBtn.innerHTML = '🔴 ' + lang.t('microphoneActiveButton');
            micBtn.classList.add('active');
            micBtn.title = lang.t('microphoneActiveButton');
            addSystemMessage(lang.t('microphoneOpenAndProcessing'));
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert(lang.t('microphoneAccessError') + ': ' + error.message);
        }
    }
}

// True Live Mode Functions
async function toggleTrueLiveMode() {
    if (!currentAgent) {
        alert(lang.t('selectAgentFirst'));
        return;
    }
    if (currentAgent.status === 'stopped') return;

    // Should only work with Google Live models
    if (!currentAgent.model || !currentAgent.model.includes('gemini')) {
        alert(lang.t('onlyGoogleLive'));
        return;
    }

    if (isTrueLiveMode) {
        stopTrueLiveMode();
        // Hide connection bar (switched to normal mode)
        liveConnectionBar.classList.add('hidden');
        
        // Hide the microphone button
        if (micBtn) {
            micBtn.style.display = 'none';
        }
    } else {
        startTrueLiveMode();
        // Show connection bar (switched to live mode)
        liveConnectionBar.classList.remove('hidden');
        
        // Show microphone button
        if (micBtn) {
            micBtn.style.display = 'block';
            micBtn.disabled = false;
        }
    }
}

async function startTrueLiveMode() {
    if (!currentAgent || currentAgent.status === 'stopped') return;
    const sessionAgentId = currentAgent.id;

    try {
        console.log('Starting True Live mode for agent:', sessionAgentId);

        // Request microphone access
        trueLiveMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!currentAgent || currentAgent.id !== sessionAgentId || currentAgent.status === 'stopped') {
            trueLiveMediaStream.getTracks().forEach(track => track.stop());
            trueLiveMediaStream = null;
            return;
        }

        // Input Context at 16kHz (test kodundaki gibi)
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        trueLiveInputAudioContext = new AudioCtxClass({ sampleRate: 16000 });

        // Output Context at 24kHz (test kodundaki gibi)
        trueLiveOutputAudioContext = new AudioCtxClass({ sampleRate: 24000 });

        // Create audio worklet for processing
        const source = trueLiveInputAudioContext.createMediaStreamSource(trueLiveMediaStream);
        trueLiveProcessor = trueLiveInputAudioContext.createScriptProcessor(4096, 1, 1);

        trueLiveProcessor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            
            // Convert float32 to int16 PCM (test kodundaki gibi)
            const pcmBuffer = floatTo16BitPCM(inputData);
            
            // Convert to base64 and send to server
            const base64 = base64ArrayBuffer(pcmBuffer);
            socket.emit('true-live-audio-input', {
                agentId: sessionAgentId,
                audioData: base64
            });
        };

        source.connect(trueLiveProcessor);
        trueLiveProcessor.connect(trueLiveInputAudioContext.destination);

        // True Live modunu backend'e bildir
        socket.emit('set-true-live-mode', { agentId: sessionAgentId, enabled: true });

        // Start True Live session
        socket.emit('start-true-live-session', { agentId: sessionAgentId });

        // Update UI
        isTrueLiveMode = true;
        trueLiveBtn.classList.add('active');
        trueLiveBtn.innerHTML = '🔴 ' + lang.t('trueLiveActiveButton');
        trueLiveBtn.title = lang.t('trueLiveActiveButton');
        
        // Hide the Live Connect button
        if (liveConnectBtn) {
            liveConnectBtn.style.display = 'none';
        }
        
        // Disable normal mode buttons
        messageInput.disabled = true;
        sendBtn.disabled = true;
        liveConnectBtn.disabled = true;

        addSystemMessage(lang.t('trueLiveActiveMessage'));

    } catch (error) {
        console.error('Error starting True Live mode:', error);
        alert(lang.t('trueLiveStartFailed') + ': ' + error.message);
    }
}

function releaseTrueLiveAudioForAgentSwitch() {
    stopAndClearTrueLivePlayback();
    if (trueLiveMediaStream) {
        trueLiveMediaStream.getTracks().forEach(track => track.stop());
        trueLiveMediaStream = null;
    }
    if (trueLiveProcessor) {
        trueLiveProcessor.disconnect();
        trueLiveProcessor = null;
    }
    if (trueLiveInputAudioContext) {
        trueLiveInputAudioContext.close();
        trueLiveInputAudioContext = null;
    }
    if (trueLiveOutputAudioContext) {
        trueLiveOutputAudioContext.close();
        trueLiveOutputAudioContext = null;
    }

    // The microphone belongs to this browser tab; the agent's server-side Live session stays active.
    isTrueLiveMode = false;
    if (trueLiveBtn) {
        trueLiveBtn.classList.remove('active');
        trueLiveBtn.innerHTML = '🎙️ <span data-lang="trueLiveButton">' + lang.t('trueLiveButton') + '</span>';
        trueLiveBtn.title = lang.t('trueLiveButton');
    }
    if (liveConnectBtn) liveConnectBtn.style.display = 'inline-block';
    if (micBtn) micBtn.style.display = 'none';
    messageInput.disabled = false;
    sendBtn.disabled = false;
}

function stopTrueLiveMode() {
    if (!currentAgent) return;

    console.log('Stopping True Live mode for agent:', currentAgent.id);

    // Stop active audio sources
    stopAndClearTrueLivePlayback();

    // Stop media stream
    if (trueLiveMediaStream) {
        trueLiveMediaStream.getTracks().forEach(track => track.stop());
        trueLiveMediaStream = null;
    }

    // Disconnect processor
    if (trueLiveProcessor) {
        trueLiveProcessor.disconnect();
        trueLiveProcessor = null;
    }

    // Close audio contexts
    if (trueLiveInputAudioContext) {
        trueLiveInputAudioContext.close();
        trueLiveInputAudioContext = null;
    }
    if (trueLiveOutputAudioContext) {
        trueLiveOutputAudioContext.close();
        trueLiveOutputAudioContext = null;
    }

    // Stop True Live session
    socket.emit('stop-true-live-session', { agentId: currentAgent.id });

    // True Live modunu backend'e bildir
    socket.emit('set-true-live-mode', { agentId: currentAgent.id, enabled: false });

    // Update UI
    isTrueLiveMode = false;
    trueLiveBtn.classList.remove('active');
    trueLiveBtn.innerHTML = '🎙️ <span data-lang="trueLiveButton">' + lang.t('trueLiveButton') + '</span>';
    trueLiveBtn.title = lang.t('trueLiveButton');
    
    // Show Live Connect button
    if (liveConnectBtn) {
        liveConnectBtn.style.display = 'inline-block';
    }
    
    // Enable normal mode buttons
    messageInput.disabled = false;
    sendBtn.disabled = false;
    liveConnectBtn.disabled = false;

    addSystemMessage(lang.t('trueLiveClosedMessage'));
}

function stopAndClearTrueLivePlayback() {
    trueLiveActiveSources.forEach(source => {
        try {
            source.stop();
        } catch (e) {
            // Ignored if already ended
        }
    });
    trueLiveActiveSources = [];
    trueLiveNextStartTime = 0;
}

// Convert Float32Array from browser mic stream to 16-bit PCM ArrayBuffer (test kodundaki gibi)
function floatTo16BitPCM(input) {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < input.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
}

// Convert ArrayBuffer to Base64 (test kodundaki gibi)
function base64ArrayBuffer(arrayBuffer) {
    let binary = "";
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
}

// Convert Base64 back to Float32Array (test kodundaki gibi)
function base64ToFloat32(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const int16Array = new Int16Array(bytes.buffer);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    return float32Array;
}

function playTrueLiveAudio(audioData) {
    try {
        if (!trueLiveOutputAudioContext) return;
        const ctx = trueLiveOutputAudioContext;
        
        // Resume context if browser suspended it (autoplay protections)
        if (ctx.state === "suspended") {
            ctx.resume();
        }

        // Convert base64 to Float32Array (test kodundaki gibi)
        const float32Data = base64ToFloat32(audioData);
        const buffer = ctx.createBuffer(1, float32Data.length, 24000);
        buffer.copyToChannel(float32Data, 0);

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        // Jitter-free scheduling (test kodundaki gibi)
        if (trueLiveNextStartTime < currentTime) {
            trueLiveNextStartTime = currentTime;
        }

        source.start(trueLiveNextStartTime);
        trueLiveNextStartTime += buffer.duration;
        
        trueLiveActiveSources.push(source);
        
        source.onended = () => {
            trueLiveActiveSources = trueLiveActiveSources.filter(s => s !== source);
        };

    } catch (error) {
        console.error('Error playing True Live audio:', error);
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: mimeType });
}

function speakText(text) {
    if (!synthesis) return;
    
    // Cancel any ongoing speech
    synthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    synthesis.speak(utterance);
}

function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message system';
    messageDiv.innerHTML = `
        <div class="message-content">
            <span class="system-text">${text}</span>
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    scrollToBottom();
}

// Socket event handlers for live audio
socket.on('live-audio-response', (data) => {
    if (data.agentId === currentAgent?.id && (isLiveConnected || isTrueLiveMode)) {
        playAudioResponse(data.audioData);
    }
});

// Periodic microphone status check (every 5 seconds)
setInterval(async () => {
    if (isTrueLiveMode && micBtn && micBtn.style.display !== 'none') {
        const micStatus = await checkMicrophoneStatus();
        if (micStatus && !micBtn.classList.contains('active')) {
            micBtn.innerHTML = '🔴 ' + lang.t('microphoneActiveButton');
            micBtn.classList.add('active');
            micBtn.title = lang.t('microphoneActiveButton');
        } else if (!micStatus && micBtn.classList.contains('active')) {
            micBtn.innerHTML = '🎙️ <span data-lang="microphoneButton">' + lang.t('microphoneButton') + '</span>';
            micBtn.classList.remove('active');
            micBtn.title = lang.t('microphoneButton');
        }
    }
}, 5000);

socket.on('live-text-response', (data) => {
    if (data.agentId === currentAgent?.id && isLiveConnected) {
        // Display the text response
        const message = {
            role: 'assistant',
            content: data.text,
            timestamp: new Date().toISOString()
        };
        
        // Add to messages
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-sender">${currentAgent.name}</div>
                <div class="message-text">${data.text}</div>
                <div class="message-time">${new Date().toLocaleTimeString()}</div>
            </div>
        `;
        messagesContainer.appendChild(messageDiv);
        scrollToBottom();
        
        // Also speak the text
        speakText(data.text);
    }
});

// Live Connection Status Events
socket.on('live-connection-status', (data) => {
    if (data.agentId === currentAgent?.id) {
        console.log('Live connection status update:', data);
        updateLiveConnectionStatus(data.status, data.message, data);
    }
});

// Live Ping Event (Google Live API uses its own connection management, not needed)
socket.on('live-ping', (data) => {
    if (data.agentId === currentAgent?.id) {
        // Google Live API uses its own connection management, ping/pong not needed
        console.log('Ping received (Google Live API uses its own connection management)');
    }
});

// True Live Mode Socket Events
socket.on('true-live-mode-set', (data) => {
    if (data.agentId === currentAgent?.id) {
        console.log('True Live mode set:', data.enabled);
        if (!data.success) {
            addSystemMessage(lang.t('trueLiveSettingFailed'));
        }
    }
});

socket.on('true-live-session-started', (data) => {
    if (data.agentId === currentAgent?.id) {
        if (data.success) {
            addSystemMessage(lang.t('trueLiveSessionStarted'));
        } else {
            addSystemMessage(lang.t('trueLiveSessionStartFailed'));
            isTrueLiveMode = false;
            trueLiveBtn.classList.remove('active');
            trueLiveBtn.innerHTML = '🎙️ <span data-lang="trueLiveButton">' + lang.t('trueLiveButton') + '</span>';
            trueLiveBtn.title = lang.t('trueLiveButton');
            
            // Show Live Connect button
            if (liveConnectBtn) {
                liveConnectBtn.style.display = 'inline-block';
            }
            
            messageInput.disabled = false;
            sendBtn.disabled = false;
            liveConnectBtn.disabled = false;
        }
    }
});

socket.on('true-live-session-stopped', (data) => {
    if (data.agentId === currentAgent?.id) {
        addSystemMessage('True Live session stopped.');
    }
});

socket.on('true-live-session-error', (data) => {
    if (data.agentId === currentAgent?.id) {
        addSystemMessage(lang.t('trueLiveSessionError') + ': ' + data.error);
        isTrueLiveMode = false;
        trueLiveBtn.classList.remove('active');
        trueLiveBtn.innerHTML = '🎙️ <span data-lang="trueLiveButton">' + lang.t('trueLiveButton') + '</span>';
        trueLiveBtn.title = lang.t('trueLiveButton');
        
        // Show Live Connect button
        if (liveConnectBtn) {
            liveConnectBtn.style.display = 'inline-block';
        }
        
        messageInput.disabled = false;
        sendBtn.disabled = false;
        liveConnectBtn.disabled = false;
    }
});

socket.on('live-tool-call-started', (data) => {
    if (data.agentId === currentAgent?.id && isTrueLiveMode) {
        // Run silently - don't show system message
        console.log(`Tool call started: ${data.name}`);
    }
});

socket.on('live-tool-call-result', (data) => {
    if (data.agentId === currentAgent?.id && isTrueLiveMode) {
        // Run silently - don't show system message
        console.log(`Tool completed: ${data.name}`);
    }
});

socket.on('live-interrupted', (data) => {
    if (data.agentId === currentAgent?.id && isTrueLiveMode) {
        // Show message on actual interruption
        addSystemMessage(lang.t('aiResponseInterrupted'));
        stopAndClearTrueLivePlayback();
    }
});

socket.on('live-audio-response', (data) => {
    if (data.agentId === currentAgent?.id && isTrueLiveMode) {
        playTrueLiveAudio(data.audioData);
    }
});

// Server restart handler
function handleServerRestarted(data) {
    console.log('Server restarted:', data);
    
    // Show notification
    showNotification(lang.t('serverRestarting'), 'info');
    
    // Reload all data
    requestStatusUpdate();
    requestCronStatus();
    requestPluginsStatus();
    
    // If current agent exists, reload its history and messages
    if (currentAgent) {
        // Wait a bit for the status update to complete
        setTimeout(() => {
            socket.emit('get-agent-history', { agentId: currentAgent.id });
            
            // After getting history, re-render messages
            socket.once('agent-history', (historyData) => {
                currentAgent.history = historyData.history;
                renderMessages();
            });
        }, 1000);
    }
}

// Render messages from history
function renderMessagesFromHistory(history) {
    if (!history || !Array.isArray(history)) return;
    
    // Clear current messages
    messagesContainer.innerHTML = '';
    
    // Render each message from history
    history.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role}`;
        
        if (message.role === 'user') {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <span class="message-text">${escapeHtml(message.content)}</span>
                </div>
            `;
        } else if (message.role === 'assistant') {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <span class="message-text">${escapeHtml(message.content)}</span>
                </div>
            `;
        }
        
        messagesContainer.appendChild(messageDiv);
    });
    
    scrollToBottom();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Simple notification function
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Add styles if not exists
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                background: #333;
                color: white;
                border-radius: 5px;
                z-index: 10000;
                animation: slideIn 0.3s ease-out;
                max-width: 300px;
            }
            .notification-info {
                background: #2196F3;
            }
            .notification-success {
                background: #4CAF50;
            }
            .notification-error {
                background: #f44336;
            }
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
    }
    
    // Add to DOM
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease-out reverse';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Plugins status handler
function handlePluginsStatus(data) {
    if (data && data.plugins) {
        plugins = data.plugins;
        renderPluginsList();
    }
}

// Settings Functions
// Settings Input Elements are already declared above
async function loadSettings() {
    await loadCustomProviderApiKeys();
    try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        console.log('Loaded config:', data); // Debug
        
        if (data.config) {
            const config = data.config;
            
            // API Keys (load actual key if exists)
            if (config.apiKeys) {
                if (googleApiKeyInput) {
                    googleApiKeyInput.dataset.hasKey = config.apiKeys.hasGoogleKey ? 'true' : 'false';
                    if (config.apiKeys.hasGoogleKey) {
                        // Load actual key from server
                        loadApiKey('google', googleApiKeyInput);
                    } else {
                        googleApiKeyInput.value = '';
                    }
                    console.log('Google API key has value:', config.apiKeys.hasGoogleKey ? 'yes' : 'no');
                }
                if (geminiApiKeyInput) {
                    geminiApiKeyInput.dataset.hasKey = config.apiKeys.hasGeminiKey ? 'true' : 'false';
                    if (config.apiKeys.hasGeminiKey) {
                        // Load actual key from server
                        loadApiKey('gemini', geminiApiKeyInput);
                    } else {
                        geminiApiKeyInput.value = '';
                    }
                    console.log('Gemini API key has value:', config.apiKeys.hasGeminiKey ? 'yes' : 'no');
                }
            }
            
            // Server settings
            if (config.server) {
                if (serverPortInput) serverPortInput.value = config.server.port || 3000;
                if (serverHostInput) serverHostInput.value = config.server.host || 'localhost';
            }

            // Update settings
            if (config.update) {
                console.log('Loading update settings:', config.update);
                if (updateCheckOnStartupInput) {
                    updateCheckOnStartupInput.checked = config.update.checkOnStartup !== false;
                    console.log('Update check on startup set to:', updateCheckOnStartupInput.checked);
                }
                if (updateCheckIntervalInput) {
                    updateCheckIntervalInput.value = config.update.checkInterval || 5;
                    console.log('Update check interval set to:', updateCheckIntervalInput.value);
                }
                if (updateAutoUpdateInput) {
                    updateAutoUpdateInput.checked = config.update.autoUpdate || false;
                    console.log('Auto update set to:', updateAutoUpdateInput.checked);
                }
            } else {
                console.log('No update config found');
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification(lang.t('settingsLoadError'), 'error');
    }
}

async function loadCustomProviderApiKeys() {
    const container = document.getElementById('custom-provider-api-keys');
    if (!container) return;
    try {
        const response = await fetch('/api/models/providers');
        const data = await response.json();
        container.innerHTML = '';
        Object.entries(data.providers || {}).forEach(([providerId, provider]) => {
            if (provider.type !== 'custom') return;
            const group = document.createElement('div'); group.className = 'form-group custom-provider-key-row';
            const label = document.createElement('label'); label.textContent = `${provider.name || providerId} — ${lang.t('apiKey')}`;
            const inputGroup = document.createElement('div'); inputGroup.className = 'input-group';
            const input = document.createElement('input'); input.type = 'password'; input.id = `custom-api-key-${providerId}`; input.dataset.provider = providerId;
            input.placeholder = provider.hasApiKey ? lang.t('providerKeyKeep') : lang.t('providerKeyPlaceholder');
            const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'btn-toggle-password'; toggle.dataset.target = input.id; toggle.textContent = '👁️';
            inputGroup.append(input, toggle);
            const actions = document.createElement('div'); actions.className = 'api-key-actions';
            const save = document.createElement('button'); save.className = 'btn-small btn-save-custom-provider-key'; save.dataset.provider = providerId; save.textContent = lang.t('save');
            const remove = document.createElement('button'); remove.className = 'btn-small btn-delete-custom-provider-key'; remove.dataset.provider = providerId; remove.textContent = lang.t('delete');
            actions.append(save, remove); group.append(label, inputGroup, actions); container.appendChild(group);
            if (provider.hasApiKey) {
                fetch(`/api/config/api-keys/${encodeURIComponent(providerId)}`).then(r => r.ok ? r.json() : null).then(result => { if (result?.key && document.getElementById(input.id)) document.getElementById(input.id).value = result.key; }).catch(error => console.error(`Could not load API key for ${providerId}:`, error));
            }
        });
    } catch (error) { console.error('Could not load custom provider API keys:', error); }
}

async function saveCustomProviderApiKey(providerId) {
    const input = document.getElementById(`custom-api-key-${providerId}`);
    const key = input?.value.trim();
    if (!key) return showNotification(lang.t('apiKeyEmpty'), 'error');
    const response = await fetch('/api/config/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: providerId, key }) });
    const data = await response.json();
    if (!data.success) return showNotification(data.error || lang.t('apiKeySaveError'), 'error');
    input.value = key; input.placeholder = ''; input.type = 'password';
    showNotification(lang.t('apiKeySaved'), 'success');
}

async function deleteCustomProviderApiKey(providerId) {
    if (!confirm(lang.t('deleteConfirm'))) return;
    const response = await fetch(`/api/config/api-keys/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!data.success) return showNotification(data.error || lang.t('apiKeyDeleteError'), 'error');
    const input = document.getElementById(`custom-api-key-${providerId}`);
    if (input) { input.value = ''; input.placeholder = lang.t('providerKeyPlaceholder'); input.type = 'password'; }
    showNotification(lang.t('apiKeyDeleted'), 'success');
}

// Load actual API key from server
async function loadApiKey(provider, inputElement) {
    try {
        const response = await fetch(`/api/config/api-keys/${provider}`);
        if (response.ok) {
            const data = await response.json();
            if (data.key) {
                inputElement.value = data.key;
            }
        }
    } catch (error) {
        console.error(`Error loading ${provider} API key:`, error);
    }
}

// Save API Key
async function saveApiKey(provider) {
    const keyInput = provider === 'google' ? googleApiKeyInput : geminiApiKeyInput;
    if (!keyInput) {
        showNotification(lang.t('apiKeyInputNotFound'), 'error');
        return;
    }
    
    const key = keyInput.value.trim();
    
    if (!key) {
        showNotification(lang.t('apiKeyEmpty'), 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/config/api-keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, key })
        });
        
        if (response.ok) {
            showNotification(lang.t('apiKeySaved'), 'success');
            keyInput.dataset.hasKey = 'true';
            // Keep the key in the input field for visibility
        } else {
            showNotification(lang.t('apiKeySaveError'), 'error');
        }
    } catch (error) {
        console.error('Error saving API key:', error);
        showNotification(lang.t('apiKeySaveErrorDetail'), 'error');
    }
}

// Delete API Key
async function deleteApiKey(provider) {
    if (!confirm(lang.t('deleteConfirm'))) {
        return;
    }
    
    try {
        const response = await fetch(`/api/config/api-keys/${provider}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showNotification(lang.t('apiKeyDeleted'), 'success');
            // Clear input field and reset hasKey flag
            const keyInput = provider === 'google' ? googleApiKeyInput : geminiApiKeyInput;
            if (keyInput) {
                keyInput.value = '';
                keyInput.dataset.hasKey = 'false';
            }
        } else {
            showNotification(lang.t('apiKeyDeleteError'), 'error');
        }
    } catch (error) {
        console.error('Error deleting API key:', error);
        showNotification(lang.t('apiKeyDeleteErrorDetail'), 'error');
    }
}

// Save Server Settings
async function saveServerSettings() {
    if (!serverPortInput || !serverHostInput) {
        showNotification(lang.t('serverInputNotFound'), 'error');
        return;
    }

    const port = parseInt(serverPortInput.value);
    const host = serverHostInput.value.trim();

    if (!port || port < 1 || port > 65535) {
        showNotification(lang.t('invalidPort'), 'error');
        return;
    }

    if (!host) {
        showNotification(lang.t('hostEmpty'), 'error');
        return;
    }

    try {
        // Save server settings and restart
        const response = await fetch('/api/server/restart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port, host })
        });

        const data = await response.json();

        if (response.ok) {
            // Show countdown modal with estimated time
            showCountdownModal(data.redirectUrl, data.estimatedTime || 3000);
        } else {
            showNotification(lang.t('serverSaveError'), 'error');
        }
    } catch (error) {
        console.error('Error saving server settings:', error);
        showNotification(lang.t('serverSaveErrorDetail'), 'error');
    }
}

// Show countdown modal for server restart
function showCountdownModal(redirectUrl, estimatedTime = 10000) {
    // Create countdown modal if it doesn't exist
    let countdownModal = document.getElementById('countdown-modal');
    if (!countdownModal) {
        countdownModal = document.createElement('div');
        countdownModal.id = 'countdown-modal';
        countdownModal.className = 'modal active';
        countdownModal.innerHTML = `
            <div class="modal-content" style="text-align: center; max-width: 400px;">
                <div class="modal-header">
                    <h3>🔄 ${lang.t('serverRestartingTitle')}</h3>
                </div>
                <div class="modal-body">
                    <div class="countdown-display">
                        <div class="countdown-number">10</div>
                        <div class="countdown-text">${lang.t('redirectInSeconds')}</div>
                    </div>
                    <div class="countdown-progress">
                        <div class="countdown-bar"></div>
                    </div>
                    <div class="server-status">
                        <div class="status-indicator loading"></div>
                        <div class="status-text">${lang.t('serverStarting')}</div>
                    </div>
                    <p style="margin-top: 20px; color: var(--text-tertiary);">
                        ${lang.t('newAddress')}: <strong>${redirectUrl}</strong>
                    </p>
                </div>
            </div>
        `;
        document.body.appendChild(countdownModal);
    } else {
        countdownModal.classList.add('active');
        countdownModal.querySelector('.countdown-number').textContent = '10';
        const redirectText = countdownModal.querySelector('p strong');
        if (redirectText) {
            redirectText.textContent = redirectUrl;
        }
    }
    
    // Start countdown
    let countdown = 10;
    const countdownNumber = countdownModal.querySelector('.countdown-number');
    const countdownBar = countdownModal.querySelector('.countdown-bar');
    const statusText = countdownModal.querySelector('.status-text');
    const statusIndicator = countdownModal.querySelector('.status-indicator');
    
    countdownBar.style.width = '100%';
    
    const countdownInterval = setInterval(() => {
        countdown--;
        countdownNumber.textContent = countdown;
        countdownBar.style.width = `${(countdown / 10) * 100}%`;
        
        if (countdown <= 0) {
            clearInterval(countdownInterval);
            statusText.textContent = lang.t('serverReadyRedirecting');
            statusIndicator.className = 'status-indicator ready';
            
            // Short delay before redirect
            setTimeout(() => {
                window.location.href = redirectUrl;
            }, 500);
        }
    }, 1000);
}

// Toggle password visibility
function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
    } else {
        input.type = 'password';
    }
}

// Render settings list
function renderSettingsList() {
    if (!settingsList) return;
    
    const settingsHtml = `
        <div class="settings-overview">
            <div class="settings-item">
                <span class="settings-label" data-lang="apiKeys"></span>
                <button class="btn-small settings-action-btn" data-action="api-keys" data-lang="manage"></button>
            </div>
            <div class="settings-item">
                <span class="settings-label" data-lang="serverSettings"></span>
                <button class="btn-small settings-action-btn" data-action="server" data-lang="manage"></button>
            </div>
            <div class="settings-item">
                <span class="settings-label" data-lang="language"></span>
                <button class="btn-small settings-action-btn" data-action="language" data-lang="manage"></button>
            </div>
            <div class="settings-item">
                <span class="settings-label" data-lang="modelSettings"></span>
                <button class="btn-small settings-action-btn" data-action="models" data-lang="manage"></button>
            </div>
            <div class="settings-item">
                <span class="settings-label" data-lang="updateSettings"></span>
                <button class="btn-small settings-action-btn" data-action="update" data-lang="manage"></button>
            </div>
        </div>
    `;
    
    settingsList.innerHTML = settingsHtml;
    
    // Update language for dynamically inserted content
    lang.updateUI();
    
    // Add event listeners to buttons
    settingsList.querySelectorAll('.settings-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            openSettingsModal(action);
        });
    });
}

// Open settings modal
function openSettingsModal(section = null) {
    // Handle model settings separately - open dedicated modal
    if (section === 'models') {
        openModelSettingsModal();
        return;
    }
    
    if (settingsModal) {
        console.log('Opening settings modal...');
        loadSettings().then(() => {
            console.log('Settings loaded, opening modal');
            
            // Update modal title based on section
            const modalTitle = settingsModal.querySelector('.modal-header h3');
            const sectionTitles = {
                'api-keys': '🔑 ' + lang.t('apiKeys'),
                'server': '🖥️ ' + lang.t('serverSettingsTitle'),
                'language': '🌐 ' + lang.t('languageSettingsTitle')
            };
            
            if (section && sectionTitles[section]) {
                modalTitle.textContent = sectionTitles[section];
            } else {
                modalTitle.textContent = lang.t('systemSettings');
            }
            
            // Hide all sections first
            const sections = settingsModal.querySelectorAll('.settings-section');
            sections.forEach(s => {
                s.classList.remove('visible');
                s.classList.add('hidden');
            });
            
            // Show specific section or all sections
            if (section) {
                const sectionId = `section-${section}`;
                const targetSection = document.getElementById(sectionId);
                if (targetSection) {
                    targetSection.classList.remove('hidden');
                    targetSection.classList.add('visible');
                }
            } else {
                // Show all sections if no specific section requested
                sections.forEach(s => {
                    s.classList.remove('hidden');
                    s.classList.add('visible');
                });
            }
            
            settingsModal.classList.add('active');
        }).catch(error => {
            console.error('Error in openSettingsModal:', error);
            showNotification(lang.t('settingsLoadError'), 'error');
        });
    }
}

// Mobile menu toggle functionality
if (mobileMenuToggle && sidebar) {
    mobileMenuToggle.addEventListener('click', () => {
        mobileMenuToggle.classList.toggle('active');
        sidebar.classList.toggle('active');
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 480 && 
            sidebar.classList.contains('active') && 
            !sidebar.contains(e.target) && 
            !mobileMenuToggle.contains(e.target)) {
            sidebar.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
        }
    });
}

// Sidebar drag resize functionality
const sidebarDragHandle = document.getElementById('sidebar-drag-handle');
let isResizing = false;
let startX = 0;
let startWidth = 0;
let sidebarDragMoved = false;

// Load saved sidebar width from localStorage
function loadSidebarWidth() {
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
        const width = parseInt(savedWidth);
        if (width >= 200 && width <= 600) {
            sidebar.style.width = width + 'px';
        }
    }
}

// Save sidebar width to localStorage
function saveSidebarWidth(width) {
    localStorage.setItem('sidebarWidth', width.toString());
}

// Initialize sidebar width on load
loadSidebarWidth();

if (sidebarDragHandle && sidebar) {
    const toggleSidebar = () => {
        if (sidebarDragMoved) { sidebarDragMoved = false; return; }
        const collapsed = sidebar.classList.toggle('collapsed');
        sidebarDragHandle.setAttribute('aria-expanded', String(!collapsed));
        localStorage.setItem('sidebarCollapsed', collapsed ? 'true' : 'false');
    };
    sidebarDragHandle.addEventListener('click', toggleSidebar);
    sidebarDragHandle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleSidebar(); }
    });
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        sidebar.classList.add('collapsed');
        sidebarDragHandle.setAttribute('aria-expanded', 'false');
    }
    sidebarDragHandle.addEventListener('mousedown', (e) => {
        if (sidebar.classList.contains('collapsed')) return;
        isResizing = true;
        sidebarDragMoved = false;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        sidebarDragHandle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        if (Math.abs(deltaX) > 4) sidebarDragMoved = true;
        const newWidth = startWidth + deltaX;
        
        // Constrain width between min and max
        if (newWidth >= 200 && newWidth <= 600) {
            sidebar.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            sidebarDragHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save the final width
            const finalWidth = sidebar.offsetWidth;
            saveSidebarWidth(finalWidth);
        }
    });
}

// Floating Particles Effect
function createParticles() {
    const container = document.getElementById('particles-container');
    if (!container) return;
    
    const particleCount = 50;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Random properties
        const size = Math.random() * 4 + 2;
        const left = Math.random() * 100;
        const delay = Math.random() * 20;
        const duration = Math.random() * 20 + 15;
        
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${left}%`;
        particle.style.animationDelay = `${delay}s`;
        particle.style.animationDuration = `${duration}s`;
        
        // Random colors
        const colors = ['#e94560', '#0f3460', '#28a745', '#ffc107'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.background = randomColor;
        particle.style.boxShadow = `0 0 ${size * 2}px ${randomColor}`;
        
        container.appendChild(particle);
    }
}

// app.js is loaded dynamically after authentication, so DOMContentLoaded may
// already have fired. Initialize immediately when the document is ready.
function initializeAppUi() {
    createParticles();
    
    // Add ripple effect to all buttons
    const buttons = document.querySelectorAll('.btn-primary, .btn-secondary, .btn-success, .btn-danger, .btn-warning, .btn-send, .btn-live');
    buttons.forEach(button => {
        button.addEventListener('click', createRipple);
    });
    
    // Initialize loading skeleton screens
    initializeLoadingSkeletons();
    
    // Load available models
    loadAvailableModels();
    
    // Setup model management UI
    setupModelManagement();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAppUi, { once: true });
} else {
    initializeAppUi();
}

// Loading Skeleton Screens
function initializeLoadingSkeletons() {
    // Show skeleton while loading agents if list is empty
    const agentList = document.getElementById('agent-list');
    if (agentList && agentList.children.length === 0) {
        showAgentSkeleton();
        
        // Hide skeleton after a timeout if no agents load
        setTimeout(() => {
            if (agentList.classList.contains('loading-skeleton')) {
                hideAgentSkeleton();
            }
        }, 3000);
    }
}

function showAgentSkeleton() {
    const agentList = document.getElementById('agent-list');
    if (!agentList) return;
    
    agentList.classList.add('loading-skeleton');
    
    // Create skeleton items
    const skeletonHTML = `
        <div class="skeleton-card">
            <div class="skeleton-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); gap: var(--spacing-sm);">
                <div class="skeleton skeleton-text" style="width: 120px;"></div>
                <div class="skeleton skeleton-text-sm" style="width: 60px;"></div>
            </div>
            <div class="skeleton skeleton-text-sm"></div>
            <div class="skeleton skeleton-text-sm" style="width: 80%;"></div>
        </div>
        <div class="skeleton-card">
            <div class="skeleton-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); gap: var(--spacing-sm);">
                <div class="skeleton skeleton-text" style="width: 100px;"></div>
                <div class="skeleton skeleton-text-sm" style="width: 60px;"></div>
            </div>
            <div class="skeleton skeleton-text-sm"></div>
            <div class="skeleton skeleton-text-sm" style="width: 70%;"></div>
        </div>
        <div class="skeleton-card">
            <div class="skeleton-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); gap: var(--spacing-sm);">
                <div class="skeleton skeleton-text" style="width: 130px;"></div>
                <div class="skeleton skeleton-text-sm" style="width: 60px;"></div>
            </div>
            <div class="skeleton skeleton-text-sm"></div>
            <div class="skeleton skeleton-text-sm" style="width: 75%;"></div>
        </div>
    `;
    
    agentList.innerHTML = skeletonHTML;
}

function hideAgentSkeleton() {
    const agentList = document.getElementById('agent-list');
    if (!agentList) return;
    
    agentList.classList.remove('loading-skeleton');
}

// Ripple Effect on Buttons
function createRipple(event) {
    const button = event.currentTarget;
    const circle = document.createElement('span');
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;
    
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - button.getBoundingClientRect().left - radius}px`;
    circle.style.top = `${event.clientY - button.getBoundingClientRect().top - radius}px`;
    circle.classList.add('ripple');
    
    const ripple = button.getElementsByClassName('ripple')[0];
    if (ripple) {
        ripple.remove();
    }
    
    button.appendChild(circle);
}

// Make functions globally available
window.openSettingsModal = openSettingsModal;
window.saveApiKey = saveApiKey;
window.deleteApiKey = deleteApiKey;
window.saveServerSettings = saveServerSettings;
window.togglePasswordVisibility = togglePasswordVisibility;

// Model Management Functions
async function loadAvailableModels() {
    try {
        const response = await fetch('/api/agents/available-models');
        const data = await response.json();
        availableModels = data.models || [];
        availableProviders = data.providers || {};
        
        console.log('Available models loaded:', availableModels);
        console.log('Available providers:', availableProviders);
        
        // Update model dropdowns
        updateModelDropdowns();
        if (typeof populateCustomProviderChoices === 'function') populateCustomProviderChoices();
    } catch (error) {
        console.error('Error loading available models:', error);
        // Fallback to default models
        availableModels = [
            { id: 'gemini-3.1-flash-live-preview', name: 'Gemini 3.1 Flash Live Preview', provider: 'google' }
        ];
        updateModelDropdowns();
    }
}

function updateModelDropdowns() {
    // Update create agent model dropdown
    const createModelSelect = document.getElementById('agent-model');
    if (createModelSelect) {
        createModelSelect.innerHTML = '';
        
        if (availableModels.length === 0) {
            const option = document.createElement('option');
            option.value = 'gemini-2.5-flash';
            option.textContent = 'Gemini 2.5 Flash';
            createModelSelect.appendChild(option);
        } else {
            // Group models by provider
            const groupedModels = {};
            availableModels.forEach(model => {
                if (!groupedModels[model.provider]) {
                    groupedModels[model.provider] = [];
                }
                groupedModels[model.provider].push(model);
            });
            
            // Create option groups
            for (const providerId in groupedModels) {
                const group = document.createElement('optgroup');
                group.label = availableProviders[providerId]?.name || providerId;
                
                groupedModels[providerId].forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.dataset.provider = model.provider;
                    option.textContent = model.name + (model.default ? lang.t('modelDefaultSuffix') : '');
                    if (model.default) option.selected = true;
                    group.appendChild(option);
                });
                
                createModelSelect.appendChild(group);
            }
        }
    }
    
    // Update edit agent model dropdown
    const editModelSelect = document.getElementById('edit-agent-model');
    if (editModelSelect) {
        editModelSelect.innerHTML = '';
        
        if (availableModels.length === 0) {
            const option = document.createElement('option');
            option.value = 'gemini-2.5-flash';
            option.textContent = 'Gemini 2.5 Flash';
            editModelSelect.appendChild(option);
        } else {
            // Group models by provider
            const groupedModels = {};
            availableModels.forEach(model => {
                if (!groupedModels[model.provider]) {
                    groupedModels[model.provider] = [];
                }
                groupedModels[model.provider].push(model);
            });
            
            // Create option groups
            for (const providerId in groupedModels) {
                const group = document.createElement('optgroup');
                group.label = availableProviders[providerId]?.name || providerId;
                
                groupedModels[providerId].forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.dataset.provider = model.provider;
                    option.textContent = model.name + (model.default ? lang.t('modelDefaultSuffix') : '');
                    group.appendChild(option);
                });
                
                editModelSelect.appendChild(group);
            }
        }
    }
}

function openModelSettingsModal() {
    const modal = document.getElementById('model-settings-modal');
    if (!modal) return;
    loadAvailableModels().then(() => { renderModelsList(); modal.classList.add('active'); });
}

function renderProvidersList() {
    const modelList = document.getElementById('models-list');
    if (!modelList) return;
    modelList.querySelectorAll('.provider-management').forEach(node => node.remove());
    modelList.querySelectorAll('.provider-section').forEach(section => {
        const oldRow = section.querySelector('.provider-heading-row');
        if (oldRow) { const oldHeading = oldRow.querySelector('.provider-title'); if (oldHeading) oldRow.replaceWith(oldHeading); else oldRow.remove(); }
        const providerId = section.dataset.provider;
        const provider = availableProviders[providerId];
        if (!provider || provider.type !== 'custom') return;
        const row = document.createElement('div'); row.className = 'provider-heading-row';
        const heading = section.querySelector('.provider-title');
        if (heading) { heading.remove(); row.appendChild(heading); }
        const actions = document.createElement('div'); actions.className = 'provider-card-actions';
        const edit = document.createElement('button'); edit.className = 'btn-small provider-edit-item'; edit.dataset.provider = providerId; edit.textContent = lang.t('providerEdit');
        const remove = document.createElement('button'); remove.className = 'btn-small provider-delete-item'; remove.dataset.provider = providerId; remove.textContent = lang.t('providerDelete');
        actions.append(edit, remove); row.appendChild(actions); section.prepend(row);

        const management = document.createElement('div'); management.className = 'provider-management'; management.dataset.provider = providerId;
        const form = document.createElement('div'); form.className = 'provider-edit-form'; form.hidden = true;
        const nameInput = document.createElement('input'); nameInput.className = 'provider-edit-name'; nameInput.value = provider.name || ''; nameInput.placeholder = lang.t('providerNamePlaceholder');
        const urlInput = document.createElement('input'); urlInput.className = 'provider-edit-url'; urlInput.value = provider.apiUrl || ''; urlInput.placeholder = lang.t('providerUrlPlaceholder');
        const save = document.createElement('button'); save.className = 'btn-small provider-save-item'; save.textContent = lang.t('providerSave');
        const cancel = document.createElement('button'); cancel.className = 'btn-small provider-cancel-item'; cancel.textContent = lang.t('providerCancel');
        form.append(nameInput, urlInput, save, cancel);
        const testRow = document.createElement('div'); testRow.className = 'provider-test-row';
        const testModel = document.createElement('input'); testModel.className = 'provider-test-model'; testModel.placeholder = lang.t('providerTestModel'); testModel.value = provider.models?.[0]?.id || '';
        const test = document.createElement('button'); test.className = 'btn-small provider-test-item'; test.dataset.provider = providerId; test.textContent = lang.t('providerTest');
        const status = document.createElement('span'); status.className = 'provider-test-result';
        testRow.append(testModel, test, status); management.append(form, testRow);
        const firstModel = section.querySelector('.model-item');
        section.insertBefore(management, firstModel || null);
    });
}

async function runProviderTest(providerId, card) {
    const status = card.querySelector('.provider-test-result');
    const model = card.querySelector('.provider-test-model').value.trim();
    status.textContent = lang.t('providerTesting'); status.className = 'provider-test-result';
    try {
        const response = await fetch('/api/models/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, model }) });
        const data = await response.json(); status.textContent = data.success ? lang.t('providerConnectionSuccessful') : (data.message || lang.t('providerConnectionFailed'));
        if (!data.success && data.message === 'Enter a test model ID first') status.textContent = lang.t('providerTestModelRequired');
        status.classList.add(data.success ? 'provider-test-success' : 'provider-test-error');
    } catch (error) { status.textContent = error.message; status.classList.add('provider-test-error'); }
}

async function deleteProvider(providerId) {
    const label = (lang.t('providerDeleteConfirm') || '').replace('{name}', availableProviders[providerId]?.name || providerId);
    if (!confirm(label)) return;
    const response = await fetch(`/api/models/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!data.success) return alert(data.error || lang.t('error'));
    await loadAvailableModels(); renderModelsList(); await loadCustomProviderApiKeys();
}

function renderModelsList() {
    const container = document.getElementById('models-list');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(availableProviders || {}).forEach(([providerId, provider]) => {
        const section = document.createElement('section');
        section.className = 'provider-section';
        section.dataset.provider = providerId;
        const heading = document.createElement('h4');
        heading.className = 'provider-title';
        heading.textContent = provider.name || providerId;
        section.appendChild(heading);
        (provider.models || []).forEach(model => {
            const row = document.createElement('div');
            row.className = 'model-item';
            const label = document.createElement('span');
            label.textContent = `${model.name} (${model.id})${model.default ? ' — default' : ''}`;
            row.appendChild(label);
            const edit = document.createElement('button'); edit.textContent = lang.t('editModel'); edit.dataset.provider = providerId; edit.dataset.modelId = model.id; edit.className = 'btn-edit-model-item'; row.appendChild(edit);
            const remove = document.createElement('button'); remove.textContent = lang.t('delete'); remove.dataset.provider = providerId; remove.dataset.modelId = model.id; remove.className = 'btn-delete-model-item'; row.appendChild(remove);
            if (!model.default) { const def = document.createElement('button'); def.textContent = lang.t('setDefault'); def.dataset.provider = providerId; def.dataset.modelId = model.id; def.className = 'btn-set-default-item'; row.appendChild(def); }
            section.appendChild(row);
        });
        container.appendChild(section);
    });
    renderProvidersList();
}

function setupModelManagement() {
    document.addEventListener('language-changed', () => { if (document.getElementById('model-settings-modal')?.classList.contains('active')) renderProvidersList(); });
    const addModelBtn = document.getElementById('add-model-btn');
    const refreshModelsBtn = document.getElementById('refresh-models-btn');
    const saveModelBtn = document.getElementById('save-model-btn');
    
    if (addModelBtn) {
        addModelBtn.addEventListener('click', () => {
            openAddEditModelModal();
        });
    }
    
    if (refreshModelsBtn) {
        refreshModelsBtn.addEventListener('click', () => {
            loadAvailableModels();
            renderModelsList();
        });
    }
    
    if (saveModelBtn) saveModelBtn.addEventListener('click', saveModel);
    document.getElementById('add-provider-btn')?.addEventListener('click', () => { document.getElementById('new-provider-form').style.display = 'grid'; });
    document.getElementById('cancel-provider-btn')?.addEventListener('click', () => { document.getElementById('new-provider-form').style.display = 'none'; });
    document.getElementById('save-provider-btn')?.addEventListener('click', async () => {
        const providerId = document.getElementById('provider-id').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        const payload = { providerId, name: document.getElementById('provider-name').value.trim(), apiUrl: document.getElementById('provider-url').value.trim() };
        const response = await fetch('/api/models/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await response.json();
        if (!data.success) return alert(data.error || lang.t('error'));
        document.getElementById('new-provider-form').style.display = 'none';
        document.getElementById('provider-name').value = ''; document.getElementById('provider-id').value = ''; document.getElementById('provider-url').value = '';
        await loadAvailableModels(); renderModelsList(); populateCustomProviderChoices(); await loadCustomProviderApiKeys();
    });
    // Event delegation for model actions
    document.addEventListener('click', (e) => {
        const providerCard = e.target.closest('.provider-section');
        const providerId = e.target.dataset.provider || providerCard?.dataset.provider;
        if (providerCard && e.target.classList.contains('provider-edit-item')) providerCard.querySelector('.provider-edit-form').hidden = false;
        if (providerCard && e.target.classList.contains('provider-cancel-item')) providerCard.querySelector('.provider-edit-form').hidden = true;
        if (providerCard && e.target.classList.contains('provider-delete-item')) deleteProvider(providerId);
        if (providerCard && e.target.classList.contains('provider-test-item')) runProviderTest(providerId, providerCard);
        if (providerCard && e.target.classList.contains('provider-save-item')) {
            const payload = { name: providerCard.querySelector('.provider-edit-name').value.trim(), apiUrl: providerCard.querySelector('.provider-edit-url').value.trim() };
            fetch(`/api/models/providers/${encodeURIComponent(providerId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
                .then(r => r.json()).then(data => { if (!data.success) throw new Error(data.error || lang.t('error')); return loadAvailableModels(); })
                .then(() => { renderModelsList(); populateCustomProviderChoices(); })
                .catch(error => alert(error.message));
        }
        if (e.target.classList.contains('btn-edit-model-item')) {
            const providerId = e.target.dataset.provider;
            const modelId = e.target.dataset.modelId;
            openAddEditModelModal(providerId, modelId);
        }
        
        if (e.target.classList.contains('btn-delete-model-item')) {
            const providerId = e.target.dataset.provider;
            const modelId = e.target.dataset.modelId;
            deleteModel(providerId, modelId);
        }
        
        if (e.target.classList.contains('btn-set-default-item')) {
            const providerId = e.target.dataset.provider;
            const modelId = e.target.dataset.modelId;
            setDefaultModel(providerId, modelId);
        }
    });
}

function deleteModel(providerId, modelId) {
    if (!confirm(lang.t('confirmDeleteModel'))) return;
    fetch(`/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`, { method: 'DELETE' })
        .then(r => r.json()).then(data => { if (!data.success) throw new Error(data.error || lang.t('modelDeleteError')); return loadAvailableModels(); })
        .then(renderModelsList).catch(error => alert(error.message));
}
function setDefaultModel(providerId, modelId) {
    fetch(`/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/default`, { method: 'POST' })
        .then(r => r.json()).then(data => { if (!data.success) throw new Error(data.error || lang.t('error')); return loadAvailableModels(); })
        .then(renderModelsList).catch(error => alert(error.message));
}

function populateCustomProviderChoices() { const select=document.getElementById('model-type'); const chosen=select.value; select.innerHTML=''; Object.entries(availableProviders).forEach(([id,p])=>{ const o=document.createElement('option'); o.value=id; o.textContent=p.name; select.appendChild(o); }); if(chosen && availableProviders[chosen]) select.value=chosen; }

function openAddEditModelModal(providerId = null, modelId = null) {
    populateCustomProviderChoices();
    const modal = document.getElementById('add-edit-model-modal');
    const title = document.getElementById('model-modal-title');
    const modelTypeSelect = document.getElementById('model-type');
    const modelIdInput = document.getElementById('model-id');
    const modelNameInput = document.getElementById('model-name');
    const modelDescInput = document.getElementById('model-description');
    const modelDefaultInput = document.getElementById('model-default');
    const modelThinkingInput = document.getElementById('model-thinking');
    
    if (!modal) return;
    
    // Reset form
    modelTypeSelect.value = 'google';
    modelIdInput.value = '';
    modelNameInput.value = '';
    modelDescInput.value = '';
    modelDefaultInput.checked = false;
    modelThinkingInput.checked = false;
    
    if (modelId && providerId) {
        // Edit mode
        const model = availableProviders[providerId]?.models?.find(m => m.id === modelId);
        if (model) {
            title.textContent = lang.t('editModelTitle');
            modelTypeSelect.value = providerId;
            modelIdInput.value = model.id;
            modelNameInput.value = model.name;
            modelDescInput.value = model.description || '';
            modelDefaultInput.checked = model.default || false;
            modelThinkingInput.checked = model.supportsThinking || false;
            modelIdInput.disabled = true; // Can't change ID when editing
        }
    } else {
        // Add mode
        title.textContent = 'Add Model';
        modelIdInput.disabled = false;
        // Auto-set thinking based on provider (Google = true, others = false)
        modelTypeSelect.addEventListener('change', () => {
            modelThinkingInput.checked = modelTypeSelect.value === 'google';
        });
    }
    
    modal.classList.add('active');
}

function saveModel() {
    const modal = document.getElementById('add-edit-model-modal');
    const modelTypeSelect = document.getElementById('model-type');
    const modelIdInput = document.getElementById('model-id');
    const modelNameInput = document.getElementById('model-name');
    const modelDescInput = document.getElementById('model-description');
    const modelDefaultInput = document.getElementById('model-default');
    const modelThinkingInput = document.getElementById('model-thinking');
    const title = document.getElementById('model-modal-title');
    
    const providerId = modelTypeSelect.value;
    const modelId = modelIdInput.value.trim();
    const modelName = modelNameInput.value.trim();
    const modelDescription = modelDescInput.value.trim();
    const isDefault = modelDefaultInput.checked;
    const supportsThinking = modelThinkingInput.checked;
    
    if (!modelId || !modelName) {
        alert(`${lang.t('modelId')} and ${lang.t('modelName')} are required.`);
        return;
    }
    
    const isEditMode = title.textContent === lang.t('editModelTitle');
    
    if (isEditMode) {
        // Update existing model
        fetch(`/api/models/providers/${providerId}/models/${modelId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                name: modelName, 
                description: modelDescription,
                default: isDefault,
                supportsThinking: supportsThinking
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(lang.t('modelUpdated'));
                modal.classList.remove('active');
                loadAvailableModels();
                renderModelsList();
                updateModelDropdowns();
            } else {
                alert(lang.t('error') + ': ' + (data.error || lang.t('unknownError')));
            }
        })
        .catch(error => {
            console.error('Error updating model:', error);
            alert(lang.t('modelSaveError'));
        });
    } else {
        // Add new model
        fetch(`/api/models/providers/${providerId}/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                id: modelId, 
                name: modelName, 
                description: modelDescription,
                default: isDefault,
                supportsThinking: supportsThinking
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(lang.t('modelAdded'));
                modal.classList.remove('active');
                loadAvailableModels();
                renderModelsList();
                updateModelDropdowns();
            } else {
                alert(lang.t('error') + ': ' + (data.error || lang.t('unknownError')));
            }
        })
        .catch(error => {
            console.error('Error adding model:', error);
            alert(lang.t('modelSaveError'));
        });
    }
}

// Plugin GUI Loading System
async function loadPluginGUIs() {
    try {
        const response = await fetch('/api/plugins');
        const data = await response.json();
        const plugins = data.plugins;

        console.log('Found plugins:', plugins);

        for (const plugin of plugins) {
            console.log('Checking plugin:', plugin.name, 'hasGUI:', plugin.hasGUI);
            if (plugin.hasGUI && plugin.guiFiles) {
                // Track plugins with GUI support
                pluginsWithGUI.add(plugin.name);
                await loadPluginGUI(plugin.name, plugin.guiFiles);
            }
        }

        console.log('Plugin GUIs loaded successfully');
        console.log('Plugins with GUI support:', Array.from(pluginsWithGUI));
    } catch (error) {
        console.error('Error loading plugin GUIs:', error);
    }
}

// Check if a tool belongs to a plugin with GUI support
function isToolFromPluginWithGUI(toolName) {
    if (!toolName) return false;

    // Extract plugin name from tool name (e.g., "datetime.getCurrentTime" -> "datetime")
    const parts = toolName.split('.');
    const pluginName = parts[0] || '';

    return pluginsWithGUI.has(pluginName);
}

async function loadPluginGUI(pluginName, guiFiles) {
    try {
        console.log(`Loading GUI for plugin: ${pluginName}`, guiFiles);

        // Load CSS
        if (guiFiles.css) {
            const cssLink = document.createElement('link');
            cssLink.rel = 'stylesheet';
            cssLink.href = `/plugins/${pluginName}/gui/${guiFiles.css}`;
            cssLink.onload = () => {
                console.log(`CSS loaded for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.css}`);
            };
            cssLink.onerror = () => console.error(`CSS load failed for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.css}`);
            document.head.appendChild(cssLink);
        }

        // Load Language file
        if (guiFiles.lang) {
            const langScript = document.createElement('script');
            langScript.src = `/plugins/${pluginName}/gui/${guiFiles.lang}`;
            langScript.onload = () => {
                console.log(`Lang loaded for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.lang}`);
            };
            langScript.onerror = () => console.error(`Lang load failed for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.lang}`);
            document.head.appendChild(langScript);
        }

        // Load JS
        if (guiFiles.js) {
            const script = document.createElement('script');
            script.src = `/plugins/${pluginName}/gui/${guiFiles.js}`;
            script.onload = () => {
                console.log(`JS loaded for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.js}`);
                // Initialize plugin GUI if class is available (generic for all plugins)
                const pluginClassName = pluginName.charAt(0).toUpperCase() + pluginName.slice(1) + 'PluginGUI';
                const PluginGUIClass = window[pluginClassName];

                if (PluginGUIClass) {
                    setTimeout(() => {
                        try {
                            const pluginGUI = new PluginGUIClass(socket, currentLanguage);
                            pluginGUI.init();
                            loadedPluginGUIs.set(pluginName, pluginGUI);
                            console.log(`${pluginName} Plugin GUI initialized successfully`);
                        } catch (error) {
                            console.error(`Error initializing ${pluginName} Plugin GUI:`, error);
                        }
                    }, 100);
                } else {
                    console.log(`No GUI class found for plugin: ${pluginName} (expected: ${pluginClassName})`);
                }
            };
            script.onerror = () => console.error(`JS load failed for plugin: ${pluginName} at: /plugins/${pluginName}/gui/${guiFiles.js}`);
            document.head.appendChild(script);
        }
    } catch (error) {
        console.error(`Error loading GUI for plugin ${pluginName}:`, error);
    }
}

// Start the application
init();
