import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import configManager from './config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load minimal .env for Redis connection
dotenv.config({ path: join(__dirname, '.env') });

// Helper to get config value from Redis, then .env, then default
function getConfig(key, defaultValue) {
  // Try Redis first
  const redisValue = configManager.get(key);
  if (redisValue !== undefined) return redisValue;

  // Fallback to .env file
  const envValue = process.env[key];
  if (envValue !== undefined) return envValue;

  // Finally use default
  return defaultValue;
}

// Initialize config from Redis
let configInitialized = false;

async function initializeConfig() {
  if (!configInitialized) {
    await configManager.init();
    configInitialized = true;

    // Validate critical variables after init
    const isTestEnv = getConfig('NODE_ENV') === 'test'
      || process.env.VITEST
      || (process.env.npm_lifecycle_event || '').includes('test');

    const fallbackTestSecret = 'test-secret-for-ci-please-change-0000000000000000';
    const jwtSecret = getConfig('JWT_SECRET') || (isTestEnv ? fallbackTestSecret : undefined);

    if (!jwtSecret) {
      if (!isTestEnv) {
        throw new Error('JWT_SECRET is not configured. Complete setup before starting the server.');
      }
      return;
    }

    if (!isTestEnv && jwtSecret.length < 32) {
      throw new Error('JWT_SECRET is too short (< 32 characters). Use at least 32 characters.');
    }

    if (!isTestEnv && (jwtSecret === 'change-this-secret-in-production' || jwtSecret === 'your-secret-key' || jwtSecret === 'secret' || jwtSecret.includes('replace-with'))) {
      throw new Error('JWT_SECRET uses a weak/default value. Configure a strong secret.');
    }
  }
}

// Export async init function
export { initializeConfig };

// Create config object that reads from configManager
export const config = {
  // Server
  get port() { return parseInt(getConfig('PORT', '3000'), 10); },
  get host() { return getConfig('HOST', '0.0.0.0'); },
  get nodeEnv() { return getConfig('NODE_ENV', 'development'); },
  logging: {
    get level() { return (getConfig('LOG_LEVEL', 'warn') || 'warn').toLowerCase(); },
    get quiet() {
      const defaultQuiet = getConfig('NODE_ENV', 'development') === 'production' ? 'true' : 'false';
      return getConfig('LOG_QUIET', defaultQuiet) === 'true';
    },
    get startupSummary() {
      const defaultQuiet = getConfig('NODE_ENV', 'development') === 'production' ? 'true' : 'false';
      const quiet = getConfig('LOG_QUIET', defaultQuiet) === 'true';
      return getConfig('LOG_STARTUP_SUMMARY', quiet ? 'false' : 'true') === 'true';
    },
    get suppressPrefixes() {
      const fallback = [
        'ProxyManager',
        'AcmeManager',
        'LDAP',
        'Queue',
        'RetryWorker',
        'DB',
        'Database',
        'TCP Proxy',
        'UDP Proxy',
        'SMTP Proxy',
        'WebSocketProxy',
        'Email',
        'Discord',
        'Redis',
        'LogBroadcastService'
      ].join(',');

      return (getConfig('LOG_SUPPRESS_PREFIXES', fallback) || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    },
    get authDebug() { return getConfig('AUTH_DEBUG', 'false') === 'true'; }
  },

  frontend: {
    get port() { return parseInt(getConfig('FRONTEND_PORT', '3001'), 10); },
    get buildOnStart() { return getConfig('FRONTEND_BUILD_ON_START', 'true') !== 'false'; },
    get distPath() { return getConfig('FRONTEND_DIST_PATH') || join(__dirname, '..', 'frontend', 'dist'); }
  },

  // JWT
  get jwtSecret() {
    const isTestEnv = getConfig('NODE_ENV') === 'test'
      || process.env.VITEST
      || (process.env.npm_lifecycle_event || '').includes('test');
    return getConfig('JWT_SECRET') || (isTestEnv ? 'test-secret-for-ci-please-change-0000000000000000' : '');
  },
  jwtExpiry: '24h',

  // Auth
  auth: {
    get mode() {
      const rawAuthMode = (getConfig('AUTH_MODE', 'ldap') || 'ldap').toLowerCase();
      return rawAuthMode === 'local' ? 'local' : 'ldap';
    }
  },

  // LDAP
  ldap: {
    get url() { return getConfig('LDAP_URL', 'ldap://localhost:389'); },
    get baseDN() { return getConfig('LDAP_BASE_DN', 'dc=example,dc=com'); },
    get bindDN() { return getConfig('LDAP_BIND_DN', 'cn=admin,dc=example,dc=com'); },
    get bindPassword() { return getConfig('LDAP_BIND_PASSWORD', 'admin'); },
    get adminGroup() { return getConfig('LDAP_ADMIN_GROUP', 'CN=ProxyAdmins,OU=Groups,DC=example,DC=com'); },
    get userGroup() { return getConfig('LDAP_USER_GROUP', 'CN=ProxyUsers,OU=Groups,DC=example,DC=com'); },
    get requireGroup() { return getConfig('LDAP_REQUIRE_GROUP', 'false') === 'true'; },
    timeout: 5000,
    connectTimeout: 10000
  },

  // Database
  database: {
    get type() { return getConfig('DB_TYPE', 'postgresql'); },
    get host() { return getConfig('DB_HOST', 'localhost'); },
    get port() { return parseInt(getConfig('DB_PORT', '5432'), 10); },
    get name() { return getConfig('DB_NAME', 'nebulaproxy'); },
    get user() { return getConfig('DB_USER', 'nebulaproxy'); },
    get password() { return getConfig('DB_PASSWORD', ''); },
    get path() { return getConfig('DB_PATH') || join(__dirname, 'database.db'); }
  },

  // Proxy
  proxy: {
    get enabled() { return getConfig('PROXY_ENABLED', 'true') === 'true'; },
    get allowedDomains() {
      return (getConfig('ALLOWED_DOMAINS', '') || '').split(',').map((v) => v.trim()).filter(Boolean);
    },
    get allowPrivateBackends() {
      const isTestEnv = getConfig('NODE_ENV') === 'test';
      return getConfig('ALLOW_PRIVATE_BACKENDS', 'false') === 'true' && !isTestEnv;
    },
    get allowInsecureBackends() { return getConfig('ALLOW_INSECURE_BACKENDS', 'false') === 'true'; },
    get checkToken() {
      return (getConfig('PROXY_CHECK_TOKEN') || getConfig('JWT_SECRET') || '').trim();
    },
    // SECURITY: Max HTTP request body size in bytes (default 100MB)
    get maxRequestBodySize() {
      return parseInt(getConfig('MAX_REQUEST_BODY_SIZE', String(100 * 1024 * 1024)), 10);
    },
    get requestTimeoutMs() {
      return parseInt(getConfig('HTTP_PROXY_REQUEST_TIMEOUT_MS', '60000'), 10);
    },
    get injectConsoleScript() {
      return getConfig('PROXY_INJECT_CONSOLE_SCRIPT', 'false') === 'true';
    },
    get badGatewayPage() {
      return {
        htmlTitle: getConfig('BAD_GATEWAY_HTML_TITLE', 'Bad Gateway'),
        badge: getConfig('BAD_GATEWAY_BADGE', 'Bad Gateway'),
        title: getConfig('BAD_GATEWAY_TITLE', 'Service amont indisponible'),
        subtitle: getConfig('BAD_GATEWAY_SUBTITLE', "Le proxy ne peut pas joindre le backend pour ce domaine. L'ecran suit le meme theme que l'interface admin afin de garder une experience coherente."),
        message: getConfig('BAD_GATEWAY_MESSAGE', 'The backend server is temporarily unavailable'),
        domainLabel: getConfig('BAD_GATEWAY_DOMAIN_LABEL', 'Domaine'),
        proxyLabel: getConfig('BAD_GATEWAY_PROXY_LABEL', 'Proxy'),
        proxyValue: getConfig('BAD_GATEWAY_PROXY_VALUE', 'NebulaProxy'),
        causeLabel: getConfig('BAD_GATEWAY_CAUSE_LABEL', 'Cause'),
        causeValue: getConfig('BAD_GATEWAY_CAUSE_VALUE', 'Backend not reachable'),
        statusLabel: getConfig('BAD_GATEWAY_STATUS_LABEL', 'Statut'),
        statusValue: getConfig('BAD_GATEWAY_STATUS_VALUE', '502 Service Unavailable'),
        retryButton: getConfig('BAD_GATEWAY_RETRY_BUTTON', 'Reessayer'),
        backButton: getConfig('BAD_GATEWAY_BACK_BUTTON', 'Retour'),
        footerText: getConfig('BAD_GATEWAY_FOOTER_TEXT', "Contactez l'administrateur si le probleme persiste.")
      };
    }
  },

  // Tunnels
  tunnels: {
    get baseUrl() { return String(getConfig('TUNNEL_BASE_URL', '') || '').trim().replace(/\/$/, ''); },
    get publicDomain() { return getConfig('TUNNEL_PUBLIC_DOMAIN', 'paxcia.net'); },
    get portRangeMin() { return parseInt(getConfig('TUNNEL_PORT_RANGE_MIN', '20000'), 10); },
    get portRangeMax() { return parseInt(getConfig('TUNNEL_PORT_RANGE_MAX', '29999'), 10); },
    get enrollmentCodeTtlMinutes() { return parseInt(getConfig('TUNNEL_ENROLLMENT_CODE_TTL_MINUTES', '15'), 10); }
  },

  // Rate limiting
  rateLimit: {
    get max() { return parseInt(getConfig('RATE_LIMIT_MAX', '100'), 10); },
    get timeWindow() { return parseInt(getConfig('RATE_LIMIT_TIMEWINDOW', '60000'), 10); }
  },

  // TCP/UDP proxy behavior
  tcpProxy: {
    get idleTimeoutMs() { return parseInt(getConfig('TCP_PROXY_IDLE_TIMEOUT_MS', '0'), 10); },
    get connectTimeoutMs() { return parseInt(getConfig('TCP_PROXY_CONNECT_TIMEOUT_MS', '10000'), 10); },
    get keepAliveMs() { return parseInt(getConfig('TCP_PROXY_KEEPALIVE_MS', '30000'), 10); },
    get backlog() { return parseInt(getConfig('TCP_PROXY_BACKLOG', '4096'), 10); },
    get maxConnections() { return parseInt(getConfig('TCP_PROXY_MAX_CONNECTIONS', '0'), 10); }
  },

  udpProxy: {
    get clientTimeoutMs() { return parseInt(getConfig('UDP_PROXY_CLIENT_TIMEOUT_MS', '30000'), 10); }
  },

  minecraftProxy: {
    get port() { return parseInt(getConfig('MINECRAFT_PROXY_PORT', '25565'), 10); },
    get idleTimeoutMs() { return parseInt(getConfig('MINECRAFT_PROXY_IDLE_TIMEOUT_MS', '300000'), 10); },
    get connectTimeoutMs() { return parseInt(getConfig('MINECRAFT_PROXY_CONNECT_TIMEOUT_MS', '10000'), 10); },
    get keepAliveMs() { return parseInt(getConfig('MINECRAFT_PROXY_KEEPALIVE_MS', '30000'), 10); },
    get handshakeTimeoutMs() { return parseInt(getConfig('MINECRAFT_HANDSHAKE_TIMEOUT_MS', '15000'), 10); },
    get maxPacketSize() { return parseInt(getConfig('MINECRAFT_MAX_PACKET_SIZE', '65535'), 10); },
    get backlog() { return parseInt(getConfig('MINECRAFT_PROXY_BACKLOG', '4096'), 10); },
    get maxConnections() { return parseInt(getConfig('MINECRAFT_PROXY_MAX_CONNECTIONS', '0'), 10); }
  },

  // ACME / Let's Encrypt
  acme: {
    get email() { return getConfig('ACME_EMAIL', ''); },
    get webroot() { return getConfig('ACME_WEBROOT', '/var/www/letsencrypt'); }
  },

  // SMTP Email
  smtp: {
    get host() { return getConfig('SMTP_HOST', ''); },
    get port() { return parseInt(getConfig('SMTP_PORT', '587'), 10); },
    get secure() { return getConfig('SMTP_SECURE', 'false') === 'true'; },
    get user() { return getConfig('SMTP_USER', ''); },
    get pass() { return getConfig('SMTP_PASS', ''); },
    get tlsRejectUnauthorized() { return getConfig('SMTP_TLS_REJECT_UNAUTHORIZED', 'true') === 'true'; },
    get fromName() { return getConfig('SMTP_FROM_NAME', 'NebulaProxy'); },
    get fromEmail() { return getConfig('SMTP_FROM_EMAIL', ''); }
  },

  // SMTP Proxy (TCP relay with PROXY Protocol v2)
  smtpProxy: {
    get enabled() { return getConfig('SMTP_PROXY_ENABLED', 'false') === 'true'; },
    get bindAddress() { return getConfig('SMTP_PROXY_BIND_ADDRESS', '0.0.0.0'); },

    // Backend mail server configuration
    get backendHost() { return getConfig('SMTP_PROXY_BACKEND_HOST', ''); },
    get backendPort() { return parseInt(getConfig('SMTP_PROXY_BACKEND_PORT', '25'), 10); },

    // Ports to listen on (set to 0 to disable)
    ports: {
      get smtp() { return parseInt(getConfig('SMTP_PROXY_PORT', '0'), 10) || null; },
      get submission() { return parseInt(getConfig('SMTP_PROXY_SUBMISSION_PORT', '0'), 10) || null; },
      get smtps() { return parseInt(getConfig('SMTP_PROXY_SMTPS_PORT', '0'), 10) || null; }
    },

    // Timeouts
    get idleTimeout() { return parseInt(getConfig('SMTP_PROXY_IDLE_TIMEOUT_MS', '300000'), 10); }, // 5 minutes
    get connectTimeout() { return parseInt(getConfig('SMTP_PROXY_CONNECT_TIMEOUT_MS', '10000'), 10); }, // 10 seconds

    // Logging
    logging: {
      get enabled() { return getConfig('SMTP_PROXY_LOGGING_ENABLED', 'true') === 'true'; }
    }
  },

  // Health checks and logs
  healthChecks: {
    get intervalSeconds() { return parseInt(getConfig('HEALTHCHECK_INTERVAL_SECONDS', '5'), 10); },
    get concurrency() { return parseInt(getConfig('HEALTHCHECK_CONCURRENCY', '10'), 10); },
    get timeoutMs() { return parseInt(getConfig('HEALTHCHECK_TIMEOUT_MS', '10000'), 10); },
    get cleanupEvery() { return parseInt(getConfig('HEALTHCHECK_CLEANUP_EVERY', '100'), 10); },
    get skipTcp() { return getConfig('HEALTHCHECK_SKIP_TCP', 'true') === 'true'; },
    get skipUdp() { return getConfig('HEALTHCHECK_SKIP_UDP', 'false') === 'true'; },
    get failureThreshold() { return parseInt(getConfig('HEALTHCHECK_FAILURE_THRESHOLD', '3'), 10); },
    get successThreshold() { return parseInt(getConfig('HEALTHCHECK_SUCCESS_THRESHOLD', '3'), 10); },
    get alertCooldownMinutes() { return parseInt(getConfig('HEALTHCHECK_ALERT_COOLDOWN_MINUTES', '10'), 10); }
  },

  redirections: {
    get hosts() {
      return (getConfig('REDIRECTION_HOSTS', '') || '').split(',').map((v) => v.trim()).filter(Boolean);
    }
  },

  logs: {
    get retentionDays() { return parseInt(getConfig('LOG_RETENTION_DAYS', '30'), 10); },
    get cleanupIntervalHours() { return parseInt(getConfig('LOG_CLEANUP_INTERVAL_HOURS', '24'), 10); }
  },

  // CORS
  get allowedOrigins() {
    return (getConfig('ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:3000,http://localhost:3001') || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  },

  // Redis (for JWT blacklist and rate limiting)
  redis: {
    get host() { return getConfig('REDIS_HOST', 'localhost'); },
    get port() { return parseInt(getConfig('REDIS_PORT', '6379'), 10); },
    get password() { return getConfig('REDIS_PASSWORD', ''); },
    get db() { return parseInt(getConfig('REDIS_DB', '0'), 10); }
  },

  // Security
  security: {
    get trustedProxies() {
      // SECURITY: Default to localhost/private IPs for trusted proxy headers
      // In production, set TRUSTED_PROXIES env var to specific IPs/CIDR ranges
      const defaultProxies = '127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
      return (getConfig('TRUSTED_PROXIES', defaultProxies) || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    },
    get csrfEnabled() { return getConfig('CSRF_ENABLED', 'true') !== 'false'; },
    get dnsRebindingProtection() { return getConfig('DNS_REBINDING_PROTECTION', 'true') !== 'false'; },
    get hstsEnabled() {
      const defaultValue = getConfig('NODE_ENV', 'development') === 'production' ? 'true' : 'false';
      return getConfig('HSTS_ENABLED', defaultValue) === 'true';
    },
    get hstsMaxAgeSeconds() {
      const value = parseInt(getConfig('HSTS_MAX_AGE_SECONDS', '31536000'), 10);
      return Number.isFinite(value) && value >= 0 ? value : 31536000;
    },
    get hstsIncludeSubDomains() { return getConfig('HSTS_INCLUDE_SUBDOMAINS', 'false') === 'true'; },
    get hstsPreload() { return getConfig('HSTS_PRELOAD', 'false') === 'true'; },
    get strictTokenRevocation() {
      const defaultValue = getConfig('NODE_ENV', 'development') === 'production' ? 'true' : 'false';
      return getConfig('STRICT_TOKEN_REVOCATION', defaultValue) === 'true';
    }
  },

  // Queue System for Retry Logic
  queue: {
    get enabled() { return getConfig('QUEUE_ENABLED', 'true') === 'true'; },
    get retryIntervalMinutes() { return parseInt(getConfig('QUEUE_RETRY_INTERVAL_MINUTES', '30'), 10); },
    get maxAttempts() { return parseInt(getConfig('QUEUE_MAX_ATTEMPTS', '48'), 10); },
    get jobTtlHours() { return parseInt(getConfig('QUEUE_JOB_TTL_HOURS', '24'), 10); },
    get emailRetryEnabled() { return getConfig('QUEUE_EMAIL_RETRY_ENABLED', 'true') === 'true'; },
    get discordRetryEnabled() { return getConfig('QUEUE_DISCORD_RETRY_ENABLED', 'true') === 'true'; },
    get acmeRetryEnabled() { return getConfig('QUEUE_ACME_RETRY_ENABLED', 'false') === 'true'; },
    get useExponentialBackoff() { return getConfig('QUEUE_USE_EXPONENTIAL_BACKOFF', 'false') === 'true'; },
    get dlqAlertThreshold() { return parseInt(getConfig('QUEUE_DLQ_ALERT_THRESHOLD', '10'), 10); }
  },

  // Auto-Update System
  updates: {
    get enabled() { return getConfig('AUTO_UPDATE_ENABLED', 'false') === 'true'; },
    get intervalMinutes() { return parseInt(getConfig('AUTO_UPDATE_INTERVAL_MINUTES', '30'), 10); },
    get minIntervalHours() { return parseInt(getConfig('AUTO_UPDATE_MIN_INTERVAL_HOURS', '1'), 10); },
    get notifyBeforeMinutes() { return parseInt(getConfig('AUTO_UPDATE_NOTIFY_BEFORE_MINUTES', '5'), 10); },
    get healthCheckTimeout() { return parseInt(getConfig('AUTO_UPDATE_HEALTH_CHECK_TIMEOUT_SECONDS', '60'), 10); }
  }
};
