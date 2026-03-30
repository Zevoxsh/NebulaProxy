# 📧 NebulaProxy Email Notification System

Professional email notification system with modern HTML templates and comprehensive user preferences.

## 🎨 Templates Available

### Security Alerts
- **new-ip-login** - Alert when user logs in from unknown IP
- **password-changed** - Confirmation after password change

### Domain Monitoring
- **domain-down** - Alert when domain is down >10 minutes
- **domain-restored** - Confirmation when domain is back online
- **ssl-expiring** - Alert when SSL certificate expires soon (7d, 3d, 1d)

### Team Notifications
- **team-domain-down** - Alert team members when team domain is down
- **team-invitation** - Invitation to join a team

### System Alerts
- **backup-failed** - Alert admins when backup fails
- **high-resources** - Alert when CPU/RAM/Disk usage is high
- **quota-warning** - Warn user when approaching quota limit

## 📁 Structure

```
emails/
├── partials/
│   └── base.html          # Base HTML template with modern design
├── templates/
│   ├── new-ip-login.html
│   ├── domain-down.html
│   ├── domain-restored.html
│   ├── ssl-expiring.html
│   ├── team-domain-down.html
│   ├── team-invitation.html
│   ├── backup-failed.html
│   ├── quota-warning.html
│   ├── password-changed.html
│   └── high-resources.html
├── emailService.js        # Main email service
└── README.md             # This file
```

## 🚀 Usage

### Initialize the service

```javascript
import { emailService } from './emails/emailService.js';

// Initialize with SMTP config from database
await emailService.init();
```

### Send a notification

```javascript
// Send new IP login alert
await emailService.sendNewIPLoginAlert(userId, userEmail, {
  ip: '1.2.3.4',
  location: 'Paris, France',
  userAgent: 'Mozilla/5.0...'
});

// Send domain down alert
await emailService.sendDomainDownAlert(userId, userEmail, {
  hostname: 'example.com',
  id: 123,
  firstFailedAt: new Date(),
  downDuration: '15 minutes',
  lastError: 'Connection timeout',
  backend_url: 'http://backend:3000'
});

// Send SSL expiring alert
await emailService.sendSSLExpiringAlert(userId, userEmail, {
  domainName: 'example.com',
  domainId: 123,
  daysRemaining: 7,
  expirationDate: new Date('2026-02-11'),
  issuer: "Let's Encrypt"
});
```

### Custom email with template

```javascript
await emailService.sendEmail({
  to: 'user@example.com',
  subject: 'Custom Alert',
  template: 'domain-down',
  variables: {
    domainName: 'example.com',
    // ... other variables
  },
  notificationType: 'domain_alerts',
  userId: 123
});
```

## ⚙️ User Preferences

Users can control which notifications they receive:

```sql
-- Get user preferences
SELECT preferences FROM user_notification_preferences WHERE user_id = 123;

-- Update preferences
UPDATE user_notification_preferences
SET preferences = jsonb_set(preferences, '{domain_alerts}', 'false')
WHERE user_id = 123;
```

### Available Preference Keys

- `security` - Security-related alerts (new IP, password changes)
- `domain_alerts` - Domain up/down notifications
- `ssl_alerts` - SSL certificate expiration warnings
- `team_alerts` - Team-related notifications
- `system_alerts` - System-wide alerts (for admins)
- `backup_alerts` - Backup failure notifications
- `quota_warnings` - Quota limit warnings
- `password_changes` - Password change confirmations
- `new_ip_login` - New IP login alerts

## 🔒 Security Features

### IP Tracking
- Automatic tracking of login IPs
- Alert on first login from new IP
- Auto-trust after multiple logins
- GeoIP location enrichment (optional)

### 10-Minute Rule for Domain Downs
Domain down alerts are only sent after **10 consecutive minutes** of downtime to avoid false positives from temporary network issues.

```sql
-- Check domain health
SELECT *
FROM domain_health_tracking
WHERE domain_id = 123
  AND status = 'down'
  AND first_failed_at < NOW() - INTERVAL '10 minutes'
  AND down_alert_sent = false;
```

## 📊 Email Logs

All emails are logged for audit purposes:

```sql
-- View recent emails
SELECT *
FROM email_logs
ORDER BY sent_at DESC
LIMIT 50;

-- Check delivery status
SELECT
  notification_type,
  status,
  COUNT(*) as count
FROM email_logs
GROUP BY notification_type, status;
```

## 🎨 Template Customization

### Variables

Templates use Mustache-like syntax:

```html
<!-- Simple variable -->
<p>Hello {{userName}}!</p>

<!-- Conditional section -->
{{#isPremium}}
<div class="premium-badge">Premium User</div>
{{/isPremium}}

<!-- Array iteration -->
{{#items}}
<li>{{.}}</li>
{{/items}}
```

### Styling

The base template uses a modern dark theme with:
- Responsive design
- Dark mode optimized colors
- Professional gradient headers
- Color-coded alert boxes
- Mobile-friendly layout

## 🔄 Notification Queue

For reliable delivery, notifications can be queued:

```javascript
// Add to queue
await pool.query(`
  INSERT INTO notification_queue (user_id, notification_type, data, priority)
  VALUES ($1, $2, $3, $4)
`, [userId, 'domain_down', { domainId: 123 }, 1]);
```

Queue processor (to be implemented):
- Retry failed notifications
- Batch processing
- Rate limiting
- Priority ordering

## 📝 Migration

Run the migration to create required tables:

```bash
# Apply migration
psql -U nebula -d nebula_proxy -f migrations/018_notification_system.sql
```

## 🔮 Future Enhancements

- [ ] Slack/Discord webhook integration
- [ ] SMS notifications via Twilio
- [ ] In-app notifications
- [ ] Digest emails (daily/weekly summaries)
- [ ] Email verification
- [ ] Unsubscribe links
- [ ] A/B testing for templates
- [ ] Click tracking
- [ ] Read receipts

## 🛠️ Troubleshooting

### Emails not sending

1. Check SMTP configuration in database
2. Verify email service is initialized
3. Check email logs for errors
4. Test SMTP connection with verification

### Templates not rendering

1. Ensure template file exists in `templates/` directory
2. Check variable names match template placeholders
3. Verify base template is loaded

### Users not receiving alerts

1. Check user notification preferences
2. Verify email is correct in database
3. Check email logs for delivery status
4. Ensure notification type is enabled in preferences

## 📄 License

Part of NebulaProxy - Professional Reverse Proxy Management System
