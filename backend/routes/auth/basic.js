// @ts-check
import { ldapAuth } from '../../services/ldap.js';
import { config } from '../../config/config.js';
import { autoRegisterUser } from '../../middleware/autoRegister.js';
import { database } from '../../services/database.js';
import { redisService } from '../../services/redis.js';
import { pool } from '../../config/database.js';
import {
  hashPassword,
  verifyPassword,
  isDefaultBootstrapAdminUser,
  isBootstrapAdminIdentity,
  createPendingTwoFactorToken,
  getTwoFactorEmailMask,
  getUserTwoFactorMethods,
  sendAuthSuccess
} from './helpers.js';

export async function basicRoutes(fastify, _options) {
  // Builds the 2FA-gate closure for a given request/reply. Returns true (and
  // sends the pending-2FA response) when the user has 2FA and the caller must
  // stop; false when login can proceed.
  const makeHandleTwoFactorIfNeeded = (request, reply) => async (dbUser) => {
    const methodConfigs = await getUserTwoFactorMethods(dbUser.id, dbUser);
    const methods = methodConfigs.map((m) => m.method);
    if (methods.length === 0) return false;

    if (!dbUser.email) {
      reply.code(400).send({
        success: false,
        error: 'Email required',
        message: 'Two-factor authentication requires an email address on your account.'
      });
      return true;
    }

    const pendingToken = createPendingTwoFactorToken(
      fastify,
      dbUser,
      methods,
      { bootstrapPasswordChangeRequired: isDefaultBootstrapAdminUser(dbUser) }
    );
    reply.send({
      success: true,
      requires2fa: true,
      methods,
      defaultMethod: methods.includes('totp') ? 'totp' : methods[0],
      pendingToken,
      email: methods.includes('email') ? getTwoFactorEmailMask(dbUser.email) : undefined
    });
    return true;
  };

  // Local username/password login, shared by the normal /login handler (when
  // auth mode is 'local') and the break-glass /login/local endpoint (any mode,
  // admins only). Sends the reply itself; returns nothing.
  const doLocalPasswordLogin = async (request, reply, { username, password, requireAdmin = false, breakGlass = false }) => {
    const handleTwoFactorIfNeeded = makeHandleTwoFactorIfNeeded(request, reply);
    const dbUser = await database.getUserByUsername(username);

    // Uniform 401 whether the user is missing, has no local password, or (for
    // break-glass) isn't an admin — never reveal which, and never let a
    // password-less SSO/LDAP account be broken into via this path.
    if (!dbUser || !dbUser.password_hash || (requireAdmin && dbUser.role !== 'admin')) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    const requiresBootstrapPasswordChange = isDefaultBootstrapAdminUser(dbUser);
    const allowDisabledBootstrapLogin = isBootstrapAdminIdentity(dbUser);

    if (dbUser.is_active === false && !allowDisabledBootstrapLogin) {
      return reply.code(403).send({
        success: false,
        error: 'Account disabled',
        message: 'Your account is disabled'
      });
    }

    if (!verifyPassword(password, dbUser.password_hash)) {
      return reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }

    if (dbUser.is_active === false && allowDisabledBootstrapLogin) {
      await pool.query(
        `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
        [dbUser.id]
      );
      dbUser.is_active = true;
    }

    if (await handleTwoFactorIfNeeded(dbUser)) {
      return;
    }

    await database.updateUserLoginTime(dbUser.id);
    sendAuthSuccess(request, reply, dbUser, {
      tokenClaims: { bootstrapPasswordChangeRequired: requiresBootstrapPasswordChange },
      responseData: { mustChangePassword: requiresBootstrapPasswordChange }
    });
    if (breakGlass) {
      fastify.log.warn({ username: dbUser.username, role: dbUser.role, ip: request.ip }, 'Break-glass local admin login used (SSO bypass)');
    } else {
      fastify.log.info({ username: dbUser.username, role: dbUser.role }, 'User logged in (local)');
    }
  };

  // Auth mode endpoint. The login page's form genuinely differs by mode
  // (username/password vs a single SSO redirect button), so the frontend
  // needs the real mode here — unlike most config, this isn't meaningfully
  // sensitive to disclose (a working SSO button already reveals "this app
  // uses SSO" to anyone looking at the page).
  fastify.get('/mode', async (request, reply) => {
    let registrationEnabled = false;

    if (config.auth.mode === 'local') {
      try {
        const result = await pool.query(
          'SELECT value FROM system_config WHERE key = $1',
          ['registration_enabled']
        );
        registrationEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;
      } catch (error) {
        fastify.log.error({ error }, 'Failed to check registration config');
        registrationEnabled = true; // Default to enabled if check fails
      }
    }

    // Don't expose internal auth configuration
    reply.send({
      registrationEnabled,
      // Only reveal this for legitimate use case (login form behavior)
      authType: config.auth.mode
    });
  });

  // SECURITY: Explicitly block GET on login endpoint
  fastify.get('/login', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Login must use POST method'
    });
  });

  // Login endpoint
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9._@-]+$'
          },
          password: {
            type: 'string',
            minLength: 1,
            maxLength: 1024
          }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;

    try {
      fastify.log.info({ username }, 'Login request received');
      if (config.auth.mode === 'local') {
        return await doLocalPasswordLogin(request, reply, { username, password });
      }

      if (config.auth.mode === 'oidc') {
        return reply.code(400).send({
          success: false,
          error: 'Password login disabled',
          message: 'Sign in via SSO instead.'
        });
      }

      const handleTwoFactorIfNeeded = makeHandleTwoFactorIfNeeded(request, reply);
      const ldapUser = await ldapAuth.authenticate(username, password);
      const dbUser = await autoRegisterUser(ldapUser);

      if (await handleTwoFactorIfNeeded(dbUser)) {
        return;
      }

      await database.updateUserLoginTime(dbUser.id);
      sendAuthSuccess(request, reply, dbUser, {
        tokenClaims: { bootstrapPasswordChangeRequired: false },
        responseData: {
          mustChangePassword: false
        }
      });
      fastify.log.info({ username: dbUser.username, role: dbUser.role }, 'User logged in (ldap)');
    } catch (error) {
      fastify.log.error({ error, username }, 'Login failed');

      reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }
  });

  // Break-glass local admin login — a deliberate SSO/LDAP bypass for admins
  // who hold a local password, so a locked-out admin can still get in when the
  // identity provider is unreachable (e.g. the Authentik box or its tunnel is
  // down). Works in ANY auth mode. Gated hard: local password_hash required
  // AND role must be 'admin'; 2FA, disabled-account and bootstrap-change
  // checks all still apply; same 5/min rate limit; every use is logged at warn.
  // Not discoverable from the normal UI (revealed by a hidden gesture on the
  // login page) — but the real protection is the credentials, not obscurity.
  fastify.post('/login/local', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[a-zA-Z0-9._@-]+$' },
          password: { type: 'string', minLength: 1, maxLength: 1024 }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;
    try {
      return await doLocalPasswordLogin(request, reply, { username, password, requireAdmin: true, breakGlass: true });
    } catch (error) {
      fastify.log.error({ error, username }, 'Break-glass local login failed');
      return reply.code(401).send({
        success: false,
        error: 'Authentication failed',
        message: 'Invalid credentials'
      });
    }
  });

  // SECURITY: Explicitly block GET on register endpoint
  fastify.get('/register', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Register must use POST method'
    });
  });

  // Register endpoint (local auth only)
  fastify.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9._@-]+$'
          },
          displayName: {
            type: 'string',
            minLength: 1,
            maxLength: 255
          },
          email: {
            type: 'string',
            maxLength: 255
          },
          password: {
            type: 'string',
            minLength: 8,
            maxLength: 1024
          }
        },
        additionalProperties: false
      }
    },
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    if (config.auth.mode !== 'local') {
      return reply.code(400).send({
        success: false,
        error: 'Registration disabled',
        message: 'Local registration is disabled'
      });
    }

    // Check if registration is enabled in config
    try {
      const result = await pool.query(
        'SELECT value FROM system_config WHERE key = $1',
        ['registration_enabled']
      );
      const registrationEnabled = result.rows.length > 0 ? result.rows[0].value === 'true' : true;

      if (!registrationEnabled) {
        return reply.code(403).send({
          success: false,
          error: 'Registration disabled',
          message: 'Public registration is currently disabled'
        });
      }
    } catch (error) {
      fastify.log.error({ error }, 'Failed to check registration config');
      // Continue anyway if config check fails
    }

    const { username, password, displayName, email } = request.body;

    try {
      const existing = await database.getUserByUsername(username);
      if (existing) {
        return reply.code(409).send({
          success: false,
          error: 'User already exists',
          message: 'Username is already taken'
        });
      }

      const passwordHash = hashPassword(password);
      const dbUser = await database.createUser({
        username,
        displayName: displayName || username,
        email,
        role: 'user',
        passwordHash
      });

      sendAuthSuccess(request, reply, dbUser);
      fastify.log.info({ username: dbUser.username }, 'User registered (local)');
    } catch (error) {
      fastify.log.error({ error, username }, 'Registration failed');
      reply.code(500).send({
        success: false,
        error: 'Registration failed',
        message: 'Unable to register user'
      });
    }
  });

  // SECURITY: Explicitly block GET on logout endpoint
  fastify.get('/logout', async (request, reply) => {
    reply.code(405).send({
      success: false,
      error: 'Method Not Allowed',
      message: 'Logout must use POST method'
    });
  });

  // Logout endpoint with JWT revocation
  fastify.post('/logout', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    try {
      // SECURITY FIX: Blacklist the JWT token so it can't be reused
      const token = request.cookies.token || request.headers.authorization?.slice(7);

      if (token && redisService.isConnected) {
        // Decode the token to get expiration time (already validated by authenticate)
        const decoded = fastify.jwt.decode(token);
        if (decoded && decoded.exp) {
          await redisService.blacklistToken(token, decoded.exp);
          fastify.log.info({ user: request.user.username }, 'JWT token blacklisted on logout');
        }
      } else if (token && !redisService.isConnected) {
        fastify.log.warn('Cannot blacklist token - Redis not connected');
      }

      reply
        .clearCookie('token', { path: '/' })
        .send({
          success: true,
          message: 'Logged out successfully'
        });
    } catch (error) {
      fastify.log.error({ error }, 'Logout error');
      // Still clear the cookie even if blacklisting fails
      reply
        .clearCookie('token', { path: '/' })
        .send({
          success: true,
          message: 'Logged out successfully'
        });
    }
  });

  // Verify token endpoint
  fastify.get('/verify', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    reply.send({
      success: true,
      user: {
        username: request.user.username,
        displayName: request.user.displayName,
        email: request.user.email,
        role: request.user.role
      }
    });
  });

  // LDAP connection test (admin only)
  fastify.get('/test-ldap', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    if (config.auth.mode !== 'ldap') {
      return reply.code(400).send({
        success: false,
        error: 'LDAP disabled',
        message: 'LDAP authentication is disabled'
      });
    }

    try {
      await ldapAuth.verifyConnection();
      reply.send({
        success: true,
        message: 'LDAP connection successful'
      });
    } catch (error) {
      reply.code(500).send({
        success: false,
        error: 'LDAP connection failed',
        message: error.message
      });
    }
  });
}
