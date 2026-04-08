import { pool } from '../config/database.js';

const DEFAULT_PREFERENCES = {
  webhook_enabled: false,
  webhook_url: '',
  webhook_secret: '',
  domain_added_enabled: true,
  domain_deleted_enabled: true,
  domain_updated_enabled: false,
  domain_down_enabled: true,
  domain_up_enabled: true,
  backend_down_enabled: true,
  backend_up_enabled: true,
  high_response_time_enabled: true,
  high_response_time_threshold: 2000,
  ssl_expiring_enabled: true,
  ssl_expiring_days: 7,
  ssl_renewed_enabled: true,
  ssl_failed_enabled: true,
  quota_warning_enabled: true,
  quota_warning_threshold: 80,
  quota_reached_enabled: true,
  redirection_created_enabled: false,
  redirection_deleted_enabled: false,
  api_key_created_enabled: true,
  api_key_deleted_enabled: true,
  api_key_expiring_enabled: true,
  new_ip_login_enabled: true,
  account_disabled_enabled: true,
  throttle_minutes: 15,
  aggregate_similar: true
};

function normalizePreferencesRow(row) {
  if (!row) return { ...DEFAULT_PREFERENCES };

  if (Object.prototype.hasOwnProperty.call(row, 'webhook_enabled')) {
    return {
      ...DEFAULT_PREFERENCES,
      ...row
    };
  }

  const legacy = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};

  return {
    ...DEFAULT_PREFERENCES,
    webhook_enabled: legacy.webhook_enabled === true,
    webhook_url: typeof legacy.webhook_url === 'string' ? legacy.webhook_url : '',
    webhook_secret: typeof legacy.webhook_secret === 'string' ? legacy.webhook_secret : '',
    domain_added_enabled: legacy.domain_added_enabled ?? legacy.domain_alerts ?? true,
    domain_deleted_enabled: legacy.domain_deleted_enabled ?? legacy.domain_alerts ?? true,
    domain_updated_enabled: legacy.domain_updated_enabled ?? false,
    domain_down_enabled: legacy.domain_down_enabled ?? legacy.domain_alerts ?? true,
    domain_up_enabled: legacy.domain_up_enabled ?? legacy.domain_alerts ?? true,
    backend_down_enabled: legacy.backend_down_enabled ?? legacy.domain_alerts ?? true,
    backend_up_enabled: legacy.backend_up_enabled ?? legacy.domain_alerts ?? true,
    high_response_time_enabled: legacy.high_response_time_enabled ?? legacy.domain_alerts ?? true,
    high_response_time_threshold: legacy.high_response_time_threshold ?? 2000,
    ssl_expiring_enabled: legacy.ssl_expiring_enabled ?? legacy.ssl_alerts ?? true,
    ssl_expiring_days: legacy.ssl_expiring_days ?? 7,
    ssl_renewed_enabled: legacy.ssl_renewed_enabled ?? legacy.ssl_alerts ?? true,
    ssl_failed_enabled: legacy.ssl_failed_enabled ?? legacy.ssl_alerts ?? true,
    quota_warning_enabled: legacy.quota_warning_enabled ?? legacy.quota_warnings ?? true,
    quota_warning_threshold: legacy.quota_warning_threshold ?? 80,
    quota_reached_enabled: legacy.quota_reached_enabled ?? true,
    redirection_created_enabled: legacy.redirection_created_enabled ?? false,
    redirection_deleted_enabled: legacy.redirection_deleted_enabled ?? false,
    api_key_created_enabled: legacy.api_key_created_enabled ?? true,
    api_key_deleted_enabled: legacy.api_key_deleted_enabled ?? true,
    api_key_expiring_enabled: legacy.api_key_expiring_enabled ?? true,
    new_ip_login_enabled: legacy.new_ip_login_enabled ?? legacy.new_ip_login ?? true,
    account_disabled_enabled: legacy.account_disabled_enabled ?? legacy.security ?? true,
    throttle_minutes: row.throttle_minutes ?? legacy.throttle_minutes ?? 15,
    aggregate_similar: row.aggregate_similar ?? legacy.aggregate_similar ?? true
  };
}

async function getPreferenceColumns() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_notification_preferences'`
  );
  return new Set(result.rows.map((r) => r.column_name));
}

/**
 * Notification Preferences Routes
 * Manage user notification webhook preferences
 */
export async function notificationPreferencesRoutes(fastify, options) {

  // Get current user's notification preferences
  fastify.get('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;

      const result = await pool.query(
        'SELECT * FROM user_notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0) {
        // Return defaults
        return reply.send({
          success: true,
          preferences: { ...DEFAULT_PREFERENCES }
        });
      }

      reply.send({
        success: true,
        preferences: normalizePreferencesRow(result.rows[0])
      });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to get notification preferences');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to get notification preferences'
      });
    }
  });

  // Update notification preferences
  fastify.put('/', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const prefs = request.body;
      const columns = await getPreferenceColumns();

      if (!columns.has('webhook_enabled')) {
        const legacyPreferences = {
          security: prefs.account_disabled_enabled !== false,
          domain_alerts: prefs.domain_down_enabled !== false || prefs.domain_up_enabled !== false,
          ssl_alerts: prefs.ssl_expiring_enabled !== false || prefs.ssl_failed_enabled !== false,
          team_alerts: true,
          system_alerts: false,
          backup_alerts: true,
          quota_warnings: prefs.quota_warning_enabled !== false,
          password_changes: true,
          new_ip_login: prefs.new_ip_login_enabled !== false,
          webhook_enabled: prefs.webhook_enabled === true,
          webhook_url: prefs.webhook_url || '',
          webhook_secret: prefs.webhook_secret || '',
          domain_added_enabled: prefs.domain_added_enabled !== false,
          domain_deleted_enabled: prefs.domain_deleted_enabled !== false,
          domain_updated_enabled: prefs.domain_updated_enabled === true,
          domain_down_enabled: prefs.domain_down_enabled !== false,
          domain_up_enabled: prefs.domain_up_enabled !== false,
          backend_down_enabled: prefs.backend_down_enabled !== false,
          backend_up_enabled: prefs.backend_up_enabled !== false,
          high_response_time_enabled: prefs.high_response_time_enabled !== false,
          high_response_time_threshold: prefs.high_response_time_threshold ?? 2000,
          ssl_expiring_enabled: prefs.ssl_expiring_enabled !== false,
          ssl_expiring_days: prefs.ssl_expiring_days ?? 7,
          ssl_renewed_enabled: prefs.ssl_renewed_enabled !== false,
          ssl_failed_enabled: prefs.ssl_failed_enabled !== false,
          quota_warning_enabled: prefs.quota_warning_enabled !== false,
          quota_warning_threshold: prefs.quota_warning_threshold ?? 80,
          quota_reached_enabled: prefs.quota_reached_enabled !== false,
          redirection_created_enabled: prefs.redirection_created_enabled === true,
          redirection_deleted_enabled: prefs.redirection_deleted_enabled === true,
          api_key_created_enabled: prefs.api_key_created_enabled !== false,
          api_key_deleted_enabled: prefs.api_key_deleted_enabled !== false,
          api_key_expiring_enabled: prefs.api_key_expiring_enabled !== false,
          new_ip_login_enabled: prefs.new_ip_login_enabled !== false,
          account_disabled_enabled: prefs.account_disabled_enabled !== false,
          throttle_minutes: prefs.throttle_minutes ?? 15,
          aggregate_similar: prefs.aggregate_similar !== false
        };

        await pool.query(
          `INSERT INTO user_notification_preferences (user_id, preferences, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (user_id)
           DO UPDATE SET preferences = $2::jsonb, updated_at = NOW()`,
          [userId, JSON.stringify(legacyPreferences)]
        );

        return reply.send({ success: true, message: 'Preferences updated successfully' });
      }

      // Upsert preferences
      await pool.query(
        `INSERT INTO user_notification_preferences (
          user_id,
          webhook_enabled, webhook_url, webhook_secret,
          domain_added_enabled, domain_deleted_enabled, domain_updated_enabled,
          domain_down_enabled, domain_up_enabled,
          backend_down_enabled, backend_up_enabled,
          high_response_time_enabled, high_response_time_threshold,
          ssl_expiring_enabled, ssl_expiring_days, ssl_renewed_enabled, ssl_failed_enabled,
          quota_warning_enabled, quota_warning_threshold, quota_reached_enabled,
          redirection_created_enabled, redirection_deleted_enabled,
          api_key_created_enabled, api_key_deleted_enabled, api_key_expiring_enabled,
          new_ip_login_enabled, account_disabled_enabled,
          throttle_minutes, aggregate_similar,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW()
        )
        ON CONFLICT (user_id)
        DO UPDATE SET
          webhook_enabled = $2, webhook_url = $3, webhook_secret = $4,
          domain_added_enabled = $5, domain_deleted_enabled = $6, domain_updated_enabled = $7,
          domain_down_enabled = $8, domain_up_enabled = $9,
          backend_down_enabled = $10, backend_up_enabled = $11,
          high_response_time_enabled = $12, high_response_time_threshold = $13,
          ssl_expiring_enabled = $14, ssl_expiring_days = $15, ssl_renewed_enabled = $16, ssl_failed_enabled = $17,
          quota_warning_enabled = $18, quota_warning_threshold = $19, quota_reached_enabled = $20,
          redirection_created_enabled = $21, redirection_deleted_enabled = $22,
          api_key_created_enabled = $23, api_key_deleted_enabled = $24, api_key_expiring_enabled = $25,
          new_ip_login_enabled = $26, account_disabled_enabled = $27,
          throttle_minutes = $28, aggregate_similar = $29,
          updated_at = NOW()`,
        [
          userId,
          prefs.webhook_enabled === true,
          prefs.webhook_url || '',
          prefs.webhook_secret || '',
          prefs.domain_added_enabled !== false,
          prefs.domain_deleted_enabled !== false,
          prefs.domain_updated_enabled === true,
          prefs.domain_down_enabled !== false,
          prefs.domain_up_enabled !== false,
          prefs.backend_down_enabled !== false,
          prefs.backend_up_enabled !== false,
          prefs.high_response_time_enabled !== false,
          prefs.high_response_time_threshold ?? 2000,
          prefs.ssl_expiring_enabled !== false,
          prefs.ssl_expiring_days ?? 7,
          prefs.ssl_renewed_enabled !== false,
          prefs.ssl_failed_enabled !== false,
          prefs.quota_warning_enabled !== false,
          prefs.quota_warning_threshold ?? 80,
          prefs.quota_reached_enabled !== false,
          prefs.redirection_created_enabled === true,
          prefs.redirection_deleted_enabled === true,
          prefs.api_key_created_enabled !== false,
          prefs.api_key_deleted_enabled !== false,
          prefs.api_key_expiring_enabled !== false,
          prefs.new_ip_login_enabled !== false,
          prefs.account_disabled_enabled !== false,
          prefs.throttle_minutes ?? 15,
          prefs.aggregate_similar !== false
        ]
      );

      reply.send({ success: true, message: 'Preferences updated successfully' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to update notification preferences');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update notification preferences'
      });
    }
  });

  // Test webhook
  fastify.post('/test', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const columns = await getPreferenceColumns();

      if (!columns.has('webhook_url')) {
        const legacyResult = await pool.query(
          'SELECT preferences FROM user_notification_preferences WHERE user_id = $1',
          [userId]
        );

        const legacyPrefs = legacyResult.rows[0]?.preferences || {};
        const webhook_url = legacyPrefs.webhook_url || '';
        const webhook_secret = legacyPrefs.webhook_secret || '';

        if (!webhook_url) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Webhook URL not configured'
          });
        }

        const isDiscord = webhook_url.includes('discord.com') || webhook_url.includes('discordapp.com');

        let payload;
        if (isDiscord) {
          payload = {
            embeds: [{
              title: '✅ Webhook Test Successful',
              description: 'Your webhook is configured correctly and working!',
              color: 0x10B981,
              fields: [
                {
                  name: '🌌 NebulaProxy',
                  value: 'User notifications are now active.',
                  inline: false
                }
              ],
              footer: {
                text: 'NebulaProxy'
              },
              timestamp: new Date().toISOString()
            }]
          };
        } else {
          payload = {
            event: 'test',
            title: 'Test Webhook',
            description: 'This is a test webhook from NebulaProxy',
            severity: 'info',
            timestamp: new Date().toISOString()
          };
        }

        const headers = {
          'Content-Type': 'application/json',
          'User-Agent': 'NebulaProxy-User-Webhook/1.0'
        };

        if (webhook_secret && !isDiscord) {
          const crypto = await import('crypto');
          const signature = crypto.default
            .createHmac('sha256', webhook_secret)
            .update(JSON.stringify(payload))
            .digest('hex');
          headers['X-Nebula-Signature'] = signature;
        }

        const response = await fetch(webhook_url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }

        return reply.send({ success: true, message: 'Test webhook sent successfully' });
      }

      const result = await pool.query(
        'SELECT webhook_url, webhook_secret FROM user_notification_preferences WHERE user_id = $1',
        [userId]
      );

      if (result.rows.length === 0 || !result.rows[0].webhook_url) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Webhook URL not configured'
        });
      }

      const { webhook_url, webhook_secret } = result.rows[0];
      const isDiscord = webhook_url.includes('discord.com') || webhook_url.includes('discordapp.com');

      let payload;
      if (isDiscord) {
        payload = {
          embeds: [{
            title: '✅ Webhook Test Successful',
            description: 'Your webhook is configured correctly and working!',
            color: 0x10B981,
            fields: [
              {
                name: '🌌 NebulaProxy',
                value: 'User notifications are now active.',
                inline: false
              }
            ],
            footer: {
              text: 'NebulaProxy'
            },
            timestamp: new Date().toISOString()
          }]
        };
      } else {
        payload = {
          event: 'test',
          title: 'Test Webhook',
          description: 'This is a test webhook from NebulaProxy',
          severity: 'info',
          timestamp: new Date().toISOString()
        };
      }

      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'NebulaProxy-User-Webhook/1.0'
      };

      if (webhook_secret && !isDiscord) {
        const crypto = await import('crypto');
        const signature = crypto.default
          .createHmac('sha256', webhook_secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Nebula-Signature'] = signature;
      }

      const response = await fetch(webhook_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      reply.send({ success: true, message: 'Test webhook sent successfully' });
    } catch (error) {
      fastify.log.error({ error }, 'Failed to send test webhook');
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to send test webhook',
        details: error.message
      });
    }
  });
}

export default notificationPreferencesRoutes;
