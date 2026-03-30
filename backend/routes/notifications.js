import { database } from '../services/database.js';

export async function notificationRoutes(fastify, options) {

  // Get user's notifications
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const limit = parseInt(request.query.limit) || 50;
      const offset = parseInt(request.query.offset) || 0;

      const notifications = await database.getUserNotifications(userId, limit, offset);

      reply.send({
        success: true,
        notifications
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch notifications');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch notifications'
      });
    }
  });

  // Get unread count
  fastify.get('/count', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const count = await database.getUnreadNotificationCount(userId);

      reply.send({
        success: true,
        count
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to fetch notification count');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fetch notification count'
      });
    }
  });

  // Mark notification as read
  fastify.post('/:id/read', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const notificationId = parseInt(request.params.id, 10);
      const userId = request.user.id;

      await database.markNotificationAsRead(notificationId, userId);

      reply.send({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to mark notification as read');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to mark notification as read'
      });
    }
  });

  // Mark all as read
  fastify.post('/read-all', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;

      await database.markAllNotificationsAsRead(userId);

      reply.send({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to mark all notifications as read');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to mark all notifications as read'
      });
    }
  });
}
