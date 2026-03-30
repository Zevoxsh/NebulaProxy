import { spawn } from 'child_process';
import crypto from 'crypto';
import net from 'net';

/**
 * Validate container name to prevent command injection
 * Docker container names must follow specific rules
 */
function sanitizeContainerName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Container name must be a non-empty string');
  }

  // Docker naming rules: [a-zA-Z0-9][a-zA-Z0-9_.-]*
  const regex = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

  if (!regex.test(name)) {
    throw new Error(`Invalid container name format: ${name}. Must match [a-zA-Z0-9][a-zA-Z0-9_.-]*`);
  }

  return name;
}

/**
 * Validate hostname to prevent command injection
 */
function sanitizeHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    throw new Error('Hostname must be a non-empty string');
  }

  // Allow valid hostnames and IP addresses
  const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;

  if (!hostnameRegex.test(hostname) && !ipv4Regex.test(hostname)) {
    throw new Error(`Invalid hostname format: ${hostname}`);
  }

  return hostname;
}

/**
 * Validate port number
 */
function sanitizePort(port) {
  const portNum = parseInt(port, 10);

  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 1 and 65535`);
  }

  return portNum;
}

/**
 * Execute a docker command safely using spawn
 * @param {string[]} args - Command arguments (NOT a shell command string)
 * @param {Object} options - Spawn options
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function execDockerCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 30000; // 30s default timeout
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Spawn docker process with arguments array (no shell interpretation)
    const proc = spawn('docker', args, {
      ...options,
      shell: false,  // ✅ Critical: Disable shell to prevent injection
      env: options.env || process.env
    });

    // Collect stdout
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Handle process completion
    proc.on('close', (exitCode) => {
      if (timedOut) return;

      if (exitCode === 0) {
        resolve({ stdout, stderr, exitCode });
      } else {
        const error = new Error(`Docker command failed with exit code ${exitCode}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = exitCode;
        reject(error);
      }
    });

    // Handle process errors
    proc.on('error', (err) => {
      if (timedOut) return;
      reject(err);
    });

    // Timeout protection
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
      reject(new Error(`Docker command timeout after ${timeout}ms`));
    }, timeout);

    // Cleanup timeout on completion
    proc.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Docker helper utilities for setup wizard
 */
export class DockerHelper {
  /**
   * Check if Docker is available
   */
  static async isDockerAvailable() {
    try {
      await execDockerCommand(['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a container exists
   */
  static async containerExists(name) {
    try {
      const safeName = sanitizeContainerName(name);

      const { stdout } = await execDockerCommand([
        'ps',
        '-a',
        '--filter',
        `name=^${safeName}$`,
        '--format',
        '{{.Names}}'
      ], { timeout: 5000 });

      return stdout.trim() === safeName;
    } catch {
      return false;
    }
  }

  /**
   * Check if a container is running
   */
  static async isContainerRunning(name) {
    try {
      const safeName = sanitizeContainerName(name);

      const { stdout } = await execDockerCommand([
        'ps',
        '--filter',
        `name=^${safeName}$`,
        '--format',
        '{{.Names}}'
      ], { timeout: 5000 });

      return stdout.trim() === safeName;
    } catch {
      return false;
    }
  }

  /**
   * Create and start PostgreSQL container
   */
  static async createPostgresContainer(projectName = 'nebulaproxy') {
    const safeName = sanitizeContainerName(projectName);
    const containerName = `${safeName}-postgres`;
    const password = this.generatePassword(32);
    const dbName = 'nebula_proxy';
    const user = 'nebula';

    try {
      // Check if container already exists
      if (await this.containerExists(containerName)) {
        // Start if stopped
        if (!(await this.isContainerRunning(containerName))) {
          await execDockerCommand(['start', containerName], { timeout: 10000 });
        }

        // Get existing password from env
        const { stdout } = await execDockerCommand([
          'inspect',
          containerName,
          '--format',
          '{{range .Config.Env}}{{println .}}{{end}}'
        ], { timeout: 5000 });

        const envVars = stdout.split('\n');
        const passwordLine = envVars.find(line => line.startsWith('POSTGRES_PASSWORD='));
        const existingPassword = passwordLine ? passwordLine.split('=')[1] : password;

        return {
          host: 'localhost',
          port: 5432,
          database: dbName,
          user: user,
          password: existingPassword,
          containerName
        };
      }

      // Create new container with arguments array
      await execDockerCommand([
        'run',
        '-d',
        '--name', containerName,
        '--network', 'host',
        '-e', `POSTGRES_DB=${dbName}`,
        '-e', `POSTGRES_USER=${user}`,
        '-e', `POSTGRES_PASSWORD=${password}`,
        '-v', `${containerName}-data:/var/lib/postgresql/data`,
        '--restart', 'unless-stopped',
        'postgres:14-alpine'
      ], { timeout: 60000 });

      // Wait for container to be ready
      await this.waitForPostgres(containerName, 30);

      return {
        host: 'localhost',
        port: 5432,
        database: dbName,
        user: user,
        password: password,
        containerName
      };
    } catch (error) {
      throw new Error(`Failed to create PostgreSQL container: ${error.message}`);
    }
  }

  /**
   * Test PostgreSQL connection using native TCP instead of docker exec
   * This is safer as it avoids shell commands entirely
   */
  static async testPostgresConnection(host, port, database, user, password) {
    try {
      const safeHost = sanitizeHostname(host);
      const safePort = sanitizePort(port);

      // Test TCP connection first (safer than running commands)
      const connected = await this.testTCPConnection(safeHost, safePort, 3000);

      if (!connected) {
        return false;
      }

      // If we need to actually test PostgreSQL protocol, use docker run (not exec)
      // with proper argument separation
      try {
        await execDockerCommand([
          'run',
          '--rm',
          '--network', 'host',
          'postgres:14-alpine',
          'psql',
          '-h', safeHost,
          '-p', safePort.toString(),
          '-U', user,
          '-d', database,
          '-c', 'SELECT 1'
        ], {
          timeout: 10000,
          env: {
            ...process.env,
            PGPASSWORD: password
          }
        });

        return true;
      } catch {
        return false;
      }
    } catch (error) {
      console.error('[DockerHelper] Postgres connection test failed:', error.message);
      return false;
    }
  }

  /**
   * Test TCP connection to a host:port
   * Safer alternative to bash -c tricks
   */
  static testTCPConnection(host, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: host,
        port: port,
        timeout: timeoutMs
      });

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Wait for PostgreSQL to be ready
   */
  static async waitForPostgres(containerName, timeoutSeconds = 30) {
    const safeName = sanitizeContainerName(containerName);
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;

    while (Date.now() - startTime < timeout) {
      try {
        const { stdout } = await execDockerCommand([
          'exec',
          safeName,
          'pg_isready',
          '-U', 'postgres'
        ], { timeout: 5000 });

        if (stdout.includes('accepting connections')) {
          return true;
        }
      } catch {
        // Container not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('PostgreSQL container failed to start within timeout');
  }

  /**
   * Update docker-compose.yml to include PostgreSQL
   */
  static async addPostgresToCompose(projectName = 'nebulaproxy') {
    // This will be handled by updating the docker-compose.yml file
    // For now, we'll use standalone container
    return true;
  }

  /**
   * Generate random password
   */
  static generatePassword(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
      password += chars[randomBytes[i] % chars.length];
    }

    return password;
  }

  /**
   * Detect if LDAP/AD is available on the network
   * Uses native Node.js net module instead of bash tricks
   */
  static async detectLDAP(host, port = 389) {
    try {
      const safeHost = sanitizeHostname(host);
      const safePort = sanitizePort(port);

      return await this.testTCPConnection(safeHost, safePort, 3000);
    } catch {
      return false;
    }
  }

  /**
   * Get project name from environment or docker-compose
   */
  static getProjectName() {
    const name = process.env.COMPOSE_PROJECT_NAME || 'nebulaproxy';
    try {
      return sanitizeContainerName(name);
    } catch {
      return 'nebulaproxy'; // Fallback to safe default
    }
  }
}
