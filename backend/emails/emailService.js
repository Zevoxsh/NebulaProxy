import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from '../config/database.js';
import { getAdminOnlyTypes, isAdminOnly as checkAdminOnly } from './notification-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Professional Email Service
 * Handles template rendering and email sending with modern HTML templates
 */
class EmailService {
  constructor() {
    this.transporter = null;
    this.baseTemplate = null;
    this.dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';
    this.supportUrl = process.env.SUPPORT_URL || 'https://support.example.com';

    // Load admin-only notification types from config
    this.adminOnlyNotifications = new Set(getAdminOnlyTypes());
  }

  /**
   * Get all admin emails
   */
  async getAdminEmails() {
    try {
      const result = await pool.query(
        `SELECT DISTINCT email, username
         FROM users
         WHERE role = 'admin'
           AND email IS NOT NULL
           AND email != ''
         ORDER BY username`
      );
      return result.rows.map(row => row.email);
    } catch (error) {
      console.error('[EmailService] Failed to get admin emails:', error);
      return [];
    }
  }

  /**
   * Check if notification type is admin-only
   */
  isAdminOnlyNotification(notificationType) {
    return checkAdminOnly(notificationType) || this.adminOnlyNotifications.has(notificationType);
  }

  /**
   * Initialize email service with SMTP configuration
   */
  async init() {
    try {
      // Get SMTP configuration from database
      const config = await this.getEmailConfig();

      if (!config || !config.email.enabled) {
        console.log('[EmailService] Email notifications disabled');
        return false;
      }

      // Create nodemailer transporter
      this.transporter = nodemailer.createTransport({
        host: config.email.smtp_host,
        port: config.email.smtp_port,
        secure: config.email.smtp_port === 465, // true for 465, false for other ports
        auth: {
          user: config.email.smtp_user,
          pass: config.email.smtp_password
        },
        tls: {
          rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false'
        }
      });

      // Verify connection
      await this.transporter.verify();
      console.log('[EmailService] SMTP connection verified');

      // Load base template
      this.baseTemplate = readFileSync(
        join(__dirname, 'partials', 'base.html'),
        'utf-8'
      );

      return true;
    } catch (error) {
      console.error('[EmailService] Initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Get email configuration from database
   */
  async getEmailConfig() {
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['notification_config']
      );

      if (result.rows.length === 0) {
        return null;
      }

      return JSON.parse(result.rows[0].value);
    } catch (error) {
      console.error('[EmailService] Failed to get email config:', error);
      return null;
    }
  }

  /**
   * Render email template with variables
   * Simple Mustache-like replacement
   */
  renderTemplate(template, variables) {
    let rendered = template;

    // Replace simple variables {{variable}}
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(regex, value || '');
    }

    // Handle conditional sections {{#key}}...{{/key}}
    rendered = rendered.replace(/{{#(\w+)}}(.*?){{\/\1}}/gs, (match, key, content) => {
      return variables[key] ? content : '';
    });

    // Handle arrays {{#key}}...{{/key}} with {{.}}
    rendered = rendered.replace(/{{#(\w+)}}(.*?){{\/\1}}/gs, (match, key, content) => {
      const value = variables[key];
      if (Array.isArray(value)) {
        return value.map(item => content.replace(/{{\.}}/g, item)).join('');
      }
      return '';
    });

    return rendered;
  }

  /**
   * Load and render email template
   */
  async loadTemplate(templateName, variables) {
    try {
      // Load content template
      const contentTemplate = readFileSync(
        join(__dirname, 'templates', `${templateName}.html`),
        'utf-8'
      );

      // Render content with variables (inject dashboardUrl if not provided)
      const contentVars = {
        dashboardUrl: this.dashboardUrl,
        supportUrl: this.supportUrl,
        ...variables
      };
      const renderedContent = this.renderTemplate(contentTemplate, contentVars);

      // Prepare base template variables
      const baseVariables = {
        title: variables.title || 'NebulaProxy Notification',
        content: renderedContent,
        dashboardUrl: this.dashboardUrl,
        supportUrl: this.supportUrl,
        year: new Date().getFullYear()
      };

      // Render base template
      const finalHtml = this.renderTemplate(this.baseTemplate, baseVariables);

      return finalHtml;
    } catch (error) {
      console.error(`[EmailService] Failed to load template ${templateName}:`, error);
      throw error;
    }
  }

  /**
   * Check if user wants to receive this type of notification
   */
  async checkUserPreferences(userId, notificationType) {
    try {
      const result = await pool.query(
        `SELECT preferences FROM user_notification_preferences WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        // No preferences set, default to all enabled
        return true;
      }

      const preferences = result.rows[0].preferences;
      return preferences[notificationType] !== false;
    } catch (error) {
      console.error('[EmailService] Failed to check user preferences:', error);
      // Default to sending if we can't check
      return true;
    }
  }

  /**
   * Send email with template
   */
  async sendEmail({ to, subject, template, variables, notificationType = 'general', userId = null, isAdminNotification = false }) {
    try {
      // Check if service is initialized
      if (!this.transporter) {
        console.warn('[EmailService] Service not initialized, attempting to initialize...');
        const initialized = await this.init();
        if (!initialized) {
          console.error('[EmailService] Cannot send email - service not initialized');
          return false;
        }
      }

      // Auto-detect if this is an admin-only notification
      if (!isAdminNotification && this.isAdminOnlyNotification(notificationType)) {
        isAdminNotification = true;
      }

      // Check user preferences if userId provided (skip for admin-only notifications)
      if (!isAdminNotification && userId && notificationType) {
        const allowed = await this.checkUserPreferences(userId, notificationType);
        if (!allowed) {
          console.log(`[EmailService] User ${userId} has disabled ${notificationType} notifications`);
          return false;
        }
      }

      // Get email config for from address
      const config = await this.getEmailConfig();
      if (!config || !config.email.enabled) {
        console.error('[EmailService] Email notifications are disabled');
        return false;
      }

      // Render template
      const html = await this.loadTemplate(template, variables);

      // Send email
      const info = await this.transporter.sendMail({
        from: `${process.env.SMTP_FROM_NAME || 'NebulaProxy'} <${config.email.from_email}>`,
        to,
        subject,
        html
      });

      console.log(`[EmailService] Email sent: ${info.messageId} to ${to}`);

      // Log email sent
      await this.logEmail({
        userId,
        to,
        subject,
        template,
        notificationType,
        messageId: info.messageId,
        status: 'sent'
      });

      return true;
    } catch (error) {
      console.error('[EmailService] Failed to send email:', error);

      // Log failed email
      if (userId) {
        await this.logEmail({
          userId,
          to,
          subject,
          template,
          notificationType,
          status: 'failed',
          error: error.message
        });
      }

      return false;
    }
  }

  /**
   * Log email activity
   */
  async logEmail({ userId, to, subject, template, notificationType, messageId, status, error }) {
    try {
      await pool.query(
        `INSERT INTO email_logs (user_id, recipient, subject, template, notification_type, message_id, status, error_message, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [userId, to, subject, template, notificationType, messageId, status, error]
      );
    } catch (err) {
      console.error('[EmailService] Failed to log email:', err);
    }
  }

  /**
   * Send new IP login alert
   */
  async sendNewIPLoginAlert(userId, userEmail, ipData, origin = null) {
    return await this.sendEmail({
      to: userEmail,
      subject: 'New sign-in detected on your account',
      template: 'new-ip-login',
      variables: {
        title: 'New Login Detected',
        timestamp: new Date().toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'medium'
        }),
        ipAddress: ipData.ip,
        location: ipData.location || 'Unknown',
        userAgent: ipData.userAgent || 'Unknown',
        dashboardUrl: origin || this.dashboardUrl
      },
      notificationType: 'security',
      userId
    });
  }

  /**
   * Send domain down alert
   */
  async sendDomainDownAlert(userId, userEmail, domainData) {
    return await this.sendEmail({
      to: userEmail,
      subject: `Domain offline: ${domainData.hostname}`,
      template: 'domain-down',
      variables: {
        title: 'Domain Down Alert',
        domainName: domainData.hostname,
        domainId: domainData.id,
        firstFailedAt: new Date(domainData.firstFailedAt).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'medium'
        }),
        downDuration: domainData.downDuration || '10+ minutes',
        lastError: domainData.lastError || 'Connection timeout',
        backendUrl: domainData.backend_url,
        dashboardUrl: this.dashboardUrl
      },
      notificationType: 'domain_alerts',
      userId
    });
  }

  /**
   * Send domain restored alert
   */
  async sendDomainRestoredAlert(userId, userEmail, domainData) {
    return await this.sendEmail({
      to: userEmail,
      subject: `Domain restored: ${domainData.hostname}`,
      template: 'domain-restored',
      variables: {
        title: 'Domain Restored',
        domainName: domainData.hostname,
        domainId: domainData.id,
        restoredAt: new Date().toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'medium'
        }),
        totalDowntime: domainData.totalDowntime || 'Unknown',
        responseTime: domainData.responseTime || 'Normal',
        dashboardUrl: this.dashboardUrl
      },
      notificationType: 'domain_alerts',
      userId
    });
  }

  /**
   * Send SSL expiring alert
   */
  async sendSSLExpiringAlert(userId, userEmail, sslData) {
    return await this.sendEmail({
      to: userEmail,
      subject: `SSL certificate expiring soon: ${sslData.domainName}`,
      template: 'ssl-expiring',
      variables: {
        title: 'SSL Certificate Expiring',
        domainName: sslData.domainName,
        domainId: sslData.domainId,
        daysRemaining: sslData.daysRemaining,
        expirationDate: new Date(sslData.expirationDate).toLocaleDateString('en-US', {
          dateStyle: 'long'
        }),
        issuedTo: sslData.issuedTo || sslData.domainName,
        issuer: sslData.issuer || 'Unknown',
        dashboardUrl: this.dashboardUrl
      },
      notificationType: 'ssl_alerts',
      userId
    });
  }

  /**
   * Send team domain down alert
   */
  async sendTeamDomainDownAlert(userId, userEmail, teamData) {
    return await this.sendEmail({
      to: userEmail,
      subject: `Team domain offline: ${teamData.domainName}`,
      template: 'team-domain-down',
      variables: {
        title: 'Team Domain Alert',
        teamName: teamData.teamName,
        teamId: teamData.teamId,
        domainName: teamData.domainName,
        domainId: teamData.domainId,
        ownerName: teamData.ownerName,
        userRole: teamData.userRole,
        downSince: new Date(teamData.downSince).toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'medium'
        }),
        lastError: teamData.lastError || 'Connection timeout',
        dashboardUrl: this.dashboardUrl
      },
      notificationType: 'team_alerts',
      userId
    });
  }

  /**
   * Send backup failed alert (ADMIN ONLY)
   */
  async sendBackupFailedAlert(backupData) {
    const adminEmails = await this.getAdminEmails();

    if (adminEmails.length === 0) {
      console.warn('[EmailService] No admin emails found for backup alert');
      return [];
    }

    const promises = adminEmails.map(email =>
      this.sendEmail({
        to: email,
        subject: '[Admin] Backup failed',
        template: 'backup-failed',
        variables: {
          title: 'Backup Failed',
          backupType: backupData.backupType || 'Scheduled',
          scheduledTime: new Date(backupData.scheduledTime).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }),
          failedAt: new Date(backupData.failedAt).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }),
          errorMessage: backupData.errorMessage,
          lastSuccessfulBackup: backupData.lastSuccessfulBackup
            ? new Date(backupData.lastSuccessfulBackup).toLocaleString('en-US', {
                dateStyle: 'medium',
                timeStyle: 'medium'
              })
            : 'Never',
          dashboardUrl: this.dashboardUrl
        },
        notificationType: 'backup_alerts',
        isAdminNotification: true
      })
    );

    return await Promise.allSettled(promises);
  }

  /**
   * Send high resources alert (ADMIN ONLY)
   */
  async sendHighResourcesAlert(resourceData) {
    const adminEmails = await this.getAdminEmails();

    if (adminEmails.length === 0) {
      console.warn('[EmailService] No admin emails found for resource alert');
      return [];
    }

    const promises = adminEmails.map(email =>
      this.sendEmail({
        to: email,
        subject: '[Admin] High resource usage detected',
        template: 'high-resources',
        variables: {
          title: 'High Resource Usage',
          timestamp: new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }),
          cpuHigh: resourceData.cpuUsage > resourceData.cpuThreshold,
          cpuUsage: resourceData.cpuUsage,
          cpuThreshold: resourceData.cpuThreshold,
          memoryHigh: resourceData.memoryUsage > resourceData.memoryThreshold,
          memoryUsage: resourceData.memoryUsage,
          memoryThreshold: resourceData.memoryThreshold,
          diskHigh: resourceData.diskUsage > resourceData.diskThreshold,
          diskUsage: resourceData.diskUsage,
          diskThreshold: resourceData.diskThreshold,
          duration: resourceData.duration || '5+ minutes',
          dashboardUrl: this.dashboardUrl
        },
        notificationType: 'high_resources',
        isAdminNotification: true
      })
    );

    return await Promise.allSettled(promises);
  }

  /**
   * Send system alert to admins (ADMIN ONLY)
   */
  async sendSystemAlert({ title, message, severity = 'warning', details = {} }) {
    const adminEmails = await this.getAdminEmails();

    if (adminEmails.length === 0) {
      console.warn('[EmailService] No admin emails found for system alert');
      return [];
    }

    // Create a simple alert using domain-down template structure (reusable)
    const promises = adminEmails.map(email =>
      this.sendEmail({
        to: email,
        subject: `[ADMIN] ${severity.toUpperCase()}: ${title}`,
        template: 'domain-down', // Reuse structure, will create dedicated later if needed
        variables: {
          title: `System Alert: ${title}`,
          domainName: 'System',
          domainId: 0,
          firstFailedAt: new Date().toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'medium'
          }),
          downDuration: details.duration || 'N/A',
          lastError: message,
          backendUrl: details.component || 'System',
          dashboardUrl: this.dashboardUrl
        },
        notificationType: 'system_alerts',
        isAdminNotification: true
      })
    );

    return await Promise.allSettled(promises);
  }
}

// Export singleton
export const emailService = new EmailService();
export default emailService;
