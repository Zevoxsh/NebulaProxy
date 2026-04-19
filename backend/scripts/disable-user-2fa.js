/**
 * Disable all 2FA methods for a user (email + TOTP).
 *
 * Usage:
 *   node scripts/disable-user-2fa.js <username-or-email>
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const identifier = (process.argv[2] || '').trim();

if (!identifier) {
  console.error('Usage: node scripts/disable-user-2fa.js <username-or-email>');
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'nebulaproxy',
  user: process.env.DB_USER || 'nebulaproxy',
  password: process.env.DB_PASSWORD,
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT id, username, email FROM users WHERE username = $1 OR email = $1 LIMIT 1',
      [identifier]
    );

    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.error(`No user found for: ${identifier}`);
      process.exit(1);
    }

    const user = userResult.rows[0];

    await client.query(
      `UPDATE user_two_factor_methods
       SET enabled = FALSE,
           totp_secret = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [user.id]
    );

    await client.query(
      `UPDATE users
       SET two_factor_enabled = FALSE,
           two_factor_method = NULL,
           two_factor_totp_secret = NULL,
           two_factor_enabled_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    await client.query('COMMIT');

    console.log(`2FA disabled for user: ${user.username} (${user.email || 'no-email'})`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to disable 2FA:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error('Unexpected error:', error.message);
  await pool.end();
  process.exit(1);
});
