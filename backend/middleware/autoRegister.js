import { database } from '../services/database.js';
import { logger } from '../utils/logger.js';

export async function autoRegisterUser(ldapUser) {
  try {
    let dbUser = await database.getUserByUsername(ldapUser.username);

    if (dbUser) {
      // Update user info from LDAP (in case displayName or email changed)
      await database.pgPool.query(
        `UPDATE users
         SET display_name = $1, email = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [ldapUser.displayName, ldapUser.email, dbUser.id]
      );

      // Refresh user data
      dbUser = await database.getUserByUsername(ldapUser.username);

      await database.updateUserLoginTime(dbUser.id);
      logger.info(`User ${ldapUser.username} logged in (existing user)`);
      return dbUser;
    }

    dbUser = await database.createUser({
      username: ldapUser.username,
      displayName: ldapUser.displayName,
      email: ldapUser.email,
      role: ldapUser.role
    });

    await database.createAuditLog({
      userId: dbUser.id,
      action: 'user_registered',
      entityType: 'user',
      entityId: dbUser.id,
      details: {
        username: dbUser.username,
        role: dbUser.role,
        source: 'ldap_auto_registration'
      }
    });

    logger.info(`User ${ldapUser.username} auto-registered (role: ${ldapUser.role})`);
    return dbUser;
  } catch (error) {
    logger.error('Error in autoRegisterUser:', error);
    throw error;
  }
}
