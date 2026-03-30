import { spawn } from 'child_process';

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
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Sanitize container name/ID to prevent command injection
 * @param {string} name - Container name or ID
 * @returns {string} Sanitized name
 */
function sanitizeContainerName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Container name must be a non-empty string');
  }
  // Docker container names: alphanumeric, _, -, .
  // Docker IDs: hexadecimal
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
  if (!regex.test(name)) {
    throw new Error(`Invalid container name format: ${name}`);
  }
  return name;
}

export class DockerService {
  /**
   * List all containers (running and stopped)
   */
  async listContainers() {
    try {
      const { stdout } = await execCommand('docker', [
        'ps',
        '-a',
        '--format', '{{json .}}',
        '--filter', 'label=com.docker.compose.project=nebulaproxy'
      ]);

      if (!stdout.trim()) {
        return [];
      }

      const lines = stdout.trim().split('\n');
      const containers = lines.map(line => {
        const container = JSON.parse(line);
        return {
          id: container.ID,
          name: container.Names,
          image: container.Image,
          status: container.State,
          uptime: container.Status,
          ports: container.Ports || '-',
          created: container.CreatedAt
        };
      });

      return containers;
    } catch (error) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  /**
   * Get container stats (CPU, Memory)
   */
  async getContainerStats(containerId) {
    try {
      const safeContainerId = sanitizeContainerName(containerId);
      const { stdout } = await execCommand('docker', [
        'stats',
        safeContainerId,
        '--no-stream',
        '--format', '{{json .}}'
      ]);

      const stats = JSON.parse(stdout);
      return {
        cpu: stats.CPUPerc,
        memory: stats.MemPerc,
        memoryUsage: stats.MemUsage,
        netIO: stats.NetIO,
        blockIO: stats.BlockIO
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Start a container
   */
  async startContainer(containerName) {
    try {
      const safeName = sanitizeContainerName(containerName);
      await execCommand('docker', ['start', safeName]);
      return { success: true, message: `Container ${containerName} started` };
    } catch (error) {
      throw new Error(`Failed to start container: ${error.message}`);
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(containerName) {
    try {
      const safeName = sanitizeContainerName(containerName);
      await execCommand('docker', ['stop', safeName]);
      return { success: true, message: `Container ${containerName} stopped` };
    } catch (error) {
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  /**
   * Restart a container
   */
  async restartContainer(containerName) {
    try {
      const safeName = sanitizeContainerName(containerName);
      await execCommand('docker', ['restart', safeName]);
      return { success: true, message: `Container ${containerName} restarted` };
    } catch (error) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(containerName, lines = 50) {
    try {
      const safeName = sanitizeContainerName(containerName);
      const safeLines = Math.max(1, Math.min(10000, parseInt(lines, 10) || 50));

      const { stdout } = await execCommand('docker', [
        'logs',
        safeName,
        '--tail', String(safeLines)
      ]);
      return stdout;
    } catch (error) {
      throw new Error(`Failed to get logs: ${error.message}`);
    }
  }
}

export const dockerService = new DockerService();
