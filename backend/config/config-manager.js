import Redis from 'ioredis';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_KEY = 'nebulaproxy:config';
const CONFIG_VERSION_KEY = 'nebulaproxy:config:version';

class ConfigManager {
  constructor() {
    this.redis = null;
    this.config = {};
    this.initialized = false;
  }

  // Initialize Redis connection
  async init() {
    if (this.initialized) return;

    // Get Redis connection info from environment (these are the only vars in .env)
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379');
    const redisPassword = process.env.REDIS_PASSWORD || undefined;
    const redisDb = parseInt(process.env.REDIS_DB || '0');

    this.redis = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      db: redisDb,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 10
    });

    // Wait for Redis to be ready
    await new Promise((resolve, reject) => {
      this.redis.once('ready', resolve);
      this.redis.once('error', reject);
      setTimeout(() => reject(new Error('Redis connection timeout')), 10000);
    });

    // Load configuration from Redis
    await this.loadFromRedis();

    this.initialized = true;
  }

  // Load configuration from Redis
  async loadFromRedis() {
    try {
      const configJson = await this.redis.get(CONFIG_KEY);

      if (configJson) {
        this.config = JSON.parse(configJson);
        let migrated = false;

        // Legacy compose/installer defaults used nebula + nebula_proxy.
        // Normalize them to the actual Compose service credentials.
        if (this.config.DB_USER === 'nebula') {
          this.config.DB_USER = 'nebulaproxy';
          migrated = true;
        }

        if (this.config.DB_NAME === 'nebula_proxy') {
          this.config.DB_NAME = 'nebulaproxy';
          migrated = true;
        }

        if (migrated) {
          await this.redis.set(CONFIG_KEY, JSON.stringify(this.config));
          await this.redis.incr(CONFIG_VERSION_KEY);
          console.log('Configuration migrated to current PostgreSQL defaults');
        }

        console.log('Configuration loaded from Redis');
      } else {
        // No config in Redis, load defaults from .env.example
        console.log('WARNING: No configuration found in Redis, using defaults');
        this.config = this.getDefaultConfig();
      }
    } catch (error) {
      console.error('Failed to load config from Redis:', error);
      this.config = this.getDefaultConfig();
    }
  }

  // Get default configuration from .env.example
  getDefaultConfig() {
    const examplePath = join(__dirname, '..', '.env.example');

    if (!existsSync(examplePath)) {
      return {};
    }

    const content = readFileSync(examplePath, 'utf-8');
    const config = {};

    content.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;

      const [key, ...valueParts] = line.split('=');
      if (key) {
        config[key.trim()] = valueParts.join('=') || '';
      }
    });

    return config;
  }

  // Save configuration to Redis
  async saveToRedis(newConfig) {
    try {
      // Validate config before saving
      const errors = this.validateConfig(newConfig);
      if (errors.length > 0) {
        throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
      }

      this.config = { ...this.config, ...newConfig };

      await this.redis.set(CONFIG_KEY, JSON.stringify(this.config));

      // Increment version
      await this.redis.incr(CONFIG_VERSION_KEY);

      console.log('Configuration saved to Redis');

      return true;
    } catch (error) {
      console.error('Failed to save config to Redis:', error);
      throw error;
    }
  }

  // Get a configuration value
  get(key, defaultValue = undefined) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  // Get all configuration
  getAll() {
    return { ...this.config };
  }

  // Check if configuration is properly set up
  isConfigured() {
    const required = ['JWT_SECRET', 'DB_PASSWORD', 'PROXY_CHECK_TOKEN', 'DB_NAME', 'DB_USER'];

    for (const key of required) {
      const value = this.config[key];
      if (!value || value === '' || value.includes('replace-with') || value === 'change-me') {
        return false;
      }
    }

    return true;
  }

  // Validate configuration
  validateConfig(config) {
    const errors = [];

    // Required fields
    const required = ['JWT_SECRET', 'DB_PASSWORD', 'PROXY_CHECK_TOKEN', 'DB_NAME', 'DB_USER'];
    required.forEach(field => {
      if (!config[field] || config[field].trim() === '') {
        errors.push(`${field} is required`);
      }
    });

    // Validate email format
    if (config.ACME_EMAIL && config.ACME_EMAIL.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(config.ACME_EMAIL)) {
        errors.push('ACME_EMAIL must be a valid email address');
      }
    }

    // Validate SMTP email if SMTP is configured
    if (config.SMTP_HOST && config.SMTP_HOST.trim()) {
      if (config.SMTP_FROM_EMAIL && config.SMTP_FROM_EMAIL.trim()) {
        // Accept emails with or without TLD (for localhost, etc.)
        const emailRegex = /^[^\s@]+@[^\s@]+(\.[^\s@]+)?$/;
        if (!emailRegex.test(config.SMTP_FROM_EMAIL)) {
          errors.push('SMTP_FROM_EMAIL must be a valid email address');
        }
      }
    }

    // Validate ports
    const portFields = ['PORT', 'FRONTEND_PORT', 'DB_PORT', 'SMTP_PORT'];
    portFields.forEach(field => {
      if (config[field]) {
        const port = parseInt(config[field]);
        if (isNaN(port) || port < 1 || port > 65535) {
          errors.push(`${field} must be a valid port number (1-65535)`);
        }
      }
    });

    // Validate AUTH_MODE
    if (config.AUTH_MODE && !['ldap', 'local'].includes(config.AUTH_MODE)) {
      errors.push('AUTH_MODE must be either "ldap" or "local"');
    }

    // Validate LDAP if AUTH_MODE is ldap
    if (config.AUTH_MODE === 'ldap') {
      const ldapRequired = ['LDAP_URL', 'LDAP_BASE_DN'];
      ldapRequired.forEach(field => {
        if (!config[field] || config[field].trim() === '') {
          errors.push(`${field} is required when using LDAP authentication`);
        }
      });
    }

    return errors;
  }

  // Close Redis connection
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  // ── Branding ─────────────────────────────────────────────────────────────

  async getAppName() {
    try {
      await this.init();
      const raw = await this.redis.get('nebulaproxy:branding:app_name');
      return raw || 'NebulaProxy';
    } catch {
      return 'NebulaProxy';
    }
  }

  async setAppName(name) {
    await this.init();
    const safe = String(name || '').trim().slice(0, 64) || 'NebulaProxy';
    await this.redis.set('nebulaproxy:branding:app_name', safe);
    return safe;
  }
}

// Singleton instance
const configManager = new ConfigManager();

export default configManager;
