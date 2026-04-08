import nodemailer from 'nodemailer';
import { pool } from '../config/database.js';

class NotificationService {
  constructor(logger, websocketManager) {
    this.logger = logger;
    this.websocketManager = websocketManager;
    this.config = null;
  }

  async initialize() {
    await this.loadConfig();
    this.logger.info('Notification service initialized');
  }

  async loadConfig() {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      if (result.rows.length > 0) {
        this.config = JSON.parse(result.rows[0].value);
      }
    } catch (error) {
      this.logger.error('Failed to load notification config:', error);
    }
  }

  /**
   * Send notification via all enabled channels
   */
  async send(notification, options = {}) {
    const { title, message, severity = 'info', event = 'general' } = notification;
    const {
      channels = null,
      reloadConfig = true
    } = options;

    this.logger.info(`Sending notification: ${title} (${severity})`);

    // Reload config to get latest settings
    if (reloadConfig) {
      await this.loadConfig();
    }

    const promises = [];
    const channelSet = Array.isArray(channels) ? new Set(channels) : null;

    // Send via WebSocket (always)
    if ((!channelSet || channelSet.has('websocket')) && this.websocketManager) {
      promises.push(this.sendWebSocket(notification));
    }

    // Send via Email
    if ((!channelSet || channelSet.has('email')) && this.config?.email?.enabled) {
      promises.push(this.sendEmail(title, message, severity));
    }

    if ((!channelSet || channelSet.has('webhook')) && this.config?.webhook?.enabled && this.config?.webhook?.url) {
      promises.push(this.sendWebhook(notification));
    }

    await Promise.allSettled(promises);
  }

  isDiscordWebhookUrl(url) {
    return typeof url === 'string'
      && (url.includes('discord.com/api/webhooks/') || url.includes('discordapp.com/api/webhooks/'));
  }

  buildWebhookPayload(notification) {
    const { title, message, severity = 'info', event = 'general', metadata = {} } = notification;
    const webhookUrl = this.config?.webhook?.url || '';
    const isDiscord = this.isDiscordWebhookUrl(webhookUrl);

    if (isDiscord) {
      const colors = {
        error: 0xef4444,
        warning: 0xf59e0b,
        success: 0x10b981,
        info: 0x3b82f6
      };

      const fields = [
        { name: 'Event', value: event || 'general', inline: true },
        { name: 'Severity', value: severity, inline: true }
      ];

      if (metadata && typeof metadata === 'object') {
        for (const [key, value] of Object.entries(metadata)) {
          fields.push({
            name: String(key).slice(0, 256),
            value: String(value).slice(0, 1024),
            inline: true
          });
        }
      }

      return {
        embeds: [{
          title,
          description: message,
          color: colors[severity] || colors.info,
          fields,
          footer: { text: 'NebulaProxy' },
          timestamp: new Date().toISOString()
        }]
      };
    }

    return {
      event,
      title,
      message,
      severity,
      metadata,
      timestamp: new Date().toISOString()
    };
  }

  async sendWebhook(notification, options = {}) {
    try {
      const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10000;
      const webhookConfig = this.config?.webhook;
      if (!webhookConfig?.enabled || !webhookConfig?.url) {
        return;
      }

      const payload = this.buildWebhookPayload(notification);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'NebulaProxy-Webhook/1.0'
      };

      const isDiscord = this.isDiscordWebhookUrl(webhookConfig.url);

      if (webhookConfig.secret && !isDiscord) {
        const crypto = await import('crypto');
        headers['X-Nebula-Signature'] = crypto
          .createHmac('sha256', webhookConfig.secret)
          .update(JSON.stringify(payload))
          .digest('hex');
      }

      const response = await fetch(webhookConfig.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      this.logger.info('Webhook notification sent');
    } catch (error) {
      this.logger.error('Failed to send webhook notification:', error);
    }
  }

  /**
   * Send notification via WebSocket
   */
  async sendWebSocket(notification) {
    try {
      this.websocketManager.broadcast({
        title: notification.title,
        message: notification.message,
        severity: notification.severity || 'info',
        event: notification.event,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to send WebSocket notification:', error);
    }
  }

  /**
   * Send notification via Email
   */
  async sendEmail(title, message, severity) {
    try {
      const emailConfig = this.config.email;

      const smtpPort = Number(emailConfig.smtp_port) || 587;
      const transporter = nodemailer.createTransport({
        host: emailConfig.smtp_host,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: emailConfig.smtp_user,
          pass: emailConfig.smtp_password
        }
      });

      const severityColors = {
        error: '#ef4444',
        warning: '#f59e0b',
        success: '#10b981',
        info: '#3b82f6'
      };

      const color = severityColors[severity] || severityColors.info;

      await transporter.sendMail({
        from: emailConfig.from_email,
        to: emailConfig.to_emails,
        subject: `[${severity.toUpperCase()}] ${title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">${title}</h2>
            </div>
            <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 15px 0; color: #374151; font-size: 16px;">${message}</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                Sent at: ${new Date().toLocaleString()}<br>
                From: NebulaProxy Monitoring System
              </p>
            </div>
          </div>
        `
      });

      this.logger.info('Email notification sent');
    } catch (error) {
      this.logger.error('Failed to send email notification:', error);
    }
  }

  /**
   * Send SSL certificate expiry alert
   */
  async sendCertificateExpiryAlert(domain, daysUntilExpiry) {
    await this.send({
      title: 'SSL Certificate Expiring Soon',
      message: `SSL certificate for ${domain} will expire in ${daysUntilExpiry} days`,
      severity: daysUntilExpiry <= 3 ? 'error' : 'warning',
      event: 'certificate_expiry',
      metadata: { domain, daysUntilExpiry }
    });
  }

  /**
   * Send domain down alert
   */
  async sendDomainDownAlert(domain, error) {
    await this.send({
      title: 'Domain Health Check Failed',
      message: `Domain ${domain} is down or unreachable: ${error}`,
      severity: 'error',
      event: 'domain_down',
      metadata: { domain, error }
    });
  }

  /**
   * Send high resource usage alert
   */
  async sendResourceAlert(type, value, threshold) {
    await this.send({
      title: `High ${type.toUpperCase()} Usage`,
      message: `${type.toUpperCase()} usage is at ${value}% (threshold: ${threshold}%)`,
      severity: value >= 90 ? 'error' : 'warning',
      event: 'resource_alert',
      metadata: { type, value, threshold }
    });
  }

  /**
   * Send proxy lifecycle notification (startup, shutdown, maintenance)
   */
  async sendProxyLifecycleNotification(state, metadata = {}, options = {}) {
    const normalizedState = String(state || '').toLowerCase();
    const isFastShutdown = options.fastShutdown === true;

    const sendLifecycle = async (notificationPayload) => {
      if (!isFastShutdown) {
        await this.send(notificationPayload);
        return;
      }

      await this.send({
        ...notificationPayload,
        metadata: {
          ...(notificationPayload.metadata || {}),
          fast_shutdown: true
        }
      }, {
        channels: ['webhook'],
        reloadConfig: false
      });
    };

    if (normalizedState === 'started' || normalizedState === 'startup' || normalizedState === 'online') {
      await sendLifecycle({
        title: 'Proxy redémarré',
        message: 'Le proxy est de nouveau en ligne après redémarrage ou maintenance.',
        severity: 'success',
        event: 'proxy_startup',
        metadata
      });
      return;
    }

    if (normalizedState === 'stopping' || normalizedState === 'stopped' || normalizedState === 'shutdown') {
      await sendLifecycle({
        title: 'Proxy arrêté / mise en maintenance',
        message: 'Le proxy passe hors ligne pour un arrêt, un redémarrage ou une maintenance planifiée.',
        severity: 'warning',
        event: 'proxy_shutdown',
        metadata
      });
      return;
    }

    if (normalizedState === 'maintenance-start' || normalizedState === 'maintenance_started') {
      await sendLifecycle({
        title: 'Maintenance du proxy démarrée',
        message: 'Le proxy passe en mode maintenance pour les tests ou interventions planifiées.',
        severity: 'warning',
        event: 'proxy_maintenance',
        metadata: { ...metadata, phase: 'start' }
      });
      return;
    }

    if (normalizedState === 'maintenance-end' || normalizedState === 'maintenance_ended') {
      await sendLifecycle({
        title: 'Maintenance du proxy terminée',
        message: 'Le proxy est à nouveau disponible après la maintenance.',
        severity: 'success',
        event: 'proxy_maintenance',
        metadata: { ...metadata, phase: 'end' }
      });
    }
  }
}

export default NotificationService;
