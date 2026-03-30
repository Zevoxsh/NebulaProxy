import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

// API Key prefix for production and test environments
const API_KEY_PREFIX_LIVE = 'nbp_live_';
const API_KEY_PREFIX_TEST = 'nbp_test_';

// Scrypt parameters (same as password hashing for consistency)
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Generate a new API key with the format: nbp_live_<64_hex_chars>
 * @param {boolean} isTest - Whether to generate a test key (nbp_test_)
 * @returns {Promise<{fullKey: string, prefix: string}>}
 */
export async function generateApiKey(isTest = false) {
    const prefix = isTest ? API_KEY_PREFIX_TEST : API_KEY_PREFIX_LIVE;
    const randomBytes = crypto.randomBytes(32); // 32 bytes = 64 hex chars
    const fullKey = prefix + randomBytes.toString('hex');

    return {
        fullKey,
        prefix: fullKey.substring(0, 16) // First 16 chars for DB lookup
    };
}

/**
 * Hash an API key using scrypt
 * @param {string} apiKey - The full API key to hash
 * @returns {Promise<string>} - The hash in format: salt:hash
 */
export async function hashApiKey(apiKey) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = await scrypt(apiKey, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
    return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify an API key against its hash (timing-safe)
 * @param {string} apiKey - The full API key to verify
 * @param {string} hash - The stored hash (format: salt:hash)
 * @returns {Promise<boolean>}
 */
export async function verifyApiKey(apiKey, hash) {
    try {
        const [salt, storedHash] = hash.split(':');
        if (!salt || !storedHash) {
            return false;
        }

        const derivedKey = await scrypt(apiKey, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
        const derivedHash = derivedKey.toString('hex');

        // Timing-safe comparison
        return crypto.timingSafeEqual(
            Buffer.from(storedHash, 'hex'),
            Buffer.from(derivedHash, 'hex')
        );
    } catch (error) {
        return false;
    }
}

/**
 * Check if a user has the required scope for a specific action
 * Supports wildcard scopes (e.g., domains:* matches domains:read, domains:write)
 * @param {string[]} userScopes - Array of scopes the user/API key has
 * @param {string[]} requiredScopes - Array of scopes required for the action
 * @returns {boolean}
 */
export function hasRequiredScope(userScopes, requiredScopes) {
    if (!Array.isArray(userScopes) || !Array.isArray(requiredScopes)) {
        return false;
    }

    // If user has wildcard scope (*), they have all permissions
    if (userScopes.includes('*')) {
        return true;
    }

    // Check each required scope
    for (const requiredScope of requiredScopes) {
        const hasScope = userScopes.some(userScope => {
            // Exact match
            if (userScope === requiredScope) {
                return true;
            }

            // Wildcard match (e.g., domains:* matches domains:read)
            if (userScope.endsWith(':*')) {
                const scopePrefix = userScope.slice(0, -1); // Remove the *
                return requiredScope.startsWith(scopePrefix);
            }

            return false;
        });

        if (!hasScope) {
            return false;
        }
    }

    return true;
}

/**
 * Validate scopes based on user role
 * Non-admin users cannot have admin-only scopes
 * @param {string[]} scopes - Array of scopes to validate
 * @param {string} userRole - User role (admin, user, viewer)
 * @returns {{valid: boolean, invalidScopes: string[]}}
 */
export function validateScopes(scopes, userRole) {
    const adminOnlyScopes = ['users:*', 'users:read', 'users:write', 'users:delete'];
    const invalidScopes = [];

    if (userRole !== 'admin') {
        for (const scope of scopes) {
            if (adminOnlyScopes.includes(scope)) {
                invalidScopes.push(scope);
            }
        }
    }

    return {
        valid: invalidScopes.length === 0,
        invalidScopes
    };
}

/**
 * Get required scopes for a specific route
 * Maps routes to their required scopes
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} path - Request path
 * @returns {string[]} - Array of required scopes
 */
export function getRequiredScopes(method, path) {
    // Normalize path
    const normalizedPath = path.replace(/\/\d+$/, '/:id'); // Replace numeric IDs with :id

    // Route to scope mapping
    const routeScopes = {
        // Domains
        'GET /api/domains': ['domains:read'],
        'POST /api/domains': ['domains:write'],
        'PUT /api/domains/:id': ['domains:write'],
        'DELETE /api/domains/:id': ['domains:delete'],

        // Teams
        'GET /api/teams': ['teams:read'],
        'POST /api/teams': ['teams:write'],
        'PUT /api/teams/:id': ['teams:write'],
        'DELETE /api/teams/:id': ['teams:delete'],

        // SSL Certificates
        'GET /api/ssl': ['ssl:read'],
        'POST /api/ssl': ['ssl:write'],
        'PUT /api/ssl/:id': ['ssl:write'],
        'DELETE /api/ssl/:id': ['ssl:delete'],

        // Backends (Load Balancing)
        'GET /api/backends': ['backends:read'],
        'POST /api/backends': ['backends:write'],
        'PUT /api/backends/:id': ['backends:write'],
        'DELETE /api/backends/:id': ['backends:delete'],

        // Monitoring
        'GET /api/monitoring': ['monitoring:read'],
        'GET /api/monitoring/health': ['monitoring:read'],
        'GET /api/monitoring/stats': ['monitoring:read'],

        // Users (Admin only)
        'GET /api/users': ['users:read'],
        'POST /api/users': ['users:write'],
        'PUT /api/users/:id': ['users:write'],
        'DELETE /api/users/:id': ['users:delete'],

        // API Keys (own keys only)
        'GET /api/api-keys': ['api-keys:read'],
        'POST /api/api-keys': ['api-keys:write'],
        'PUT /api/api-keys/:id': ['api-keys:write'],
        'DELETE /api/api-keys/:id': ['api-keys:delete'],

        // Admin routes
        'GET /api/admin/api-keys': ['users:read'], // Admin only
        'DELETE /api/admin/api-keys/:id': ['users:delete'], // Admin only
    };

    const routeKey = `${method} ${normalizedPath}`;
    return routeScopes[routeKey] || [];
}

/**
 * Check if an API key format is valid
 * @param {string} apiKey - The API key to validate
 * @returns {boolean}
 */
export function isValidApiKeyFormat(apiKey) {
    if (typeof apiKey !== 'string') {
        return false;
    }

    // Check if it starts with valid prefix
    const hasValidPrefix = apiKey.startsWith(API_KEY_PREFIX_LIVE) ||
                          apiKey.startsWith(API_KEY_PREFIX_TEST);

    if (!hasValidPrefix) {
        return false;
    }

    // Check total length (prefix + 64 hex chars)
    const expectedLength = (apiKey.startsWith(API_KEY_PREFIX_LIVE) ?
        API_KEY_PREFIX_LIVE.length : API_KEY_PREFIX_TEST.length) + 64;

    if (apiKey.length !== expectedLength) {
        return false;
    }

    // Check that the part after prefix is valid hex
    const prefix = apiKey.startsWith(API_KEY_PREFIX_LIVE) ?
        API_KEY_PREFIX_LIVE : API_KEY_PREFIX_TEST;
    const hexPart = apiKey.slice(prefix.length);

    return /^[0-9a-f]{64}$/i.test(hexPart);
}

/**
 * Extract API key from request headers
 * Supports both Authorization: Bearer and X-API-Key headers
 * @param {object} headers - Request headers
 * @returns {string|null} - The extracted API key or null
 */
export function extractApiKeyFromHeaders(headers) {
    // Check X-API-Key header first
    if (headers['x-api-key']) {
        return headers['x-api-key'];
    }

    // Check Authorization header
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        // Only return if it looks like an API key (starts with nbp_)
        if (token.startsWith('nbp_')) {
            return token;
        }
    }

    return null;
}

// Available scope definitions (for documentation)
export const AVAILABLE_SCOPES = {
    // Wildcard
    '*': 'Full access to all resources',

    // Domains
    'domains:*': 'Full access to domain management',
    'domains:read': 'Read domain information',
    'domains:write': 'Create and update domains',
    'domains:delete': 'Delete domains',

    // Teams
    'teams:*': 'Full access to team management',
    'teams:read': 'Read team information',
    'teams:write': 'Create and update teams',
    'teams:delete': 'Delete teams',

    // SSL Certificates
    'ssl:*': 'Full access to SSL certificate management',
    'ssl:read': 'Read SSL certificate information',
    'ssl:write': 'Create and update SSL certificates',
    'ssl:delete': 'Delete SSL certificates',

    // Backends
    'backends:*': 'Full access to backend/load balancer management',
    'backends:read': 'Read backend information',
    'backends:write': 'Create and update backends',
    'backends:delete': 'Delete backends',

    // Monitoring
    'monitoring:*': 'Full access to monitoring data',
    'monitoring:read': 'Read monitoring and health check data',

    // Users (Admin only)
    'users:*': 'Full access to user management (admin only)',
    'users:read': 'Read user information (admin only)',
    'users:write': 'Create and update users (admin only)',
    'users:delete': 'Delete users (admin only)',

    // API Keys
    'api-keys:*': 'Full access to own API keys',
    'api-keys:read': 'Read own API keys',
    'api-keys:write': 'Create and update own API keys',
    'api-keys:delete': 'Delete own API keys',
};
