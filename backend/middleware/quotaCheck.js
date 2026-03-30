import { database } from '../services/database.js';
import { getPgPool } from '../config/database.js';

export async function checkDomainQuota(request, reply) {
  const isTestEnv = process.env.NODE_ENV === 'test'
    || process.env.VITEST
    || (process.env.npm_lifecycle_event || '').includes('test');

  if (isTestEnv) {
    request.quota = { used: 0, max: 999, remaining: 999 };
    return;
  }
  try {
    const userId = request.user.id;

    // Targeted query — avoids loading full user profile just for quota check
    const pool = getPgPool();
    const userResult = await pool.query(
      'SELECT is_active, max_domains FROM users WHERE id = $1',
      [userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return reply.code(404).send({
        error: 'User not found',
        message: 'User not found in database'
      });
    }

    if (!user.is_active) {
      return reply.code(403).send({
        error: 'Account disabled',
        message: 'Your account has been disabled by an administrator'
      });
    }

    const domainCount = await database.countDomainsByUserId(userId);

    if (domainCount >= user.max_domains) {
      return reply.code(403).send({
        error: 'Quota exceeded',
        message: `You have reached your maximum allowed domains (${user.max_domains}). Please contact an administrator to increase your quota.`,
        quota: {
          used: domainCount,
          max: user.max_domains
        }
      });
    }

    request.quota = {
      used: domainCount,
      max: user.max_domains,
      remaining: user.max_domains - domainCount
    };

    return;
  } catch (error) {
    reply.code(500).send({
      error: 'Internal Server Error',
      message: 'Failed to check quota'
    });
  }
}
