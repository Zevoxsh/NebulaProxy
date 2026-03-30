import { config } from '../config/config.js';
import { validateBackendUrlWithDNS } from '../utils/security.js';

export async function proxyRoutes(fastify, options) {
  // Proxy any request
  fastify.all('/*', {
    preHandler: fastify.authenticate
  }, async (request, reply) => {
    if (!config.proxy.enabled) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Proxying is disabled on this server'
      });
    }

    const targetUrl = request.query.url || request.headers['x-proxy-target'];

    if (!targetUrl) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Missing target URL. Use ?url=<target> or X-Proxy-Target header'
      });
    }

    try {
      const url = new URL(targetUrl);

      if (!['http:', 'https:'].includes(url.protocol)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Only HTTP and HTTPS targets are supported'
        });
      }

      // SSRF protection and protocol validation
      await validateBackendUrlWithDNS(targetUrl);

      // Check if domain is allowed (applies to all users when configured)
      if (config.proxy.allowedDomains.length > 0) {
        const isAllowed = config.proxy.allowedDomains.some(domain =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`)
        );

        if (!isAllowed) {
          return reply.code(403).send({
            error: 'Forbidden',
            message: `Domain ${url.hostname} is not in the allowed list`
          });
        }
      }

      fastify.log.info({
        user: request.user.username,
        target: targetUrl,
        method: request.method
      }, 'Proxying request');

      // Remove proxy-specific headers
      const headers = { ...request.headers };
      delete headers['host'];
      delete headers['x-proxy-target'];
      delete headers['cookie'];

      // Use raw request and reply for proxy
      return new Promise((resolve, reject) => {
        fastify.proxy.web(request.raw, reply.raw, {
          target: url.href,
          headers,
          ignorePath: true,
          selfHandleResponse: false
        }, (err) => {
          if (err) {
            fastify.log.error({ err, target: targetUrl }, 'Proxy error');
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      fastify.log.error({ error, target: targetUrl }, 'Invalid target URL');
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Invalid target URL'
      });
    }
  });
}
