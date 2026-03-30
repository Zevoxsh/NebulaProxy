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
  async send(notification) {
    const { title, message, severity = 'info', event = 'general' } = notification;

    this.logger.info(`Sending notification: ${title} (${severity})`);

    // Reload config to get latest settings
    await this.loadConfig();

    const promises = [];

    // Send via WebSocket (always)
    if (this.websocketManager) {
      promises.push(this.sendWebSocket(notification));
    }

    // Send via Email
    if (this.config?.email?.enabled) {
      promises.push(this.sendEmail(title, message, severity));
    }

    await Promise.allSettled(promises);
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
}

export default NotificationService;
