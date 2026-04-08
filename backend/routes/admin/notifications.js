import { pool } from '../../config/database.js';
import nodemailer from 'nodemailer';

/**
 * Admin Notifications Routes
 * GET /api/admin/notifications/config - Get notification config
 * PUT /api/admin/notifications/config - Update notification config
 * POST /api/admin/notifications/test/:type - Test notification
 */
export async function notificationRoutes(fastify, options) {
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
        }
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

      // Admin webhook is deprecated: keep only email + alerts in admin notification config.
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
        }
      };

      // Upsert configuration
      await pool.query(
        `INSERT INTO system_config (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET value = $2, updated_at = NOW()`,
        ['notification_config', JSON.stringify(sanitizedConfig)]
      );

      // Audit log
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
      // Get email config
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

      // Create transporter
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

      // Send test email
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

      // Mark SMTP as tested and valid for features that require reliable email delivery (e.g. 2FA email)
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

      // Keep explicit failure state to avoid enabling email-based 2FA on broken SMTP
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

}

export default notificationRoutes;
