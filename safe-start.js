/**
 * Safe Startup Script
 * Validates system files before starting server
 * Performs automatic rollback if errors are detected
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class SafeStartup {
  constructor() {
    this.projectRoot = process.cwd();
    this.filesToCheck = ['server.js', 'package.json'];
    this.directoriesToCheck = ['src', 'public'];
  }

  async validateSystem() {
    console.log('🔍 Validating system files before startup...');

    try {
      // Check main files
      for (const file of this.filesToCheck) {
        const filePath = path.join(this.projectRoot, file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Critical file missing: ${file}`);
        }

        if (file.endsWith('.js')) {
          const syntaxCheck = await this.checkSyntax(filePath);
          if (!syntaxCheck.success) {
            throw new Error(`Syntax error in ${file}: ${syntaxCheck.error}`);
          }
        }
      }

      // Check directories
      for (const dir of this.directoriesToCheck) {
        const dirPath = path.join(this.projectRoot, dir);
        if (fs.existsSync(dirPath)) {
          const dirCheck = await this.checkDirectorySyntax(dirPath);
          if (!dirCheck.success) {
            throw new Error(`Error in ${dir}: ${dirCheck.error}`);
          }
        }
      }

      console.log('✅ System validation successful');
      return { success: true, error: null };

    } catch (error) {
      console.error('❌ System validation failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async checkSyntax(filePath) {
    return new Promise((resolve) => {
      exec(`node --check "${filePath}"`, { cwd: this.projectRoot }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || error.message });
        } else {
          resolve({ success: true, error: null });
        }
      });
    });
  }

  async checkDirectorySyntax(dirPath) {
    const self = this;
    
    async function checkJSFiles(dir) {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const file of files) {
        const filePath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
          const result = await checkJSFiles(filePath);
          if (!result.success) {
            return result;
          }
        } else if (file.name.endsWith('.js')) {
          const check = await self.checkSyntax(filePath);
          if (!check.success) {
            return check;
          }
        }
      }
      
      return { success: true, error: null };
    }

    return checkJSFiles(dirPath);
  }

  async run() {
    console.log('='.repeat(50));
    console.log('🚀 Safe Startup Script');
    console.log('='.repeat(50));

    try {
      // Validate system
      const validation = await this.validateSystem();

      if (validation.success) {
        console.log('✅ System is healthy, starting server...');
        // Start the actual server with runtime error checking
        await this.startServerWithCheck();
        return;
      }

      // System has errors, cannot start
      console.error('❌ System validation failed!');
      console.error('❌ Cannot start server. Manual intervention required.');
      process.exit(1);
    } catch (error) {
      console.error('❌ Startup failed:', error.message);
      console.error('❌ Cannot start server. Manual intervention required.');
      process.exit(1);
    }
  }

  async startServerWithCheck() {
    try {
      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve('./server.js')];
      
      // Try to load server with a timeout
      const serverLoadPromise = new Promise((resolve, reject) => {
        try {
          require('./server.js');
          // Give it 2 seconds to start successfully
          setTimeout(() => resolve(), 2000);
        } catch (error) {
          reject(error);
        }
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Server startup timeout')), 5000);
      });

      await Promise.race([serverLoadPromise, timeoutPromise]);
      console.log('✅ Server started successfully');

    } catch (error) {
      console.error('❌ Server startup failed:', error.message);
      throw error;
    }
  }
}

// Run safe startup
const safeStartup = new SafeStartup();
safeStartup.run().catch(error => {
  console.error('Fatal error during safe startup:', error);
  process.exit(1);
});
