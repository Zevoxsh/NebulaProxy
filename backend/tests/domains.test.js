import { test, describe, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { domainRoutes } from '../routes/domains.js';
import { config } from '../config/config.js';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

describe('Domain Routes - Security Validation', () => {
  let app;
  let validToken;

  beforeAll(async () => {
    app = Fastify({
      logger: false,
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

    // Add authenticate decorator
    app.decorate('authenticate', async function(request, reply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });

    await app.register(domainRoutes, { prefix: '/domains' });
    await app.ready();

    // Create a valid JWT token for authenticated tests
    validToken = app.jwt.sign({
      id: 1,
      username: 'testuser',
      role: 'user'
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /domains - SSRF Protection', () => {
    test('should reject domain creation with localhost backend URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'http://localhost:8080'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid backend URL');
      expect(body.message).toContain('localhost');
    });

    test('should reject domain creation with 127.0.0.1 backend URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'http://127.0.0.1:8080'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid backend URL');
    });

    test('should reject domain creation with metadata endpoint (169.254.169.254)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'http://169.254.169.254/latest/meta-data/'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid backend URL');
      expect(body.message).toContain('metadata');
    });

    test('should reject domain creation with private IP range (192.168.x.x)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'http://192.168.1.1:8080'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid backend URL');
    });

    test('should reject domain creation with private IP range (10.x.x.x)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'http://10.0.0.1:8080'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid backend URL');
    });
  });

  describe('POST /domains - Command Injection Protection', () => {
    test('should reject domain creation with command injection in hostname', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com && rm -rf /',
          backendUrl: 'https://legitimate-backend.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with shell metacharacters in hostname', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com; cat /etc/passwd',
          backendUrl: 'https://legitimate-backend.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with pipe operator in hostname', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com | whoami',
          backendUrl: 'https://legitimate-backend.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /domains - Input Validation', () => {
    test('should reject domain creation with missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com'
          // Missing backendUrl
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with hostname exceeding max length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'a'.repeat(300) + '.com',
          backendUrl: 'https://backend.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with backendUrl exceeding max length', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'https://backend.com/' + 'a'.repeat(3000)
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with invalid hostname format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: '-invalid-.com',
          backendUrl: 'https://backend.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain creation with additional malicious properties', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'example.com',
          backendUrl: 'https://backend.com',
          __proto__: { isAdmin: true },
          constructor: { prototype: { isAdmin: true } }
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /domains/:id - Parameter Validation', () => {
    test('should reject domain update with non-numeric ID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/domains/abc',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'updated.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    test('should reject domain update with SQL injection attempt in ID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/domains/1%20OR%201=1',
        headers: {
          cookie: `token=${validToken}`
        },
        payload: {
          hostname: 'updated.com'
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Authentication Required', () => {
    test('should reject domain creation without authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/domains',
        payload: {
          hostname: 'example.com',
          backendUrl: 'https://backend.com'
        }
      });

      expect(response.statusCode).toBe(401);
    });

    test('should reject domain update without authentication', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/domains/1',
        payload: {
          hostname: 'updated.com'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
