const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');
const { getLang } = require('../config/lang');

// Constant GitHub Repository (Not stored in config, cannot be modified)
const GITHUB_REPO = 'QadirAbbasov-Official';

class UpdateManager {
  constructor(io, configManager) {
    this.io = io;
    this.configManager = configManager;
    this.lang = getLang();
    this.currentVersion = this.getCurrentVersion();
    this.githubRepo = GITHUB_REPO; // Constant repository
    this.tempDownloadDir = './temp-updates'; // Temporary download directory
    this.updateCheckInterval = null;
    this.isUpdating = false;
    this.lastCheckTime = null;
    this.currentUpdateSettings = null; // Store settings separately
    this.lastUpdateCheckResult = null; // Store last check result for frontend
    
    // Initialize update system
    this.initialize();
  }

  getCurrentVersion() {
    try {
      const packageJson = require(path.join(process.cwd(), 'package.json'));
      return packageJson.version;
    } catch (error) {
      console.error('Error reading package.json:', error);
      return '1.0.0';
    }
  }

  initialize() {
    // Load update settings from config
    const updateSettings = this.configManager.get('update') || {
      checkOnStartup: true,
      checkInterval: 5, // minutes
      autoUpdate: false
    };

    // Remove githubRepo from config settings if exists; repository is constant within code
    delete updateSettings.githubRepo;
    this.currentUpdateSettings = updateSettings;
    this.githubRepo = GITHUB_REPO;

    // Ensure temp download directory exists
    this.ensureTempDirectory();

    // Check for updates on startup if enabled
    if (updateSettings.checkOnStartup) {
      this.checkForUpdates();
    }

    // Start periodic update checks
    this.startPeriodicChecks();
  }

  ensureTempDirectory() {
    if (!fs.existsSync(this.tempDownloadDir)) {
      fs.mkdirSync(this.tempDownloadDir, { recursive: true });
      console.log(`Temp download directory created: ${this.tempDownloadDir}`);
    }
  }

  startPeriodicChecks() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
    }

    // Start periodic update checks
    const intervalMs = (this.currentUpdateSettings.checkInterval || 5) * 60 * 1000;
    
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates();
    }, intervalMs);

    console.log(`Update check interval set to ${this.currentUpdateSettings.checkInterval} minutes`);
  }

  async checkForUpdates() {
    if (this.isUpdating) {
      console.log('Update already in progress');
      return null;
    }

    try {
      console.log('Checking for updates...');
      this.lastCheckTime = new Date().toISOString();

      // Check GitHub releases
      const githubUpdate = await this.checkGitHubReleases();

      if (githubUpdate) {
        console.log('Update available: ' + githubUpdate.version);
        this.lastUpdateCheckResult = {
          hasUpdate: true,
          updateInfo: githubUpdate,
          checkTime: this.lastCheckTime
        };
        this.broadcastUpdateAvailable(githubUpdate);

        // Auto-update if enabled
        if (this.currentUpdateSettings.autoUpdate) {
          console.log('Auto-update enabled, starting update...');
          await this.startUpdate(githubUpdate);
        }

        return githubUpdate;
      }

      console.log('No update available');
      this.lastUpdateCheckResult = {
        hasUpdate: false,
        checkTime: this.lastCheckTime
      };
      this.broadcastNoUpdate();
      return null;

    } catch (error) {
      console.error('Error checking for updates:', error);
      this.lastUpdateCheckResult = {
        hasUpdate: false,
        error: error.message,
        checkTime: this.lastCheckTime
      };
      this.broadcastUpdateError(error.message);
      return null;
    }
  }

  async checkGitHubReleases() {
    try {
      const repoPath = this.githubRepo.includes('/') ? this.githubRepo : `${this.githubRepo}/AzerClaw`;
      const apiUrl = `https://api.github.com/repos/${repoPath}/releases`;
      
      console.log('Checking for updates via GitHub API:', apiUrl);
      
      const response = await axios.get(apiUrl, {
        headers: {
          'User-Agent': 'AzerClaw-Update-Manager'
        }
      });
      
      const releases = response.data;
      
      if (!releases || releases.length === 0) {
        console.log('No GitHub releases found');
        return null;
      }
      
      // Get first release (latest)
      const latestRelease = releases[0];
      
      // Get version number from tag_name
      const latestVersion = latestRelease.tag_name.replace('v', '');
      
      console.log('GitHub API response:', JSON.stringify(latestRelease, null, 2));
      
      if (this.isNewerVersion(latestVersion)) {
        // Use zipball_url
        return {
          version: latestVersion,
          source: 'github',
          zipUrl: latestRelease.zipball_url,
          description: latestRelease.name || latestRelease.tag_name,
          releaseNotes: latestRelease.body || '',
          publishedAt: latestRelease.published_at,
          size: 0 // Zipball size is not provided by API
        };
      }
      
      return null;
    } catch (error) {
      console.error('GitHub API error:', error.message);
      if (error.response) {
        console.error('GitHub API response status:', error.response.status);
        console.error('GitHub API response data:', error.response.data);
      }
      return null;
    }
  }

  isNewerVersion(newVersion) {
    const current = this.currentVersion.split('.').map(Number);
    const newer = newVersion.split('.').map(Number);

    for (let i = 0; i < Math.max(current.length, newer.length); i++) {
      const currentPart = current[i] || 0;
      const newerPart = newer[i] || 0;

      if (newerPart > currentPart) return true;
      if (newerPart < currentPart) return false;
    }

    return false;
  }

  broadcastUpdateAvailable(updateInfo) {
    this.io.emit('update-available', {
      currentVersion: this.currentVersion,
      newVersion: updateInfo.version,
      source: updateInfo.source,
      description: updateInfo.description,
      releaseNotes: updateInfo.releaseNotes,
      size: updateInfo.size,
      checkTime: this.lastCheckTime
    });
  }

  broadcastNoUpdate() {
    this.io.emit('no-update', {
      currentVersion: this.currentVersion,
      checkTime: this.lastCheckTime
    });
  }

  broadcastUpdateError(error) {
    this.io.emit('update-error', {
      error: error,
      checkTime: this.lastCheckTime
    });
  }

  broadcastUpdateProgress(progress) {
    this.io.emit('update-progress', progress);
  }

  broadcastUpdateComplete() {
    this.io.emit('update-complete', {
      currentVersion: this.currentVersion,
      updateTime: new Date().toISOString()
    });
  }

  async startUpdate(updateInfo) {
    if (this.isUpdating) {
      throw new Error('Update already in progress');
    }

    this.isUpdating = true;
    console.log('Starting update process...');

    try {
      // Broadcast update start
      this.io.emit('update-started', {
        targetVersion: updateInfo.version,
        source: updateInfo.source
      });

      if (updateInfo.source === 'github') {
        await this.performGitHubUpdate(updateInfo);
      } else {
        throw new Error('Unsupported update source');
      }

      // Install dependencies
      await this.installDependencies();

      // Clean up downloaded files
      await this.cleanupDownload();

      // Broadcast update completion
      this.broadcastUpdateComplete();

      // Prepare for restart
      await this.prepareRestart();

      return { success: true };

    } catch (error) {
      console.error('Update failed:', error);
      this.isUpdating = false;
      this.io.emit('update-failed', {
        error: error.message
      });
      throw error;
    }
  }

  async performGitHubUpdate(updateInfo) {
    console.log('Performing GitHub update from:', updateInfo.zipUrl);

    // Download the release
    const downloadPath = await this.downloadGitHubRelease(updateInfo.zipUrl, updateInfo.version);
    
    // Extract the downloaded file
    await this.extractDownload(downloadPath);
    
    // Copy files from extracted directory
    await this.copyExtractedFiles(updateInfo.version);

    // Update package.json if exists
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const newPackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      newPackageJson.version = updateInfo.version;
      fs.writeFileSync(packageJsonPath, JSON.stringify(newPackageJson, null, 2));
      this.currentVersion = updateInfo.version;
    }

    this.broadcastUpdateProgress({
      stage: 'files_copied',
      progress: 80,
      message: this.lang.t('updateCopying')
    });
  }

  async downloadGitHubRelease(zipUrl, version) {
    this.broadcastUpdateProgress({
      stage: 'downloading',
      progress: 10,
      message: this.lang.t('updateDownloading')
    });
    console.log('Downloading update from:', zipUrl);

    const fileName = `release-${version}.zip`;
    const downloadPath = path.join(this.tempDownloadDir, fileName);

    try {
      // Use axios for better download handling with redirects
      const response = await axios({
        method: 'GET',
        url: zipUrl,
        responseType: 'stream',
        maxRedirects: 5,
        headers: {
          'User-Agent': 'AzerClaw-Update-Manager'
        }
      });

      const totalSize = parseInt(response.headers['content-length'], 10) || 0;
      let downloadedSize = 0;

      const file = fs.createWriteStream(downloadPath);

      response.data.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = totalSize > 0
          ? Math.min(10 + Math.floor((downloadedSize / totalSize) * 30), 40)
          : Math.min(10 + Math.floor(Math.random() * 20), 30); // Random progress if size unknown

        this.broadcastUpdateProgress({
          stage: 'downloading',
          progress: progress,
          message: totalSize > 0
            ? `${this.lang.t('updateDownloading')}: ${Math.floor((downloadedSize / totalSize) * 100)}%`
            : this.lang.t('updateDownloading')
        });
      });

      response.data.pipe(file);

      return new Promise((resolve, reject) => {
        file.on('finish', () => {
          file.close();
          console.log('Download completed:', downloadPath);
          resolve(downloadPath);
        });

        file.on('error', (error) => {
          fs.unlink(downloadPath, () => {});
          reject(error);
        });
      });

    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }

  async extractDownload(downloadPath) {
    this.broadcastUpdateProgress({
      stage: 'extracting',
      progress: 50,
      message: this.lang.t('updateExtracting')
    });

    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      
      // Extract using PowerShell (Windows)
      const extractCommand = `Expand-Archive -Path "${downloadPath}" -DestinationPath "${this.tempDownloadDir}" -Force`;

      console.log('Extracting files...');

      exec(`powershell -Command "${extractCommand}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('Extraction error:', error);
          console.error('Stderr:', stderr);
          reject(error);
          return;
        }

        console.log('Extraction stdout:', stdout);
        console.log('Files extracted successfully');

        // Debug: Show what was extracted
        console.log('Temp directory after extraction:', fs.readdirSync(this.tempDownloadDir));

        resolve();
      });
    });
  }

  async copyExtractedFiles(version) {
    this.broadcastUpdateProgress({
      stage: 'copying',
      progress: 60,
      message: this.lang.t('updateCopying')
    });

    // Debug: List what's in the temp directory
    console.log('Temp directory contents:', fs.readdirSync(this.tempDownloadDir));

    // Find the extracted directory (GitHub zipball creates a directory with repo-name-hash)
    const files = fs.readdirSync(this.tempDownloadDir);
    console.log('Files in temp directory:', files);
    
    // Find directories (excluding the zip file itself)
    const directories = files.filter(file => {
      const filePath = path.join(this.tempDownloadDir, file);
      return fs.statSync(filePath).isDirectory() && !file.endsWith('.zip');
    });

    console.log('Found directories:', directories);

    let sourceDir;
    
    if (directories.length === 0) {
      // If no subdirectory found, files might be extracted directly to temp directory
      console.log('No subdirectory found, using temp directory as source');
      sourceDir = this.tempDownloadDir;
    } else {
      // GitHub zipball format: repo-name-commit-hash
      // This directory contains project files directly
      const extractedDir = directories[0];
      sourceDir = path.join(this.tempDownloadDir, extractedDir);
    }

    console.log('Using source directory:', sourceDir);

    // Debug: List what's in the source directory
    console.log('Source directory contents:', fs.readdirSync(sourceDir));

    const filesToCopy = ['package.json', 'server.js', 'public', 'src'];

    for (const file of filesToCopy) {
      const sourcePath = path.join(sourceDir, file);
      const destPath = path.join(process.cwd(), file);

      console.log(`Copying ${file} from ${sourcePath} to ${destPath}`);

      if (fs.existsSync(sourcePath)) {
        if (fs.statSync(sourcePath).isDirectory()) {
          // Remove existing directory
          if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true });
          }
          this.copyDirectory(sourcePath, destPath);
        } else {
          fs.copyFileSync(sourcePath, destPath);
        }
      } else {
        console.log(`Warning: ${file} not found in source directory`);
      }
    }

    console.log('Files copied successfully');
  }

  async cleanupDownload() {
    this.broadcastUpdateProgress({
      stage: 'cleaning',
      progress: 95,
      message: this.lang.t('updateCleaning')
    });

    try {
      if (fs.existsSync(this.tempDownloadDir)) {
        fs.rmSync(this.tempDownloadDir, { recursive: true, force: true });
    console.log('Cleaning downloaded files...');
      }

      // Recreate temp directory for next update
      this.ensureTempDirectory();
    } catch (error) {
      console.error('Error cleaning up download:', error);
    }
  }

  copyDirectory(source, destination) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }

    const files = fs.readdirSync(source);

    for (const file of files) {
      const sourcePath = path.join(source, file);
      const destPath = path.join(destination, file);

      if (fs.statSync(sourcePath).isDirectory()) {
        this.copyDirectory(sourcePath, destPath);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  async installDependencies() {
    this.broadcastUpdateProgress({
      stage: 'installing',
      progress: 90,
      message: this.lang.t('updateInstalling')
    });

    console.log('Installing dependencies...');

    return new Promise((resolve, reject) => {
      exec('npm install', { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) {
          console.error('npm install error:', error);
          reject(error);
        }

        console.log('Dependencies installed successfully');
        resolve();
      });
    });
  }

  async prepareRestart() {
    this.broadcastUpdateProgress({
      stage: 'preparing_restart',
      progress: 100,
      message: this.lang.t('updateRestarting')
    });

    console.log('Preparing to restart server...');

    // Wait a moment before restart
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Restart the system
    this.restartSystem();
  }

  restartSystem() {
    console.log('Restarting system...');

    // Close all connections gracefully
    if (this.io) {
      this.io.emit('system-restarting', {
        message: 'System restarting due to update',
        redirectDelay: 5000
      });
    }

    // Give time for the message to be sent
    setTimeout(() => {
      // Close the server and restart
      process.exit(0);
    }, 1000);
  }

  updateSettings(newSettings) {
    console.log('Updating settings with:', newSettings);
    const { githubRepo, ...allowedSettings } = newSettings;
    this.currentUpdateSettings = { ...this.currentUpdateSettings, ...allowedSettings };
    delete this.currentUpdateSettings.githubRepo;
    this.githubRepo = GITHUB_REPO;
    
    try {
      const result = this.configManager.set('update', this.currentUpdateSettings);
      console.log('Config save result:', result);
      
      // Restart periodic checks with new settings
      this.startPeriodicChecks();

      return this.currentUpdateSettings;
    } catch (error) {
      console.error('Error saving update settings:', error);
      throw error;
    }
  }

  getUpdateStatus() {
    return {
      currentVersion: this.currentVersion,
      isUpdating: this.isUpdating,
      lastCheckTime: this.lastCheckTime,
      lastCheckResult: this.lastUpdateCheckResult,
      settings: this.currentUpdateSettings,
      githubRepo: this.githubRepo
    };
  }

  // Test method to check GitHub releases (for debugging)
  async testGitHubCheck() {
    try {
      const update = await this.checkForUpdates();
      console.log('GitHub check result:', update);
      return update;
    } catch (error) {
      console.error('GitHub check error:', error);
      throw error;
    }
  }

  stop() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }
}

module.exports = UpdateManager;
