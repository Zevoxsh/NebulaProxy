/**
 * API Key Authentication Middleware
 * Handles API key extraction, validation, rate limiting, and scope verification
 */

import {
  extractApiKeyFromHeaders,
  isValidApiKeyFormat,
  verifyApiKey,
  hasRequiredScope,
  getRequiredScopes
} from '../utils/apiKey.js';
import { database } from '../services/database.js';
import { redisService } from '../services/redis.js';

/**
 * Middleware to authenticate requests using API keys
 * Sets request.user and request.apiKey if authentication succeeds
 * @param {object} request - Fastify request
 * @param {object} reply - Fastify reply
 */
export async function apiKeyAuthMiddleware(request, reply) {
  const startTime = Date.now();

  try {
    // Extract API key from headers
    const apiKey = extractApiKeyFromHeaders(request.headers);

    if (!apiKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'API key required. Provide via X-API-Key header or Authorization: Bearer header.'
      });
    }

    // Validate format
    if (!isValidApiKeyFormat(apiKey)) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key format.'
      });
    }

    // Extract prefix for database lookup
    const keyPrefix = apiKey.substring(0, 16);

    // Lookup API key in database by prefix
    const apiKeyRecord = await database.getApiKeyByPrefix(keyPrefix);

    if (!apiKeyRecord) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key.'
      });
    }

    // Verify the full key hash (timing-safe comparison)
    const isValid = await verifyApiKey(apiKey, apiKeyRecord.key_hash);

    if (!isValid) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key.'
      });
    }

    // Check if key is active
    if (!apiKeyRecord.is_active) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'API key has been revoked.'
      });
    }

    // Check expiration
    if (apiKeyRecord.expires_at) {
      const expiresAt = new Date(apiKeyRecord.expires_at);
      if (expiresAt < new Date()) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'API key has expired.'
        });
      }
    }

    // Check rate limits via Redis
    const rateLimitResult = await redisService.checkApiKeyRateLimit(
      apiKeyRecord.id,
      apiKeyRecord.rate_limit_rpm || 60,
      apiKeyRecord.rate_limit_rph || 3600
    );

    if (!rateLimitResult.allowed) {
      reply.header('Retry-After', rateLimitResult.retryAfter);
      reply.header('X-RateLimit-Limit', rateLimitResult.limitType === 'minute'
        ? apiKeyRecord.rate_limit_rpm
        : apiKeyRecord.rate_limit_rph);
      reply.header('X-RateLimit-Remaining', '0');

      return reply.status(429).send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Limit: ${rateLimitResult.limitType === 'minute'
          ? apiKeyRecord.rate_limit_rpm + ' requests per minute'
          : apiKeyRecord.rate_limit_rph + ' requests per hour'}`,
        retryAfter: rateLimitResult.retryAfter
      });
    }

    // Get required scopes for this route
    const routePath = String(request.url || '').split('?')[0];
    const requiredScopes = getRequiredScopes(request.method, routePath);

    // Parse stored scopes (PostgreSQL array stored as JSON)
    const userScopes = Array.isArray(apiKeyRecord.scopes)
      ? apiKeyRecord.scopes
      : (typeof apiKeyRecord.scopes === 'string' ? JSON.parse(apiKeyRecord.scopes) : []);

    // Deny-by-default for unmapped routes unless API key has full wildcard scope.
    if (requiredScopes.length === 0 && !userScopes.includes('*')) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Route is not allowed for scoped API keys. Use explicit route scopes or wildcard scope.'
      });
    }

    // Validate scopes for mapped routes
    if (requiredScopes.length > 0) {
      const hasScopesAccess = hasRequiredScope(userScopes, requiredScopes);

      if (!hasScopesAccess) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `Insufficient permissions. Required scopes: ${requiredScopes.join(', ')}`,
          requiredScopes,
          availableScopes: userScopes
        });
      }
    }

    // Load user context
    const user = await database.getUserById(apiKeyRecord.user_id);

    if (!user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Associated user not found.'
      });
    }

    if (!user.is_active) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Associated user account is inactive.'
      });
    }

    // Set user context on request (same as JWT auth for compatibility)
    request.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      email: user.email,
      authMethod: 'api_key' // Distinguish from JWT auth
    };

    // Store API key info for logging
    request.apiKey = {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      scopes: userScopes
    };

    // Update last_used_at asynchronously (don't block request)
    database.updateApiKeyLastUsed(apiKeyRecord.id).catch(err => {
      console.error('[API Key Auth] Failed to update last_used_at:', err.message);
    });

    // Log usage asynchronously (don't block request)
    const responseTime = Date.now() - startTime;
    database.logApiKeyUsage({
      apiKeyId: apiKeyRecord.id,
      method: request.method,
      path: request.url,
      statusCode: null, // Will be set in response hook if needed
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      responseTimeMs: responseTime
    }).catch(err => {
      console.error('[API Key Auth] Failed to log usage:', err.message);
    });

    // Continue to route handler
  } catch (error) {
    console.error('[API Key Auth] Authentication error:', error);
    return reply.status(500).send({
      error: 'Internal Server Error',
      message: 'Authentication failed due to server error.'
    });
  }
}

/**
 * Optional middleware to add API key support to existing JWT authenticate decorator
 * This allows routes to accept both JWT and API key authentication
 * @param {object} request - Fastify request
 * @param {object} reply - Fastify reply
 */
export async function dualAuthMiddleware(request, reply) {
  // Check if Authorization header contains an API key (starts with nbp_)
  const authHeader = request.headers.authorization || request.headers.Authorization;
  const hasApiKey = request.headers['x-api-key'] ||
                    (authHeader && authHeader.startsWith('Bearer nbp_'));

  if (hasApiKey) {
    // Use API key authentication
    return apiKeyAuthMiddleware(request, reply);
  } else {
    // Use JWT authentication (existing implementation)
    // This should call the existing JWT auth middleware
    // For now, we'll throw an error if JWT is required
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'JWT or API key authentication required.'
    });
  }
}
