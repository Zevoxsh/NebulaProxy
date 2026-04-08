import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repository root - use REPO_PATH env var in Docker, or fallback to relative path
const REPO_ROOT = process.env.REPO_PATH || path.resolve(__dirname, '../../');

/**
 * Execute command with spawn (prevents command injection)
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Spawn options
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      shell: false, // Critical: Disable shell to prevent injection
      timeout: options.timeout || 30000
    });

    let stdout = '';
    let stderr = '';

    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    proc.on('error', (error) => {
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/**
 * Git Service - Wrapper for git operations
 * Handles all git commands for the auto-update system
 */
class GitService {
  constructor() {
    this.repoRoot = REPO_ROOT;
    this.gitDir = path.join(this.repoRoot, '.git');
    this.defaultTimeout = 30000; // 30 seconds
    this._isAvailable = null; // Cache availability check
  }

  /**
   * Check if git repository is available
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (this._isAvailable !== null) {
      return this._isAvailable;
    }

    try {
      console.log(`[GitService] Checking Git availability at: ${this.repoRoot}`);
      console.log(`[GitService] Git directory: ${this.gitDir}`);

      // Check if git command exists
      await execCommand('git', ['--version'], { timeout: 5000 });

      // Check if .git directory exists
      const fs = await import('fs/promises');
      const gitDirExists = await fs.access(this.gitDir).then(() => true).catch(() => false);
      console.log(`[GitService] .git directory exists: ${gitDirExists}`);

      if (!gitDirExists) {
        console.log(`[GitService] Git directory not found at ${this.gitDir}`);
        this._isAvailable = false;
        return false;
      }

      // Try to run a git command
      await this.execGit('git rev-parse --git-dir');
      console.log(`[GitService] Git repository is available`);
      this._isAvailable = true;
    } catch (error) {
      console.error(`[GitService] Git not available: ${error.message}`);
      this._isAvailable = false;
    }

    return this._isAvailable;
  }

  /**
   * Refresh Git availability check (clear cache and recheck)
   * @returns {Promise<boolean>}
   */
  async refreshAvailability() {
    this._isAvailable = null;
    return await this.isAvailable();
  }

  /**
   * Execute a git command with timeout
   * @param {string} command - Git command to execute (e.g., "git rev-parse HEAD")
   * @param {number} timeout - Command timeout in ms
   * @returns {Promise<{stdout: string, stderr: string}>}
   */
  async execGit(command, timeout = this.defaultTimeout) {
    try {
      // Parse command string: "git rev-parse HEAD" -> ["rev-parse", "HEAD"]
      const parts = command.trim().split(/\s+/);
      if (parts[0] !== 'git') {
        throw new Error('Command must start with "git"');
      }
      const args = parts.slice(1); // Remove "git" prefix

      return await execCommand('git', args, {
        cwd: this.repoRoot,
        timeout,
        env: { ...process.env, GIT_DIR: this.gitDir }
      });
    } catch (error) {
      throw new Error(`Git command failed: ${error.message}`);
    }
  }

  /**
   * Get current commit SHA
   * @returns {Promise<string>} Current commit hash
   */
  async getCurrentCommit() {
    if (!(await this.isAvailable())) {
      return 'unavailable';
    }
    const { stdout } = await this.execGit('git rev-parse HEAD');
    return stdout;
  }

  /**
   * Get current branch name
   * @returns {Promise<string>} Branch name
   */
  async getCurrentBranch() {
    if (!(await this.isAvailable())) {
      return 'main';
    }
    const { stdout } = await this.execGit('git rev-parse --abbrev-ref HEAD');
    return stdout;
  }

  /**
   * Fetch latest changes from remote
   * @param {string} remote - Remote name (default: origin)
   * @returns {Promise<void>}
   */
  async fetch(remote = 'origin') {
    if (!(await this.isAvailable())) {
      return;
    }
    await this.execGit(`git fetch ${remote}`, 60000); // 60s timeout for network
  }

  /**
   * Get remote commit SHA for current branch
   * @param {string} remote - Remote name
   * @returns {Promise<string>} Remote commit hash
   */
  async getRemoteCommit(remote = 'origin') {
    if (!(await this.isAvailable())) {
      return 'unavailable';
    }
    const branch = await this.getUpdateBranch(remote);
    const { stdout } = await this.execGit(`git rev-parse ${remote}/${branch}`);
    return stdout;
  }

  /**
   * Resolve branch used for update operations.
   * Falls back to remote default branch when HEAD is detached.
   */
  async getUpdateBranch(remote = 'origin') {
    const current = await this.getCurrentBranch();
    if (current && current !== 'HEAD') {
      return current;
    }

    try {
      const { stdout } = await this.execGit(`git symbolic-ref --short refs/remotes/${remote}/HEAD`);
      const resolved = stdout?.trim()?.replace(`${remote}/`, '');
      if (resolved) {
        return resolved;
      }
    } catch {
      // Ignore and use fallback below.
    }

    return 'main';
  }

  /**
   * Check if repository has local uncommitted changes
   * @returns {Promise<boolean>} True if there are local changes
   */
  async hasLocalChanges() {
    const { stdout } = await this.execGit('git status --porcelain');
    return stdout.length > 0;
  }

  /**
   * Create a rollback tag for current commit
   * @param {number} updateId - Update ID from database
   * @returns {Promise<string>} Tag name created
   */
  async createRollbackTag(updateId) {
    const timestamp = Date.now();
    const tagName = `pre-update-${updateId}-${timestamp}`;
    await this.execGit(`git tag ${tagName}`);
    return tagName;
  }

  /**
   * Delete a git tag
   * @param {string} tagName - Tag to delete
   * @returns {Promise<void>}
   */
  async deleteTag(tagName) {
    await this.execGit(`git tag -d ${tagName}`);
  }

  /**
   * Pull latest changes from remote
   * @param {string} remote - Remote name
   * @returns {Promise<void>}
   */
  async pull(remote = 'origin') {
    const branch = await this.getUpdateBranch(remote);
    await this.execGit(`git pull ${remote} ${branch}`, 60000);
  }

  /**
   * Reset repository to specific commit or tag
   * @param {string} commitOrTag - Commit SHA or tag name
   * @returns {Promise<void>}
   */
  async resetHard(commitOrTag) {
    await this.execGit(`git reset --hard ${commitOrTag}`);
  }

  /**
   * Get list of files changed between two commits
   * @param {string} fromCommit - Starting commit
   * @param {string} toCommit - Ending commit
   * @returns {Promise<string[]>} Array of changed file paths
   */
  async getChangedFiles(fromCommit, toCommit) {
    const { stdout } = await this.execGit(`git diff --name-only ${fromCommit} ${toCommit}`);
    return stdout ? stdout.split('\n').filter(Boolean) : [];
  }

  /**
   * Analyze changes between commits to determine rebuild requirements
   * @param {string} fromCommit - Starting commit
   * @param {string} toCommit - Ending commit
   * @returns {Promise<Object>} Analysis result
   */
  async analyzeChanges(fromCommit, toCommit) {
    const changedFiles = await this.getChangedFiles(fromCommit, toCommit);

    const analysis = {
      changedFiles,
      needsFrontendRebuild: false,
      needsBackendRebuild: false,
      hasMigrations: false,
      migrationFiles: []
    };

    // Patterns that trigger rebuilds
    const frontendPatterns = [
      /^frontend\//,
      /^frontend\/package\.json$/,
      /^frontend\/Dockerfile$/
    ];

    const backendRebuildPatterns = [
      /^backend\/package\.json$/,
      /^backend\/Dockerfile$/,
      /^Dockerfile$/, // Root Dockerfile
      /^docker-compose\.yml$/
    ];

    const migrationPattern = /^backend\/migrations\/.*\.sql$/;

    for (const file of changedFiles) {
      // Check frontend rebuild
      if (frontendPatterns.some(pattern => pattern.test(file))) {
        analysis.needsFrontendRebuild = true;
      }

      // Check backend rebuild (only for dependency/docker changes)
      if (backendRebuildPatterns.some(pattern => pattern.test(file))) {
        analysis.needsBackendRebuild = true;
      }

      // Check migrations
      if (migrationPattern.test(file)) {
        analysis.hasMigrations = true;
        analysis.migrationFiles.push(file);
      }
    }

    return analysis;
  }

  /**
   * Get commit message
   * @param {string} commit - Commit SHA
   * @returns {Promise<string>} Commit message
   */
  async getCommitMessage(commit) {
    const { stdout } = await this.execGit(`git log -1 --pretty=%B ${commit}`);
    return stdout;
  }

  /**
   * Get commit short SHA (7 characters)
   * @param {string} commit - Full commit SHA
   * @returns {string} Short SHA
   */
  getShortCommit(commit) {
    return commit.substring(0, 7);
  }

  /**
   * Get commits between two refs
   * @param {string} fromCommit - Starting commit
   * @param {string} toCommit - Ending commit
   * @returns {Promise<Array>} Array of commit objects
   */
  async getCommitsBetween(fromCommit, toCommit) {
    const { stdout } = await this.execGit(
      `git log --pretty=format:"%H|%s|%an|%ae|%ad" --date=iso ${fromCommit}..${toCommit}`
    );

    if (!stdout) return [];

    return stdout.split('\n').map(line => {
      const [hash, subject, author, email, date] = line.split('|');
      return { hash, subject, author, email, date };
    });
  }

  /**
   * Verify repository is in a clean state for updates
   * @returns {Promise<{valid: boolean, errors: string[]}>}
   */
  async verifyRepository() {
    const errors = [];

    // Check if .git directory exists
    if (!(await this.isAvailable())) {
      errors.push('Git repository not available (running in production mode)');
      return { valid: false, errors };
    }

    // Check if there are local changes
    if (await this.hasLocalChanges()) {
      errors.push('Repository has uncommitted changes');
    }

    // Check if remote is configured
    try {
      await this.execGit('git remote get-url origin');
    } catch (error) {
      errors.push('No remote "origin" configured');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get repository remote URL
   * @returns {Promise<string>} Remote URL
   */
  async getRemoteUrl() {
    const { stdout } = await this.execGit('git remote get-url origin');
    return stdout;
  }
}

// Export singleton instance
export default new GitService();
