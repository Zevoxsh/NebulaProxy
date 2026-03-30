import { test, describe, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { authRoutes } from '../routes/auth.js';
import { config } from '../config/config.js';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

describe('Authentication Routes', () => {
  let app;
  let ipCounter = 10;

  beforeAll(async () => {
    app = Fastify({
      logger: false,
      trustProxy: true,
      ajv: {
        customOptions: {
          removeAdditional: false
        }
      }
    });
    await app.register(cookie);
    await app.register(jwt, {
      secret: config.jwtSecret,
      cookie: {
        cookieName: 'token',
        signed: false
      }
    });
    await app.register(rateLimit, {
      max: 100,
      timeWindow: 60000,
      keyGenerator: (request) => {
        return request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
      }
    });
    app.decorate('authenticate', async () => {});
    app.decorate('authorize', () => async () => {});
    await app.register(authRoutes, { prefix: '/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/login', () => {
    test('should reject login with missing username', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          password: 'test123'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('username');
    });

    test('should reject login with missing password', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'testuser'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('password');
    });

    test('should reject login with invalid username format', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'test<script>alert("xss")</script>',
          password: 'password123'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject login with username exceeding max length', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'a'.repeat(300),
          password: 'password123'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject login with password exceeding max length', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'testuser',
          password: 'a'.repeat(2000)
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject login with additional properties', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'testuser',
          password: 'password123',
          malicious: 'data',
          __proto__: { polluted: true }
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should enforce rate limiting (max 5 attempts per minute)', async () => {
      const requests = [];
      const rateLimitIp = '10.0.0.250';

      // Make 6 login attempts rapidly
      for (let i = 0; i < 6; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/auth/login',
            headers: { 'x-forwarded-for': rateLimitIp },
            payload: {
              username: 'testuser' + i,
              password: 'password123'
            }
          })
        );
      }

      const responses = await Promise.all(requests);

      // At least one should be rate limited (429)
      const rateLimited = responses.some(r => r.statusCode === 429);
      expect(rateLimited).toBe(true);
    });

    test('should reject login with invalid credentials (LDAP mock)', async () => {
      const ip = `10.0.0.${ipCounter++}`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: {
          username: 'invaliduser',
          password: 'wrongpassword'
        }
      });

      // Should return 401 when LDAP auth fails
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Authentication failed');
    });
  });
});
