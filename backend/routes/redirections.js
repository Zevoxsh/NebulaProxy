import { database } from '../services/database.js';
import { PermissionChecker } from '../utils/permissions.js';
import validator from 'validator';
import crypto from 'crypto';

// Helper function to check if user can access a redirection (view only)
async function canAccessRedirection(redirection, userId, isAdmin) {
  // Owner can always access
  if (redirection.user_id === userId) return true;

  // Team members can access team redirections
  if (redirection.team_id && await database.isTeamMember(redirection.team_id, userId)) return true;

  return false;
}

// Helper function to check if user can modify a redirection
async function canModifyRedirection(redirection, userId, isAdmin) {
  // Owner can always modify
  if (redirection.user_id === userId) return true;

  // For team redirections, check if user has can_manage_domains permission
  if (redirection.team_id) {
    const hasPermission = await database.hasTeamPermission(redirection.team_id, userId, 'can_manage_domains');
    return hasPermission;
  }

  return false;
}

// Generate a random short code
function generateShortCode(length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

export async function redirectionRoutes(fastify, options) {

  // List all redirections for the authenticated user
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const redirections = await database.getRedirectionsByUserIdWithTeams(userId);

      reply.send({
        success: true,
        redirections,
        count: redirections.length
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch redirections');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch redirections'
      });
    }
  });

  // Get a specific redirection
  fastify.get('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const redirection = await database.getRedirectionById(redirectionId);

      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      if (!await canAccessRedirection(redirection, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to access this redirection'
        });
      }

      reply.send({
        success: true,
        redirection
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch redirection'
      });
    }
  });

  // Create a new redirection
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['targetUrl'],
        properties: {
          shortCode: {
            type: 'string',
            minLength: 3,
            maxLength: 255
          },
          targetUrl: {
            type: 'string',
            minLength: 1,
            maxLength: 2048
          },
          description: {
            type: 'string',
            maxLength: 500
          },
          teamId: {
            type: 'integer',
            minimum: 1
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const { targetUrl, description, teamId } = request.body;
      let { shortCode } = request.body;
      const userId = request.user.id;

      // Validate target URL
      if (!validator.isURL(targetUrl, { require_protocol: true, require_tld: false })) {
        return reply.code(400).send({
          error: 'Invalid target URL',
          message: 'Target URL must be a valid URL with protocol (http:// or https://)'
        });
      }

      // Check quota
      const user = await database.getUserById(userId);
      const currentCount = await database.countRedirectionsByUserId(userId);

      if (currentCount >= user.max_redirections) {
        return reply.code(403).send({
          error: 'Quota Exceeded',
          message: `You have reached your redirection limit (${user.max_redirections})`
        });
      }

      // Generate short code if not provided
      if (!shortCode) {
        let attempts = 0;
        const maxAttempts = 10;

        do {
          shortCode = generateShortCode(8);
          const existing = await database.getRedirectionByShortCode(shortCode);
          if (!existing) break;
          attempts++;
        } while (attempts < maxAttempts);

        if (attempts >= maxAttempts) {
          return reply.code(500).send({
            error: 'Internal Server Error',
            message: 'Failed to generate unique short code'
          });
        }
      } else {
        // Validate custom short code
        if (!/^[a-zA-Z0-9_-]+$/.test(shortCode)) {
          return reply.code(400).send({
            error: 'Invalid short code',
            message: 'Short code can only contain letters, numbers, underscores, and hyphens'
          });
        }

        // Check if short code is already taken
        const existing = await database.getRedirectionByShortCode(shortCode);
        if (existing) {
          return reply.code(409).send({
            error: 'Conflict',
            message: `Short code "${shortCode}" is already taken`
          });
        }
      }

      const redirection = await database.createRedirection({
        userId,
        shortCode,
        targetUrl,
        description,
        teamId
      });

      await database.createAuditLog({
        userId,
        action: 'redirection_created',
        entityType: 'redirection',
        entityId: redirection.id,
        details: {
          short_code: shortCode,
          target_url: targetUrl
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, shortCode }, 'Redirection created');

      reply.code(201).send({
        success: true,
        redirection,
        quota: {
          used: currentCount + 1,
          limit: user.max_redirections
        }
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to create redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to create redirection'
      });
    }
  });

  // Update a redirection
  fastify.put('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      params: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: '^[0-9]+$'
          }
        },
        required: ['id']
      },
      body: {
        type: 'object',
        properties: {
          shortCode: {
            type: 'string',
            minLength: 3,
            maxLength: 255
          },
          targetUrl: {
            type: 'string',
            minLength: 1,
            maxLength: 2048
          },
          description: {
            type: 'string',
            maxLength: 500
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const { shortCode, targetUrl, description } = request.body;
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const redirection = await database.getRedirectionById(redirectionId);

      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      if (!await canModifyRedirection(redirection, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to modify this redirection'
        });
      }

      // Validate target URL if provided
      if (targetUrl && !validator.isURL(targetUrl, { require_protocol: true, require_tld: false })) {
        return reply.code(400).send({
          error: 'Invalid target URL',
          message: 'Target URL must be a valid URL with protocol (http:// or https://)'
        });
      }

      // Validate short code if provided
      if (shortCode) {
        if (!/^[a-zA-Z0-9_-]+$/.test(shortCode)) {
          return reply.code(400).send({
            error: 'Invalid short code',
            message: 'Short code can only contain letters, numbers, underscores, and hyphens'
          });
        }

        // Check if short code is already taken by another redirection
        if (shortCode !== redirection.short_code) {
          const existing = await database.getRedirectionByShortCode(shortCode);
          if (existing && existing.id !== redirectionId) {
            return reply.code(409).send({
              error: 'Conflict',
              message: `Short code "${shortCode}" is already taken`
            });
          }
        }
      }

      const updatedRedirection = await database.updateRedirection(redirectionId, {
        shortCode,
        targetUrl,
        description
      });

      await database.createAuditLog({
        userId,
        action: 'redirection_updated',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          old_short_code: redirection.short_code,
          new_short_code: shortCode,
          old_target_url: redirection.target_url,
          new_target_url: targetUrl
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, redirectionId, shortCode: updatedRedirection.short_code }, 'Redirection updated');

      reply.send({
        success: true,
        redirection: updatedRedirection
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: error.message || 'Failed to update redirection'
      });
    }
  });

  // Delete a redirection
  fastify.delete('/:id', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const redirection = await database.getRedirectionById(redirectionId);

      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      // Check if user has permission to delete this redirection
      if (!await PermissionChecker.canModifyRedirection(redirection, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to delete this redirection'
        });
      }

      await database.deleteRedirection(redirectionId);

      await database.createAuditLog({
        userId,
        action: 'redirection_deleted',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          short_code: redirection.short_code,
          target_url: redirection.target_url
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, redirectionId, shortCode: redirection.short_code }, 'Redirection deleted');

      reply.send({
        success: true,
        message: 'Redirection deleted successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to delete redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to delete redirection'
      });
    }
  });

  // Toggle redirection active status
  fastify.post('/:id/toggle', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const redirection = await database.getRedirectionById(redirectionId);

      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      if (!await canModifyRedirection(redirection, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to toggle this redirection'
        });
      }

      const updatedRedirection = await database.toggleRedirectionActive(redirectionId);

      await database.createAuditLog({
        userId,
        action: updatedRedirection.is_active ? 'redirection_enabled' : 'redirection_disabled',
        entityType: 'redirection',
        entityId: redirectionId,
        details: {
          short_code: redirection.short_code,
          is_active: updatedRedirection.is_active
        },
        ipAddress: request.ip
      });

      fastify.log.info({ username: request.user.username, redirectionId, isActive: updatedRedirection.is_active }, 'Redirection toggled');

      reply.send({
        success: true,
        redirection: updatedRedirection
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to toggle redirection');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to toggle redirection'
      });
    }
  });

  // Get redirection statistics
  fastify.get('/:id/stats', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const redirectionId = parseInt(request.params.id, 10);
      const userId = request.user.id;
      const isAdmin = request.user.role === 'admin';

      const redirection = await database.getRedirectionById(redirectionId);

      if (!redirection) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'Redirection not found'
        });
      }

      if (!await canAccessRedirection(redirection, userId, isAdmin)) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to view this redirection'
        });
      }

      const stats = await database.getRedirectionStats(redirectionId);

      reply.send({
        success: true,
        stats
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get redirection stats');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get redirection stats'
      });
    }
  });
}
