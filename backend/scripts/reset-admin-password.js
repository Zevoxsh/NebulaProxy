/**
 * Reset admin password script
 * Usage: node scripts/reset-admin-password.js [newPassword]
 *   or : npm run admin:reset-password [newPassword]
 *
 * If no password is provided as argument, you will be prompted interactively.
 */

import crypto from 'crypto';
import readline from 'readline';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// ── Password hashing (same algo as auth.js) ─────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

// ── DB connection from env ────────────────────────────────────────────────────
const pool = new pg.Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'nebula_proxy',
  user:     process.env.DB_USER     || 'nebula',
  password: process.env.DB_PASSWORD,
});

// ── Prompt helper ─────────────────────────────────────────────────────────────
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║    NebulaProxy — Reset Admin Password    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Get new password
  let newPassword = process.argv[2];

  if (!newPassword) {
    newPassword = await prompt('New password: ');
  }

  if (!newPassword || newPassword.length < 6) {
    console.error('✗ Password must be at least 6 characters.');
    process.exit(1);
  }

  // Check DB connection
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    console.error(`✗ Cannot connect to database: ${err.message}`);
    console.error('  → Check DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD in your .env');
    process.exit(1);
  }

  try {
    // Find admin users
    const { rows } = await client.query(
      "SELECT id, username, email FROM users WHERE role = 'admin' ORDER BY id"
    );

    if (rows.length === 0) {
      console.error("✗ No admin user found in the database.");
      process.exit(1);
    }

    // If multiple admins, show list and ask which one
    let targetUser = rows[0];
    if (rows.length > 1) {
      console.log('Multiple admin accounts found:');
      rows.forEach((u, i) => console.log(`  [${i + 1}] ${u.username} (${u.email})`));
      const choice = await prompt(`Choose admin to reset [1-${rows.length}] (default 1): `);
      const idx = parseInt(choice || '1', 10) - 1;
      if (idx < 0 || idx >= rows.length) {
        console.error('✗ Invalid choice.');
        process.exit(1);
      }
      targetUser = rows[idx];
    }

    // Hash and update
    const passwordHash = hashPassword(newPassword);
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, targetUser.id]
    );

    console.log(`✓ Password reset successfully for admin "${targetUser.username}" (${targetUser.email})`);
    console.log('');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✗ Unexpected error:', err.message);
  process.exit(1);
});
