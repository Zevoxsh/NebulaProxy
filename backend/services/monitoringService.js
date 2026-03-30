import os from 'os';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

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
      timeout: options.timeout || 10000
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
        resolve({ stdout, stderr });
      }
    });
  });
}

export class MonitoringService {
  /**
   * Get real-time system metrics
   */
  async getSystemMetrics() {
    const cpuUsage = await this.getCPUUsage();
    const memoryUsage = this.getMemoryUsage();
    const diskUsage = await this.getDiskUsage();
    const networkIO = await this.getNetworkIO();

    return {
      cpu: cpuUsage,
      memory: memoryUsage,
      disk: diskUsage,
      network: networkIO,
      uptime: this.getUptime(),
      platform: os.platform(),
      hostname: os.hostname(),
    };
  }

  /**
   * Get CPU usage percentage
   * Uses two snapshots 200ms apart for accurate real-time measurement
   */
  async getCPUUsage() {
    function snapshot() {
      const cpus = os.cpus();
      let idle = 0;
      let total = 0;
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          total += cpu.times[type];
        }
        idle += cpu.times.idle;
      }
      return { idle, total };
    }

    const s1 = snapshot();
    await new Promise(r => setTimeout(r, 200));
    const s2 = snapshot();

    const idleDelta = s2.idle - s1.idle;
    const totalDelta = s2.total - s1.total;

    if (totalDelta === 0) return 0;
    return Math.round(100 - (100 * idleDelta / totalDelta));
  }

  /**
   * Get memory usage
   */
  getMemoryUsage() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const usagePercent = Math.round((usedMem / totalMem) * 100);

    return {
      total: this.formatBytes(totalMem),
      used: this.formatBytes(usedMem),
      free: this.formatBytes(freeMem),
      percentage: usagePercent
    };
  }

  /**
   * Get disk usage (works on Linux)
   */
  async getDiskUsage() {
    try {
      const { stdout } = await execCommand('df', ['-h', '/']);
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) throw new Error('Invalid df output');

      // Parse last line (the actual data, not header)
      const lastLine = lines[lines.length - 1];
      const parts = lastLine.trim().split(/\s+/);

      // df output: Filesystem Size Used Avail Use% Mounted
      const total = parts[1] || 'N/A';
      const used = parts[2] || 'N/A';
      const available = parts[3] || 'N/A';
      const percentage = parts[4] ? parseInt(parts[4]) : 0;

      return {
        total,
        used,
        available,
        percentage
      };
    } catch (error) {
      // Fallback for Windows or error
      return {
        total: 'N/A',
        used: 'N/A',
        available: 'N/A',
        percentage: 0
      };
    }
  }

  /**
   * Get network I/O (approximation)
   */
  async getNetworkIO() {
    try {
      if (os.platform() === 'linux') {
        // Read /proc/net/dev directly instead of using shell commands
        const content = await fs.readFile('/proc/net/dev', 'utf-8');
        const lines = content.split('\n');

        let totalReceived = 0;
        for (const line of lines) {
          // Skip loopback and header lines
          if (line.includes('lo:') || !line.includes(':')) continue;

          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            // Second column is received bytes
            const received = parseInt(parts[1]) || 0;
            totalReceived += received;
          }
        }

        const receivedMB = totalReceived / 1024 / 1024;
        return {
          received: `${receivedMB.toFixed(2)} MB`,
          sent: 'N/A'
        };
      }
    } catch (error) {
      // Ignore errors
    }

    return {
      received: 'N/A',
      sent: 'N/A'
    };
  }

  /**
   * Get system uptime
   */
  getUptime() {
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Get system logs (last N lines)
   */
  async getSystemLogs(lines = 50) {
    const logs = [];

    try {
      // Try to read from common log locations
      const logPaths = [
        '/var/log/syslog',
        '/var/log/messages',
        '/var/log/system.log'
      ];

      for (const logPath of logPaths) {
        try {
          const safeLines = Math.max(1, Math.min(10000, parseInt(lines, 10) || 50));
          const { stdout } = await execCommand('tail', ['-n', String(safeLines), logPath]);
          if (stdout) {
            const logLines = stdout.trim().split('\n');
            logLines.forEach(line => {
              logs.push({
                timestamp: new Date().toISOString(),
                level: this.detectLogLevel(line),
                message: line,
                source: 'System'
              });
            });
            break; // Found logs, stop searching
          }
        } catch (err) {
          continue; // Try next log path
        }
      }

      // If no system logs found, return application logs
      if (logs.length === 0) {
        logs.push({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'System logs not accessible. Application logs only.',
          source: 'Monitor'
        });
      }

      return logs.slice(0, lines);
    } catch (error) {
      return [{
        timestamp: new Date().toISOString(),
        level: 'warning',
        message: 'Unable to access system logs',
        source: 'Monitor'
      }];
    }
  }

  /**
   * Detect log level from message
   */
  detectLogLevel(message) {
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes('error') || lowerMsg.includes('fail')) return 'error';
    if (lowerMsg.includes('warn')) return 'warning';
    if (lowerMsg.includes('success')) return 'success';
    return 'info';
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Get process list
   */
  async getProcessList() {
    try {
      if (os.platform() === 'linux') {
        const { stdout } = await execCommand('ps', ['aux', '--sort=-%mem']);
        const lines = stdout.trim().split('\n');

        // Get lines 2-11 (skip header, take top 10)
        const processLines = lines.slice(1, 11);

        return processLines.map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0],
            pid: parts[1],
            cpu: parts[2],
            mem: parts[3],
            command: parts.slice(10).join(' ')
          };
        });
      }
    } catch (error) {
      // Ignore
    }

    return [];
  }
}

export const monitoringService = new MonitoringService();
