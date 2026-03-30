import { database } from '../services/database.js';
import { emailService } from '../emails/emailService.js';

export async function settingsRoutes(fastify, options) {
  // ===== NOTIFICATION SETTINGS =====

  // Get notification settings
  fastify.get('/notifications', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        let settings = await database.getNotificationSettings(userId);

        if (!settings) {
          settings = {
            notifications_enabled: false,
            email_enabled: false
          };
        }

        return {
          settings: {
            notificationsEnabled: Boolean(settings.notifications_enabled),
            emailEnabled: Boolean(settings.email_enabled)
          }
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting notification settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Update notification settings
  fastify.put('/notifications', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          emailEnabled: {
            type: 'boolean'
          },
          notificationsEnabled: {
            type: 'boolean'
          }
        },
        additionalProperties: false
      }
    },
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const { notificationsEnabled, emailEnabled } = request.body;

        const updated = await database.upsertNotificationSettings(userId, {
          notificationsEnabled: notificationsEnabled || false,
          emailEnabled: emailEnabled || false
        });

        return {
          success: true,
          settings: {
            notificationsEnabled: Boolean(updated.notifications_enabled),
            emailEnabled: Boolean(updated.email_enabled)
          },
          message: 'Notification settings updated successfully'
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error updating notification settings');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Test email notification
  fastify.post('/notifications/test-email', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const user = await database.getUserById(request.user.id);
        const email = user?.email;

        if (!email) {
          return reply.code(400).send({
            error: 'No email address set. Please update your profile email first.'
          });
        }

        await emailService.init();
        const origin = request.headers.origin ||
          (request.headers.host
            ? `${request.protocol || 'https'}://${request.headers.host}`
            : null);
        const sent = await emailService.sendNewIPLoginAlert(user.id, email, {
          ip: request.ip || '127.0.0.1',
          location: 'Test Location',
          userAgent: 'NebulaProxy Test'
        }, origin);

        if (sent) {
          return { success: true, message: `Test email sent to ${email}.` };
        }
        return reply.code(400).send({ error: 'SMTP is not configured or not enabled. Set it up in the admin panel.' });
      } catch (error) {
        fastify.log.error({ error }, 'Error sending test email');
        return reply.code(500).send({
          error: `Failed to send test email: ${error.message || 'Unknown error'}`
        });
      }
    }
  });
}
