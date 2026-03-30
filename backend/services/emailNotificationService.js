import nodemailer from 'nodemailer';
import { config } from '../config/config.js';

class EmailNotificationService {
  constructor() {
    this.transporter = null;
    this.enabled = false;
    this._init();
  }

  _init() {
    const { smtp } = config;
    if (!smtp.host || !smtp.fromEmail) {
      console.log('[Email] SMTP not configured, email notifications disabled');
      return;
    }

    const transportOptions = {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure
    };

    if (smtp.user) {
      transportOptions.auth = {
        user: smtp.user,
        pass: smtp.pass
      };
    }

    this.transporter = nodemailer.createTransport(transportOptions);
    this.enabled = true;
    console.log(`[Email] SMTP ready: ${smtp.host}:${smtp.port} secure=${smtp.secure}`);
  }

  isEnabled() {
    return this.enabled;
  }

  async send(to, subject, html, options = {}) {
    if (!this.enabled) {
      console.log('[Email] Skipping send (SMTP not configured)');
      return { success: false, message: 'SMTP not configured' };
    }

    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
    if (recipients.length === 0) {
      console.log('[Email] Skipping send (no recipients)');
      return { success: false, message: 'No email recipients' };
    }

    const from = `"${config.smtp.fromName}" <${config.smtp.fromEmail}>`;

    try {
      await this.transporter.sendMail({
        from,
        to: recipients.join(', '),
        subject,
        html
      });

      console.log(`[Email] Sent: ${subject} -> ${recipients.join(', ')}`);
      return { success: true };
    } catch (error) {
      console.error(`[Email] Failed to send: ${error.message}`);

      // Queue for retry if enabled (and not already a retry from worker)
      if (config.queue.emailRetryEnabled && !options.skipRetry) {
        try {
          const { queueService } = await import('./queueService.js');
          await queueService.enqueue('email', { to: recipients, subject, html });
          console.log(`[Email] Queued for retry: ${subject}`);
        } catch (queueError) {
          console.error(`[Email] Failed to queue for retry: ${queueError.message}`);
        }
      }

      return { success: false, message: error.message };
    }
  }

  createAggregatedEmailHtml(payload) {
    const {
      status,
      previousStatus,
      backendLabel,
      proxyType,
      domains,
      consecutiveFailures,
      consecutiveSuccesses
    } = payload;

    const isUp = status === 'up';
    const statusIcon = isUp ? '[OK]' : '[DOWN]';
    const statusColor = isUp ? '#10B981' : '#EF4444';
    const statusBgGradient = isUp
      ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)'
      : 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)';
    const title = isUp ? '[OK] Service Restored' : '[WARNING] Service Incident';
    const subtitle = isUp
      ? 'Your service is back online and operational'
      : 'We detected an issue with your service';
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'short'
    });

    const domainRows = domains.map((entry, index) => {
      const responseTime = entry.checkResult?.responseTime !== undefined
        ? `${Math.round(entry.checkResult.responseTime)}ms`
        : 'N/A';
      const statusCode = entry.checkResult?.statusCode || 'N/A';
      const error = entry.checkResult?.error ? entry.checkResult.error : '';
      const domainStatus = entry.checkResult?.success ? '[OK]' : '[FAIL]';
      const rowBg = index % 2 === 0 ? '#FFFFFF' : '#F9FAFB';

      return `
        <tr style="background:${rowBg};">
          <td style="padding:16px 20px;border-bottom:1px solid #E5E7EB;">
            <div style="font-weight:600;color:#111827;font-size:14px;margin-bottom:4px;">${entry.domain.hostname}</div>
            ${error ? `<div style="color:#6B7280;font-size:12px;"><strong>Error:</strong> ${error}</div>` : ''}
          </td>
          <td style="padding:16px 20px;text-align:center;border-bottom:1px solid #E5E7EB;font-size:18px;">${domainStatus}</td>
          <td style="padding:16px 20px;text-align:center;border-bottom:1px solid #E5E7EB;">
            <span style="display:inline-block;background:${statusCode >= 200 && statusCode < 300 ? '#D1FAE5' : '#FEE2E2'};color:${statusCode >= 200 && statusCode < 300 ? '#065F46' : '#991B1B'};padding:4px 12px;border-radius:6px;font-weight:600;font-size:12px;">${statusCode}</span>
          </td>
          <td style="padding:16px 20px;text-align:right;border-bottom:1px solid #E5E7EB;color:#374151;font-weight:600;font-variant-numeric:tabular-nums;">${responseTime}</td>
        </tr>
      `;
    }).join('');

    const thresholdNote = !isUp && consecutiveFailures ?
      `<div style="margin:24px 0;padding:16px 20px;background:#FEF2F2;border-left:4px solid #EF4444;border-radius:8px;">
        <div style="font-size:14px;color:#991B1B;font-weight:600;">[WARNING] Alert triggered after ${consecutiveFailures} consecutive failures</div>
        <div style="font-size:12px;color:#DC2626;margin-top:4px;">Your service has been unreachable for multiple health checks.</div>
      </div>` :
      isUp && consecutiveSuccesses ?
      `<div style="margin:24px 0;padding:16px 20px;background:#ECFDF5;border-left:4px solid #10B981;border-radius:8px;">
        <div style="font-size:14px;color:#065F46;font-weight:600;">[OK] Service restored after ${consecutiveSuccesses} consecutive successful checks</div>
        <div style="font-size:12px;color:#059669;margin-top:4px;">Your service is now responding normally.</div>
      </div>` : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>${title}</title>
      </head>
      <body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.1);">

                <!-- Header with Gradient -->
                <tr>
                  <td style="background:${statusBgGradient};padding:40px;text-align:center;color:#FFFFFF;">
                    <div style="font-size:48px;margin-bottom:16px;">${statusIcon}</div>
                    <h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">${title}</h1>
                    <p style="margin:8px 0 0 0;font-size:16px;opacity:0.95;">${subtitle}</p>
                    <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.2);font-size:13px;opacity:0.9;">
                      📅 ${timestamp}
                    </div>
                  </td>
                </tr>

                <!-- Summary Cards -->
                <tr>
                  <td style="padding:32px 40px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="50%" style="padding-right:8px;">
                          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;text-align:center;">
                            <div style="font-size:13px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Backend</div>
                            <div style="font-size:16px;color:#111827;font-weight:700;word-break:break-all;">${backendLabel}</div>
                          </div>
                        </td>
                        <td width="50%" style="padding-left:8px;">
                          <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px;text-align:center;">
                            <div style="font-size:13px;color:#6B7280;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Protocol</div>
                            <div style="font-size:16px;color:#111827;font-weight:700;">${proxyType.toUpperCase()}</div>
                          </div>
                        </td>
                      </tr>
                    </table>

                    ${thresholdNote}

                    <!-- Affected Domains -->
                    <div style="margin-top:32px;">
                      <h2 style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:#111827;">
                        [STATUS] Affected Domains (${domains.length})
                      </h2>
                      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
                        <thead>
                          <tr style="background:linear-gradient(180deg, #F9FAFB 0%, #F3F4F6 100%);">
                            <th style="padding:14px 20px;text-align:left;color:#374151;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Domain</th>
                            <th style="padding:14px 20px;text-align:center;color:#374151;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Status</th>
                            <th style="padding:14px 20px;text-align:center;color:#374151;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Code</th>
                            <th style="padding:14px 20px;text-align:right;color:#374151;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Latency</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${domainRows}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#F9FAFB;padding:32px 40px;border-top:1px solid #E5E7EB;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="text-align:center;">
                          <div style="font-size:14px;color:#6B7280;margin-bottom:12px;">
                            <strong style="color:#111827;">NebulaProxy</strong> Monitoring System
                          </div>
                          <div style="font-size:12px;color:#9CA3AF;">
                            Automated health monitoring for your infrastructure
                          </div>
                          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #E5E7EB;">
                            <a href="https://proxy.paxcia.net" style="display:inline-block;background:#6366F1;color:#FFFFFF;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">View Dashboard</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  async sendAggregatedStatusChangeEmail(payload) {
    const isUp = payload.status === 'up';
    const statusText = isUp ? 'Service Restored' : 'Service Incident';
    const domainText = payload.domains.length === 1 ? 'domain' : 'domains';
    const subject = `[NebulaProxy] ${statusText}: ${payload.backendLabel} (${payload.domains.length} ${domainText})`;
    const html = this.createAggregatedEmailHtml(payload);
    return this.send(payload.to, subject, html);
  }

  async sendTestEmail(to) {
    const subject = '[OK] [NebulaProxy] Email Configuration Test';
    const timestamp = new Date().toLocaleString('en-US', {
      timeZone: 'UTC',
      dateStyle: 'full',
      timeStyle: 'short'
    });
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <title>Email Configuration Test</title>
      </head>
      <body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.1);">

                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg, #6366F1 0%, #4F46E5 100%);padding:40px;text-align:center;color:#FFFFFF;">
                    <div style="font-size:48px;margin-bottom:16px;">[EMAIL]</div>
                    <h1 style="margin:0;font-size:28px;font-weight:700;letter-spacing:-0.5px;">Email Test Successful!</h1>
                    <p style="margin:8px 0 0 0;font-size:16px;opacity:0.95;">Your SMTP configuration is working correctly</p>
                    <div style="margin-top:20px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.2);font-size:13px;opacity:0.9;">
                      📅 ${timestamp}
                    </div>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding:32px 40px;">
                    <div style="background:#F0F9FF;border:1px solid #BFDBFE;border-radius:12px;padding:24px;margin-bottom:24px;">
                      <div style="font-size:15px;color:#1E40AF;line-height:1.7;">
                        <strong>Congratulations!</strong> This test email confirms that your NebulaProxy instance can successfully send email notifications through your SMTP server.
                      </div>
                    </div>

                    <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:24px;">
                      <h3 style="margin:0 0 16px 0;font-size:16px;font-weight:700;color:#111827;">[OK] What's Working</h3>
                      <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;">
                        <li style="margin-bottom:8px;">SMTP connection established</li>
                        <li style="margin-bottom:8px;">Authentication successful</li>
                        <li style="margin-bottom:8px;">Email delivery confirmed</li>
                        <li>Notification system ready</li>
                      </ul>
                    </div>

                    <div style="margin-top:24px;padding:20px;background:#ECFDF5;border-left:4px solid #10B981;border-radius:8px;">
                      <div style="font-size:14px;color:#065F46;font-weight:600;margin-bottom:4px;">[SUCCESS] You're all set!</div>
                      <div style="font-size:13px;color:#059669;">You will now receive real-time alerts when your services go down or come back online.</div>
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background:#F9FAFB;padding:32px 40px;border-top:1px solid #E5E7EB;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="text-align:center;">
                          <div style="font-size:14px;color:#6B7280;margin-bottom:12px;">
                            <strong style="color:#111827;">NebulaProxy</strong> Monitoring System
                          </div>
                          <div style="font-size:12px;color:#9CA3AF;">
                            Automated health monitoring for your infrastructure
                          </div>
                          <div style="margin-top:16px;padding-top:16px;border-top:1px solid #E5E7EB;">
                            <a href="https://proxy.paxcia.net" style="display:inline-block;background:#6366F1;color:#FFFFFF;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">View Dashboard</a>
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    return this.send(to, subject, html);
  }
}

export const emailNotificationService = new EmailNotificationService();
