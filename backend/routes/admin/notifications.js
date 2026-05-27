import { pool } from '../../config/database.js';
import nodemailer from 'nodemailer';
import { zabbixService } from '../../services/zabbixService.js';

/**
 * Admin Notifications Routes
 * GET  /api/admin/notifications/config         - Get notification config
 * PUT  /api/admin/notifications/config         - Update notification config
 * POST /api/admin/notifications/test/email     - Test email
 * POST /api/admin/notifications/test/zabbix    - Test Zabbix connection
 */
export async function notificationRoutes(fastify, options) {
  const DEFAULT_ZABBIX = {
    enabled: false,
    server_host: '',
    server_port: 10051,
    host_name: 'NebulaProxy',
    send_domain_alerts: true,
    send_ssl_alerts: true,
    send_resource_alerts: true,
    send_lifecycle_events: true
  };

  // Get notification configuration
  fastify.get('/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      const defaultConfig = {
        email: {
          enabled: false,
          smtp_host: '',
          smtp_port: 587,
          smtp_user: '',
          smtp_password: '',
          from_email: '',
          to_emails: ''
        },
        alerts: {
          certificate_expiry_days: 7,
          domain_down_enabled: true,
          high_cpu_threshold: 80,
          high_memory_threshold: 85,
          disk_space_threshold: 90,
          failed_backup_enabled: true
        },
        zabbix: { ...DEFAULT_ZABBIX }
      };

      const config = result.rows.length > 0
        ? JSON.parse(result.rows[0].value)
        : defaultConfig;

      const sanitizedConfig = {
        email: {
          ...defaultConfig.email,
          ...(config.email || {})
        },
        alerts: {
          ...defaultConfig.alerts,
          ...(config.alerts || {})
        },
        zabbix: {
          ...DEFAULT_ZABBIX,
          ...(config.zabbix || {})
        }
      };

      reply.send({ config: sanitizedConfig });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to fetch notification config',
        error: error.message
      });
    }
  });

  // Update notification configuration
  fastify.put('/config', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const config = request.body || {};

      const sanitizedConfig = {
        email: config.email || {
          enabled: false,
          smtp_host: '',
          smtp_port: 587,
          smtp_user: '',
          smtp_password: '',
          from_email: '',
          to_emails: ''
        },
        alerts: config.alerts || {
          certificate_expiry_days: 7,
          domain_down_enabled: true,
          high_cpu_threshold: 80,
          high_memory_threshold: 85,
          disk_space_threshold: 90,
          failed_backup_enabled: true
        },
        zabbix: {
          ...DEFAULT_ZABBIX,
          ...(config.zabbix || {})
        }
      };

      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        ['notification_config', JSON.stringify(sanitizedConfig)]
      );

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          request.user.id,
          'update_notification_config',
          'system_config',
          null,
          'Updated notification configuration',
          request.ip
        ]
      );

      reply.send({ success: true });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to update notification config',
        error: error.message
      });
    }
  });

  // Test email notification
  fastify.post('/test/email', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      if (result.rows.length === 0) {
        return reply.status(400).send({ message: 'Email not configured' });
      }

      const config = JSON.parse(result.rows[0].value);
      const emailConfig = config.email;

      if (!emailConfig.enabled) {
        return reply.status(400).send({ message: 'Email notifications are disabled' });
      }

      const smtpPort = Number(emailConfig.smtp_port) || 587;
      const smtpSettingsLog = {
        smtp_host: emailConfig.smtp_host,
        smtp_port: smtpPort,
        secure: smtpPort === 465
      };
      request.log.info(smtpSettingsLog, 'Email test: SMTP settings');
      const transporter = nodemailer.createTransport({
        host: emailConfig.smtp_host,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: emailConfig.smtp_user,
          pass: emailConfig.smtp_password
        }
      });

      await transporter.sendMail({
        from: emailConfig.from_email,
        to: emailConfig.to_emails,
        subject: 'NebulaProxy - Test Notification',
        html: `
          <h2>Test Email Notification</h2>
          <p>This is a test email from NebulaProxy notification system.</p>
          <p>If you received this email, your email configuration is working correctly.</p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            Sent at: ${new Date().toLocaleString()}<br>
            From: NebulaProxy Admin Panel
          </p>
        `
      });

      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        [
          'smtp_test_status',
          JSON.stringify({
            ok: true,
            testedAt: new Date().toISOString(),
            testedBy: request.user.id
          })
        ]
      );

      reply.send({ success: true, message: 'Test email sent successfully' });
    } catch (error) {
      request.log.error(error);

      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        [
          'smtp_test_status',
          JSON.stringify({
            ok: false,
            testedAt: new Date().toISOString(),
            error: error.message
          })
        ]
      ).catch(() => {});

      reply.status(500).send({
        message: 'Failed to send test email',
        error: error.message
      });
    }
  });

  // Test Zabbix connection
  fastify.post('/test/zabbix', {
    preHandler: [fastify.authenticate, fastify.requireAdmin]
  }, async (request, reply) => {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      const config = result.rows.length > 0
        ? JSON.parse(result.rows[0].value)
        : {};

      const zabbixConfig = { ...DEFAULT_ZABBIX, ...(config.zabbix || {}) };

      if (!zabbixConfig.server_host) {
        return reply.status(400).send({ message: 'Zabbix server host not configured' });
      }

      const response = await zabbixService.testConnection(
        zabbixConfig.server_host,
        zabbixConfig.server_port,
        zabbixConfig.host_name
      );

      reply.send({
        success: true,
        message: 'Connection to Zabbix server successful',
        response
      });
    } catch (error) {
      request.log.error(error);
      reply.status(500).send({
        message: 'Failed to connect to Zabbix server',
        error: error.message
      });
    }
  });
}

export default notificationRoutes;
