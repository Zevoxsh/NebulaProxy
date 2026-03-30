/**
 * API Keys Routes
 * Manage API keys for programmatic access
 */

import {
  generateApiKey,
  hashApiKey,
  validateScopes,
  AVAILABLE_SCOPES
} from '../utils/apiKey.js';
import { database } from '../services/database.js';

/**
 * Register API key routes
 * @param {object} fastify - Fastify instance
 * @param {object} opts - Options
 * @param {function} done - Callback
 */
export function apiKeysRoutes(fastify, opts, done) {
  /**
   * Create a new API key
   * POST /api/api-keys
   */
  fastify.post('/', {
    preHandler: fastify.authenticate,
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 hour'
      }
    }
  }, async (request, reply) => {
    try {
      const { name, description, scopes, expiresInDays, rateLimitRpm, rateLimitRph } = request.body;

      // Validation
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Name is required and must be a non-empty string.'
        });
      }

      if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Scopes are required and must be a non-empty array.'
        });
      }

      // Validate scopes based on user role
      const scopeValidation = validateScopes(scopes, request.user.role);
      if (!scopeValidation.valid) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `You do not have permission to assign these scopes: ${scopeValidation.invalidScopes.join(', ')}`,
          invalidScopes: scopeValidation.invalidScopes
        });
      }

      // Validate rate limits
      const rpm = rateLimitRpm || 60;
      const rph = rateLimitRph || 3600;

      if (rpm < 1 || rpm > 10000) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Rate limit per minute must be between 1 and 10000.'
        });
      }

      if (rph < 1 || rph > 100000) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Rate limit per hour must be between 1 and 100000.'
        });
      }

      // Calculate expiration
      let expiresAt = null;
      if (expiresInDays) {
        const days = parseInt(expiresInDays, 10);
        if (days < 1 || days > 365) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Expiration must be between 1 and 365 days.'
          });
        }
        expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      // Generate API key
      const { fullKey, prefix } = await generateApiKey(false); // Production key
      const keyHash = await hashApiKey(fullKey);

      // Store in database
      const apiKey = await database.createApiKey({
        userId: request.user.id,
        keyPrefix: prefix,
        keyHash,
        name: name.trim(),
        description: description?.trim() || null,
        scopes,
        rateLimitRpm: rpm,
        rateLimitRph: rph,
        expiresAt
      });

      // Log audit event
      await database.createAuditLog({
        userId: request.user.id,
        action: 'api_key_created',
        entityType: 'api_key',
        entityId: apiKey.id,
        details: {
          name: apiKey.name,
          scopes: apiKey.scopes,
          expiresAt: apiKey.expires_at
        },
        ipAddress: request.ip
      });

      // Return the full key (ONLY TIME IT'S SHOWN!)
      return reply.status(201).send({
        message: 'API key created successfully. Save this key - it will not be shown again!',
        apiKey: fullKey, // Full key returned only once
        keyInfo: {
          id: apiKey.id,
          name: apiKey.name,
          description: apiKey.description,
          scopes: apiKey.scopes,
          rateLimitRpm: apiKey.rate_limit_rpm,
          rateLimitRph: apiKey.rate_limit_rph,
          expiresAt: apiKey.expires_at,
          createdAt: apiKey.created_at
        }
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Create error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to create API key.'
      });
    }
  });

  /**
   * List all API keys for the authenticated user
   * GET /api/api-keys
   */
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const apiKeys = await database.getApiKeysByUserId(request.user.id);

      // Format response (exclude sensitive data)
      const formattedKeys = apiKeys.map(key => ({
        id: key.id,
        name: key.name,
        description: key.description,
        keyPrefix: key.key_prefix, // Show prefix for identification
        scopes: Array.isArray(key.scopes) ? key.scopes : JSON.parse(key.scopes || '[]'),
        rateLimitRpm: key.rate_limit_rpm,
        rateLimitRph: key.rate_limit_rph,
        isActive: key.is_active,
        expiresAt: key.expires_at,
        lastUsedAt: key.last_used_at,
        createdAt: key.created_at,
        updatedAt: key.updated_at
      }));

      return reply.send({
        apiKeys: formattedKeys,
        total: formattedKeys.length
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] List error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to list API keys.'
      });
    }
  });

  /**
   * Get a specific API key by ID
   * GET /api/api-keys/:id
   */
  fastify.get('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const apiKey = await database.getApiKeyById(id);

      if (!apiKey) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'API key not found.'
        });
      }

      // Check ownership
      if (apiKey.user_id !== request.user.id && request.user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this API key.'
        });
      }

      return reply.send({
        id: apiKey.id,
        name: apiKey.name,
        description: apiKey.description,
        keyPrefix: apiKey.key_prefix,
        scopes: Array.isArray(apiKey.scopes) ? apiKey.scopes : JSON.parse(apiKey.scopes || '[]'),
        rateLimitRpm: apiKey.rate_limit_rpm,
        rateLimitRph: apiKey.rate_limit_rph,
        isActive: apiKey.is_active,
        expiresAt: apiKey.expires_at,
        lastUsedAt: apiKey.last_used_at,
        createdAt: apiKey.created_at,
        updatedAt: apiKey.updated_at
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Get error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve API key.'
      });
    }
  });

  /**
   * Update an API key
   * PUT /api/api-keys/:id
   */
  fastify.put('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { name, description, scopes, rateLimitRpm, rateLimitRph, isActive, expiresInDays } = request.body;

      // Get existing key
      const existingKey = await database.getApiKeyById(id);

      if (!existingKey) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'API key not found.'
        });
      }

      // Check ownership
      if (existingKey.user_id !== request.user.id && request.user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to update this API key.'
        });
      }

      const updates = {};

      // Validate and set updates
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim().length === 0) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Name must be a non-empty string.'
          });
        }
        updates.name = name.trim();
      }

      if (description !== undefined) {
        updates.description = description?.trim() || null;
      }

      if (scopes !== undefined) {
        if (!Array.isArray(scopes) || scopes.length === 0) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Scopes must be a non-empty array.'
          });
        }

        // Validate scopes
        const scopeValidation = validateScopes(scopes, request.user.role);
        if (!scopeValidation.valid) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: `You do not have permission to assign these scopes: ${scopeValidation.invalidScopes.join(', ')}`,
            invalidScopes: scopeValidation.invalidScopes
          });
        }

        updates.scopes = scopes;
      }

      if (rateLimitRpm !== undefined) {
        const rpm = parseInt(rateLimitRpm, 10);
        if (rpm < 1 || rpm > 10000) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Rate limit per minute must be between 1 and 10000.'
          });
        }
        updates.rateLimitRpm = rpm;
      }

      if (rateLimitRph !== undefined) {
        const rph = parseInt(rateLimitRph, 10);
        if (rph < 1 || rph > 100000) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Rate limit per hour must be between 1 and 100000.'
          });
        }
        updates.rateLimitRph = rph;
      }

      if (isActive !== undefined) {
        updates.isActive = Boolean(isActive);
      }

      if (expiresInDays !== undefined) {
        if (expiresInDays === null) {
          updates.expiresAt = null;
        } else {
          const days = parseInt(expiresInDays, 10);
          if (days < 1 || days > 365) {
            return reply.status(400).send({
              error: 'Bad Request',
              message: 'Expiration must be between 1 and 365 days.'
            });
          }
          updates.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        }
      }

      // Update in database
      const updatedKey = await database.updateApiKey(id, updates);

      // Log audit event
      await database.createAuditLog({
        userId: request.user.id,
        action: 'api_key_updated',
        entityType: 'api_key',
        entityId: id,
        details: updates,
        ipAddress: request.ip
      });

      return reply.send({
        message: 'API key updated successfully.',
        apiKey: {
          id: updatedKey.id,
          name: updatedKey.name,
          description: updatedKey.description,
          keyPrefix: updatedKey.key_prefix,
          scopes: Array.isArray(updatedKey.scopes) ? updatedKey.scopes : JSON.parse(updatedKey.scopes || '[]'),
          rateLimitRpm: updatedKey.rate_limit_rpm,
          rateLimitRph: updatedKey.rate_limit_rph,
          isActive: updatedKey.is_active,
          expiresAt: updatedKey.expires_at,
          lastUsedAt: updatedKey.last_used_at,
          createdAt: updatedKey.created_at,
          updatedAt: updatedKey.updated_at
        }
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Update error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update API key.'
      });
    }
  });

  /**
   * Delete (revoke) an API key
   * DELETE /api/api-keys/:id
   */
  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { id } = request.params;

      // Get existing key
      const existingKey = await database.getApiKeyById(id);

      if (!existingKey) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'API key not found.'
        });
      }

      // Check ownership
      if (existingKey.user_id !== request.user.id && request.user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this API key.'
        });
      }

      // Delete from database
      await database.deleteApiKey(id);

      // Log audit event
      await database.createAuditLog({
        userId: request.user.id,
        action: 'api_key_deleted',
        entityType: 'api_key',
        entityId: id,
        details: {
          name: existingKey.name
        },
        ipAddress: request.ip
      });

      return reply.send({
        message: 'API key revoked successfully.'
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Delete error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete API key.'
      });
    }
  });

  /**
   * Get usage statistics for an API key
   * GET /api/api-keys/:id/usage
   */
  fastify.get('/:id/usage', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const { id } = request.params;
      const { days = 7 } = request.query;

      // Get API key
      const apiKey = await database.getApiKeyById(id);

      if (!apiKey) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'API key not found.'
        });
      }

      // Check ownership
      if (apiKey.user_id !== request.user.id && request.user.role !== 'admin') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this API key usage.'
        });
      }

      // Get usage stats
      const usageStats = await database.getApiKeyUsageStats(id, parseInt(days, 10));

      return reply.send({
        apiKeyId: id,
        apiKeyName: apiKey.name,
        period: `${days} days`,
        ...usageStats
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Usage stats error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve usage statistics.'
      });
    }
  });

  /**
   * Get available scopes (for documentation)
   * GET /api/api-keys/scopes
   */
  fastify.get('/scopes/available', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      // Filter scopes based on user role
      const availableScopes = Object.entries(AVAILABLE_SCOPES)
        .filter(([scope, description]) => {
          // Hide admin-only scopes from non-admin users
          if (request.user.role !== 'admin' && scope.startsWith('users:')) {
            return false;
          }
          return true;
        })
        .reduce((acc, [scope, description]) => {
          acc[scope] = description;
          return acc;
        }, {});

      return reply.send({
        scopes: availableScopes
      });
    } catch (error) {
      fastify.log.error({ err: error }, '[API Keys] Scopes list error');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve available scopes.'
      });
    }
  });

  done();
}
