import { database } from '../services/database.js';
import { acmeManager } from '../services/acmeManager.js';
import { certificateManager } from '../services/certificateManager.js';
import { sanitizeHostname, createSecureTempFiles } from '../utils/security.js';

import { spawn } from 'child_process';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function sslRoutes(fastify, options) {
  const canAccessDomain = async (domain, userId, isAdmin) => {
    if (isAdmin || domain.user_id === userId) {
      return true;
    }

    if (domain.team_id) {
      return database.isTeamMember(domain.team_id, userId);
    }

    return false;
  };

  const canManageDomain = async (domain, userId, isAdmin) => {
    if (isAdmin || domain.user_id === userId) {
      return true;
    }

    if (domain.team_id) {
      return database.hasTeamPermission(domain.team_id, userId, 'can_manage_domains');
    }

    return false;
  };

  // Get certificate details for a specific domain
  fastify.get('/certificate-details/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canAccessDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (!domain.ssl_enabled || !domain.ssl_fullchain) {
          return reply.send({ certificate: null });
        }

        // Parse certificate details
        let details = null;
        try {
          const certContent = domain.ssl_fullchain;
          details = await parseCertificateDetails(certContent);
        } catch (err) {
          fastify.log.warn({ error: err, domainId }, 'Failed to parse certificate details');
        }

        return reply.send({
          certificate: {
            id: domain.id,
            domain: domain.hostname,
            issuer: domain.ssl_issuer || (domain.ssl_status === 'active' ? "Let's Encrypt" : 'Custom'),
            type: domain.ssl_cert_type === 'manual' ? 'manual' : 'auto',
            issuedAt: domain.ssl_issued_at || domain.created_at,
            expiresAt: domain.ssl_expires_at,
            status: domain.ssl_status,
            autoRenew: domain.ssl_cert_type === 'acme',
            details
          }
        });
      } catch (error) {
        fastify.log.error({ error }, 'Error getting certificate details');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Delete certificate
  fastify.delete('/certificate/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Optional: try to clean up local ACME certs when running on the ACME node
        if (domain.ssl_cert_type === 'acme') {
          try {
            const safeHostname = sanitizeHostname(domain.hostname);
            const certbot = spawn('certbot', ['delete', '--cert-name', safeHostname, '--non-interactive']);
            await new Promise((resolve) => certbot.on('close', resolve));
          } catch (err) {
            fastify.log.warn({ error: err, domainId }, 'Failed to delete ACME cert via certbot');
          }
        }

        await database.deleteCertificateFromDB(domainId);
        certificateManager.invalidateCache(domain.hostname);

        return reply.send({ success: true });
      } catch (error) {
        fastify.log.error({ error }, 'Error deleting certificate');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Download certificate part (certificate, privatekey, fullchain)
  fastify.get('/download-part/:domainId/:type', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId, type } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canAccessDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (!domain.ssl_fullchain) {
          return reply.code(404).send({ error: 'Certificate not found' });
        }

        let content;
        if (type === 'certificate' || type === 'fullchain') {
          content = domain.ssl_fullchain;
        } else if (type === 'privatekey') {
          content = domain.ssl_private_key;
        } else {
          return reply.code(400).send({ error: 'Invalid type' });
        }

        if (!content) {
          return reply.code(404).send({ error: 'Certificate content not found' });
        }

        reply.header('Content-Type', 'application/x-pem-file');
        return content;
      } catch (error) {
        fastify.log.error({ error }, 'Error downloading certificate part');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Get all SSL certificates
  fastify.get('/certificates', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        // Get user's domains + team domains
        const userDomains = await database.getDomainsByUserIdWithTeams(userId);

        const certificates = userDomains
          .filter(d => d.ssl_enabled)
          .map(domain => {
            let status = 'expired';
            let daysUntilExpiry = null;

            if (domain.ssl_expires_at) {
              const expiryDate = new Date(domain.ssl_expires_at);
              const now = new Date();
              const diffTime = expiryDate - now;
              daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

              if (daysUntilExpiry > 30) {
                status = 'valid';
              } else if (daysUntilExpiry > 0) {
                status = 'expiring-soon';
              } else {
                status = 'expired';
              }
            }

            return {
              id: domain.id,
              domain: domain.hostname,
              ownershipType: domain.ownership_type,
              teamName: domain.team_name,
              issuer: domain.ssl_issuer || (domain.ssl_cert_type === 'acme' ? "Let's Encrypt" : 'Manual'),
              type: domain.ssl_cert_type === 'manual' ? 'manual' : 'auto',
              issuedAt: domain.ssl_issued_at
                ? new Date(domain.ssl_issued_at)
                : (domain.created_at ? new Date(domain.created_at) : new Date()),
              expiresAt: domain.ssl_expires_at ? new Date(domain.ssl_expires_at) : null,
              status,
              autoRenew: domain.ssl_cert_type === 'acme',
              sslStatus: domain.ssl_status
            };
          });

        return { certificates };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting SSL certificates');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Get certificate stats
  fastify.get('/stats', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;

        const userDomains = await database.getDomainsByUserIdWithTeams(userId);
        const sslDomains = userDomains.filter(d => d.ssl_enabled);

        let validCount = 0;
        let expiringSoonCount = 0;
        let expiredCount = 0;

        sslDomains.forEach(domain => {
          if (domain.ssl_expires_at) {
            const expiryDate = new Date(domain.ssl_expires_at);
            const now = new Date();
            const diffTime = expiryDate - now;
            const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (daysUntilExpiry > 30) {
              validCount++;
            } else if (daysUntilExpiry > 0) {
              expiringSoonCount++;
            } else {
              expiredCount++;
            }
          } else {
            expiredCount++;
          }
        });

        return {
          valid: validCount,
          expiringSoon: expiringSoonCount,
          expired: expiredCount
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error getting SSL stats');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Renew certificate
  fastify.post('/renew/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        // Get domain and verify ownership
        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (!domain.ssl_enabled) {
          return reply.code(400).send({ error: 'SSL not enabled for this domain' });
        }

        if (net.isIP(domain.hostname)) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'ACME certificates require a DNS hostname (IP addresses are not supported). Use a custom certificate instead.'
          });
        }

        // Trigger certificate renewal
        try {
          // If domain requires DNS-01 challenge, initiate the manual DNS flow and return TXT details
          if (domain.acme_challenge_type === 'dns-01') {
            try {
              const challenge = await acmeManager.initiateDNSChallenge(domain.hostname, domain.id);
              return reply.send({
                success: true,
                message: 'DNS challenge initiated. Please create the TXT record.',
                challenge: {
                  domain: challenge.domain,
                  token: challenge.token
                }
              });
            } catch (dnsErr) {
              if (dnsErr.message && dnsErr.message.startsWith('CERTIFICATE_ALREADY_VALID')) {
                return reply.send({ success: true, message: 'Certificate already valid' });
              }
              fastify.log.error({ error: dnsErr, domainId }, 'Failed to initiate DNS challenge');
              return reply.code(500).send({ error: 'DNS challenge initiation failed', message: dnsErr.message });
            }
          }

          // Use forceRenew to renew the certificate even if not expiring soon (HTTP-01)
          await acmeManager.forceRenew(domain.hostname);

          // Update database with new expiry date
          const expiry = await acmeManager.getCertExpiry(domain.hostname);

          return {
            success: true,
            message: 'Certificate renewed successfully',
            domain: domain.hostname,
            expiresAt: expiry ? expiry.toISOString() : null
          };
        } catch (acmeError) {
          fastify.log.error({ error: acmeError, domainId }, 'Failed to renew certificate');
          return reply.code(500).send({
            error: 'Certificate renewal failed',
            message: acmeError.message
          });
        }
      } catch (error) {
        fastify.log.error({ error }, 'Error renewing certificate');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Toggle auto-renew
  fastify.put('/auto-renew/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;
        const { autoRenew } = request.body;

        // Get domain and verify ownership
        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Update SSL settings (for now, this is informational)
        // In a full implementation, this would control the renewal cron behavior

        return {
          success: true,
          autoRenew,
          message: `Auto-renew ${autoRenew ? 'enabled' : 'disabled'} for ${domain.hostname}`
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error toggling auto-renew');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Download certificate
  fastify.get('/download/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        // Get domain and verify ownership
        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canAccessDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (!domain.ssl_fullchain) {
          return reply.code(404).send({ error: 'Certificate not found for this domain' });
        }

        try {
          const certContent = domain.ssl_fullchain;
          const keyContent = domain.ssl_private_key || '';
          const fullCert = keyContent ? `${certContent}\n${keyContent}` : certContent;

          // Set headers for file download
          reply.header('Content-Type', 'application/x-pem-file');
          reply.header('Content-Disposition', `attachment; filename="${domain.hostname}.pem"`);

          return fullCert;
        } catch (fileError) {
          fastify.log.error({ error: fileError, domainId }, 'Certificate content not accessible');
          return reply.code(404).send({
            error: 'Certificate not found',
            message: 'The certificate content is not accessible on the server'
          });
        }
      } catch (error) {
        fastify.log.error({ error }, 'Error downloading certificate');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Upload custom certificate
  fastify.post('/upload', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['domainId', 'fullChain', 'privateKey'],
        properties: {
          domainId: {
            type: 'integer',
            minimum: 1
          },
          fullChain: {
            type: 'string',
            minLength: 100,
            maxLength: 131072,
            pattern: '-----BEGIN CERTIFICATE-----'
          },
          privateKey: {
            type: 'string',
            minLength: 100,
            maxLength: 65536,
            pattern: '-----BEGIN.*PRIVATE KEY-----'
          }
        },
        additionalProperties: false
      }
    },
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId, fullChain, privateKey } = request.body;

        // Get domain and verify ownership
        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        // Comprehensive validation using OpenSSL on the provided full chain
        let validationResult;
        try {
          validationResult = await validateCertificate(fullChain, privateKey, domain.hostname);
        } catch (validationError) {
          fastify.log.warn({ error: validationError, domainId }, 'Certificate validation failed');
          return reply.code(400).send({
            error: 'Certificate validation failed',
            message: validationError.message
          });
        }

        // Store certificate in database
        await certificateManager.storeManualCertificateInDB(
          domainId,
          fullChain,
          privateKey
        );

        // Update domain SSL status
        await database.updateDomainSSLStatus(
          domainId,
          'custom',
          null, // No file path needed
          null, // No file path needed
          validationResult.expiryDate
        );

        fastify.log.info({ domainId, hostname: domain.hostname }, 'Custom certificate uploaded');

        return {
          success: true,
          message: 'Custom full-chain certificate uploaded and validated successfully',
          domain: domain.hostname,
          expiresAt: validationResult.expiryDate,
          hostnames: validationResult.hostnames
        };
      } catch (error) {
        fastify.log.error({ error }, 'Error uploading certificate');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: error.message
        });
      }
    }
  });

  // ===== DNS-01 CHALLENGE ENDPOINTS =====

  // Initiate DNS-01 challenge
  fastify.post('/request-dns/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        // Get domain and verify ownership
        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        if (!domain.ssl_enabled) {
          return reply.code(400).send({
            error: 'SSL not enabled for this domain'
          });
        }

        if (net.isIP(domain.hostname)) {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'ACME certificates require a DNS hostname (IP addresses are not supported). Use a custom certificate instead.'
          });
        }

        // Check if there's already a pending challenge
        const existingChallenge = await database.getDNSChallengeByDomainId(domainId);
        if (existingChallenge && existingChallenge.status === 'waiting_user') {
          return reply.send({
            success: true,
            alreadyPending: true,
            challenge: {
              txtRecord: existingChallenge.domain,
              txtValue: existingChallenge.token,
              expiresAt: existingChallenge.expiresAt
            }
          });
        }

        // Initiate DNS challenge
        try {
          const { token, domain: txtDomain } = await acmeManager.initiateDNSChallenge(
            domain.hostname,
            domainId
          );

          // Mark domain as wildcard if applicable
          if (acmeManager.isWildcardDomain(domain.hostname)) {
            await database.setDomainWildcard(domainId, true);
          }

          fastify.log.info({ domainId, hostname: domain.hostname }, 'DNS challenge initiated');

          return reply.send({
            success: true,
            message: 'DNS challenge initiated. Please create the TXT record.',
            challenge: {
              txtRecord: txtDomain,
              txtValue: token,
              hostname: domain.hostname,
              instructions: [
                `1. Log into your DNS provider's control panel`,
                `2. Create a new TXT record:`,
                `   - Name: ${txtDomain}`,
                `   - Value: ${token}`,
                `3. Wait for DNS propagation (typically 5-15 minutes)`,
                `4. Click "Validate" to complete certificate issuance`
              ]
            }
          });
        } catch (challengeError) {
          // Handle special success cases
          if (challengeError.message.startsWith('CERTIFICATE_ALREADY_VALID:')) {
            const daysRemaining = challengeError.message.split(':')[1];

            fastify.log.info({ domainId, daysRemaining }, 'Certificate already valid');

            return reply.send({
              success: true,
              certificateExists: true,
              message: `Certificate already valid with ${daysRemaining} days remaining`,
              daysRemaining: parseInt(daysRemaining, 10)
            });
          }

          if (challengeError.message === 'CERTIFICATE_OBTAINED_HTTP01') {
            fastify.log.info({ domainId, hostname: domain.hostname }, 'Certificate obtained via HTTP-01');

            return reply.send({
              success: true,
              certificateObtained: true,
              method: 'http-01',
              message: 'Certificate obtained successfully (HTTP-01 was used instead of DNS-01)'
            });
          }

          // Re-throw other errors
          throw challengeError;
        }
      } catch (error) {
        fastify.log.error({ error, domainId: request.params.domainId }, 'Failed to initiate DNS challenge');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: error.message
        });
      }
    }
  });

  // Get DNS challenge instructions
  fastify.get('/dns-instructions/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        const challenge = await database.getDNSChallengeByDomainId(domainId);

        if (!challenge || !challenge.token) {
          return reply.code(404).send({
            error: 'No DNS challenge found',
            message: 'Please initiate a DNS challenge first'
          });
        }

        return reply.send({
          success: true,
          challenge: {
            txtRecord: challenge.domain,
            txtValue: challenge.token,
            status: challenge.status,
            expiresAt: challenge.expiresAt,
            hostname: domain.hostname
          }
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to get DNS instructions');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Validate DNS challenge and complete certificate issuance
  fastify.post('/validate-dns/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain) {
          return reply.code(404).send({ error: 'Domain not found' });
        }

        if (!await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        const challenge = await database.getDNSChallengeByDomainId(domainId);

        if (!challenge || challenge.status !== 'waiting_user') {
          return reply.code(400).send({
            error: 'No pending DNS challenge',
            message: 'Please initiate a DNS challenge first'
          });
        }

        // Optional: Check DNS propagation before validating
        const { checkDNSFirst } = request.body || {};

        if (checkDNSFirst) {
          const propagated = await acmeManager.checkDNSPropagation(
            challenge.domain,
            challenge.token
          );

          if (!propagated) {
            return reply.send({
              success: false,
              propagated: false,
              message: 'DNS TXT record not found. Please wait for DNS propagation.',
              recommendation: 'Wait 5-15 minutes and try again'
            });
          }
        }

        // Validate the challenge
        await acmeManager.validateDNSChallenge(domainId);

        // Update database with certificate info
        const expiry = await acmeManager.getCertExpiry(domain.hostname);

        await database.createAuditLog({
          userId,
          action: 'ssl_dns_certificate_obtained',
          entityType: 'domain',
          entityId: domainId,
          details: {
            hostname: domain.hostname,
            challenge_type: 'dns-01',
            expiry: expiry ? expiry.toISOString() : null
          },
          ipAddress: request.ip
        });

        fastify.log.info({ domainId, hostname: domain.hostname }, 'DNS-01 certificate obtained');

        return reply.send({
          success: true,
          message: 'Certificate obtained successfully!',
          certificate: {
            domain: domain.hostname,
            expiry: expiry ? expiry.toISOString() : null
          }
        });
      } catch (error) {
        fastify.log.error({ error, domainId: request.params.domainId }, 'DNS validation failed');

        // Update status to failed
        await database.updateDNSValidationStatus(request.params.domainId, 'failed');

        return reply.code(500).send({
          error: 'Validation failed',
          message: error.message,
          suggestion: 'Please verify the TXT record is correctly created and try again'
        });
      }
    }
  });

  // Check DNS propagation
  fastify.post('/check-dns/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain || !await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        const challenge = await database.getDNSChallengeByDomainId(domainId);

        if (!challenge) {
          return reply.code(404).send({ error: 'No DNS challenge found' });
        }

        const propagated = await acmeManager.checkDNSPropagation(
          challenge.domain,
          challenge.token
        );

        return reply.send({
          success: true,
          propagated,
          message: propagated
            ? 'DNS TXT record found! You can now validate.'
            : 'DNS TXT record not yet propagated. Please wait.'
        });
      } catch (error) {
        fastify.log.error({ error }, 'DNS check failed');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Cancel DNS challenge
  fastify.post('/cancel-dns/:domainId', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        const userId = request.user.id;
        const isAdmin = request.user.role === 'admin';
        const { domainId } = request.params;

        const domain = await database.getDomainById(domainId);

        if (!domain || !await canManageDomain(domain, userId, isAdmin)) {
          return reply.code(403).send({ error: 'Forbidden' });
        }

        await acmeManager.cancelDNSChallenge(domainId);

        return reply.send({
          success: true,
          message: 'DNS challenge cancelled'
        });
      } catch (error) {
        fastify.log.error({ error }, 'Failed to cancel DNS challenge');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // Admin: Clear all certificate caches
  fastify.post('/admin/clear-cache', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      certificateManager.clearCache();
      return reply.send({
        success: true,
        message: 'Certificate cache cleared successfully'
      });
    } catch (error) {
      fastify.log.error({ error }, 'Error clearing certificate cache');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to clear certificate cache'
      });
    }
  });

  // Admin: Clear certificate cache for specific domain
  fastify.post('/admin/clear-cache/:domainId', {
    preHandler: fastify.authorize(['admin'])
  }, async (request, reply) => {
    try {
      const { domainId } = request.params;
      const domain = await database.getDomainById(domainId);

      if (!domain) {
        return reply.code(404).send({ error: 'Domain not found' });
      }

      certificateManager.invalidateCache(domain.hostname);
      return reply.send({
        success: true,
        message: `Certificate cache cleared for ${domain.hostname}`
      });
    } catch (error) {
      fastify.log.error({ error }, 'Error clearing certificate cache');
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to clear certificate cache'
      });
    }
  });

  // ===== WILDCARD SSL CERTIFICATE ROUTES (admin only) =====

  // GET /ssl/wildcards - List all wildcard certs with coverage count
  fastify.get('/wildcards', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== 'admin') {
          return reply.code(403).send({ error: 'Admin access required' });
        }

        const certs = await database.getAllWildcardCerts();
        const certsWithCoverage = await Promise.all(
          certs.map(async (cert) => ({
            ...cert,
            coveredDomainsCount: await database.getWildcardCoveredDomainsCount(cert.hostname)
          }))
        );

        return reply.send({ wildcards: certsWithCoverage });
      } catch (error) {
        fastify.log.error({ error }, 'Error listing wildcard certs');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // POST /ssl/wildcards/generate - Generate a self-signed wildcard cert
  fastify.post('/wildcards/generate', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== 'admin') {
          return reply.code(403).send({ error: 'Admin access required' });
        }

        const { hostname } = request.body || {};
        if (!hostname || !hostname.startsWith('*.')) {
          return reply.code(400).send({ error: 'hostname must be a wildcard pattern, e.g. *.example.com' });
        }

        const result = await certificateManager.generateWildcardCert(hostname);
        return reply.send({ success: true, cert: result });
      } catch (error) {
        fastify.log.error({ error }, 'Error generating wildcard cert');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });

  // POST /ssl/wildcards/upload - Upload a manual wildcard cert
  fastify.post('/wildcards/upload', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== 'admin') {
          return reply.code(403).send({ error: 'Admin access required' });
        }

        const { hostname, fullchain, privateKey } = request.body || {};
        if (!hostname || !hostname.startsWith('*.')) {
          return reply.code(400).send({ error: 'hostname must be a wildcard pattern, e.g. *.example.com' });
        }
        if (!fullchain || !privateKey) {
          return reply.code(400).send({ error: 'fullchain and privateKey are required' });
        }

        await certificateManager.storeWildcardCertManually(hostname, fullchain, privateKey);
        return reply.send({ success: true });
      } catch (error) {
        fastify.log.error({ error }, 'Error uploading wildcard cert');
        return reply.code(500).send({ error: error.message || 'Internal Server Error' });
      }
    }
  });

  // DELETE /ssl/wildcards/:id - Delete a wildcard cert
  fastify.delete('/wildcards/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      try {
        if (request.user.role !== 'admin') {
          return reply.code(403).send({ error: 'Admin access required' });
        }

        const { id } = request.params;
        const cert = await database.getWildcardCertById(id);
        if (!cert) {
          return reply.code(404).send({ error: 'Wildcard certificate not found' });
        }

        await database.deleteWildcardCert(id);
        certificateManager.invalidateWildcardCacheEntries(cert.hostname);
        return reply.send({ success: true });
      } catch (error) {
        fastify.log.error({ error }, 'Error deleting wildcard cert');
        return reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  });
}

/**
 * Parse certificate details using OpenSSL
 * @param {string} certContent - PEM-formatted certificate content
 * @returns {Promise<Object>} - Parsed certificate details
 */
async function parseCertificateDetails(certContent) {
  const tempFiles = await createSecureTempFiles({ cert: certContent });
  const tempCertPath = tempFiles.paths.cert;

  try {
    const { stdout, stderr, code } = await new Promise((resolve, reject) => {
      const openssl = spawn('openssl', ['x509', '-in', tempCertPath, '-noout', '-text']);
      let out = '';
      let err = '';

      openssl.stdout.on('data', (data) => {
        out += data.toString();
      });

      openssl.stderr.on('data', (data) => {
        err += data.toString();
      });

      openssl.on('close', (exitCode) => resolve({ stdout: out, stderr: err, code: exitCode }));
      openssl.on('error', (spawnError) => reject(new Error(`Failed to spawn OpenSSL: ${spawnError.message}`)));
    });

    if (code !== 0) {
      throw new Error(`OpenSSL failed: ${stderr}`);
    }

    const details = {};
    const subjectMatch = stdout.match(/Subject: (.+)/);
    if (subjectMatch) details.subject = subjectMatch[1].trim();

    const serialMatch = stdout.match(/Serial Number:\s*\n?\s*([a-f0-9:]+)/i);
    if (serialMatch) details.serialNumber = serialMatch[1].trim().replace(/:/g, '');

    const signatureMatch = stdout.match(/Signature Algorithm: (.+)/);
    if (signatureMatch) details.signatureAlgorithm = signatureMatch[1].trim();

    const sansMatch = stdout.match(/DNS:([^\n]+)/g);
    if (sansMatch) {
      details.subjectAltNames = sansMatch.map((san) => san.replace('DNS:', '').trim()).join(', ');
    }

    const issuerMatch = stdout.match(/Issuer: (.+)/);
    if (issuerMatch) details.issuer = issuerMatch[1].trim();

    const notBeforeMatch = stdout.match(/Not Before: (.+)/);
    const notAfterMatch = stdout.match(/Not After\s*:\s*(.+)/);
    if (notBeforeMatch) details.validFrom = notBeforeMatch[1].trim();
    if (notAfterMatch) details.validUntil = notAfterMatch[1].trim();

    return details;
  } catch (error) {
    throw new Error(`Failed to parse certificate details: ${error.message}`);
  } finally {
    await tempFiles.cleanup();
  }
}

/**
 * Validate uploaded certificate and private key
 * @param {string} certificate - PEM-formatted certificate
 * @param {string} privateKey - PEM-formatted private key
 * @param {string} hostname - Domain hostname to validate against
 * @returns {Promise<Object>} - Validation result with expiry date
 */
async function validateCertificate(certificate, privateKey, hostname) {
  return new Promise(async (resolve, reject) => {
    let tempFiles;
    try {
      tempFiles = await createSecureTempFiles({ cert: certificate, key: privateKey });
      const tempCertPath = tempFiles.paths.cert;
      const tempKeyPath = tempFiles.paths.key;

      const verifyCert = spawn('openssl', ['x509', '-in', tempCertPath, '-noout', '-text']);

      let certStdout = '';
      let certStderr = '';

      verifyCert.stdout.on('data', (data) => {
        certStdout += data.toString();
      });

      verifyCert.stderr.on('data', (data) => {
        certStderr += data.toString();
      });

      verifyCert.on('close', (code) => {
        if (code !== 0) {
          tempFiles.cleanup().finally(() => reject(new Error(`Invalid certificate format: ${certStderr}`)));
          return;
        }

        let expiryDate = null;
        const certHostnames = [];

        const notAfterMatch = certStdout.match(/Not After\s*:\s*(.+)/);
        if (notAfterMatch) {
          try {
            expiryDate = new Date(notAfterMatch[1].trim()).toISOString();
          } catch {
            tempFiles.cleanup().finally(() => reject(new Error('Failed to parse certificate expiry date')));
            return;
          }

          if (new Date(expiryDate) < new Date()) {
            tempFiles.cleanup().finally(() => reject(new Error('Certificate has expired')));
            return;
          }
        }

        const cnMatch = certStdout.match(/Subject:.*CN\s*=\s*([^,\n]+)/);
        if (cnMatch) certHostnames.push(cnMatch[1].trim());

        const sansMatch = certStdout.match(/DNS:([^\n,]+)/g);
        if (sansMatch) {
          sansMatch.forEach((san) => {
            const host = san.replace('DNS:', '').trim();
            if (!certHostnames.includes(host)) certHostnames.push(host);
          });
        }

        const hostnameMatches = certHostnames.some((certHost) => {
          if (certHost.startsWith('*.')) {
            const certBaseDomain = certHost.substring(2);
            const hostParts = hostname.split('.');
            const certParts = certBaseDomain.split('.');
            if (hostParts.length > certParts.length) return hostname.endsWith(certBaseDomain);
            return false;
          }
          return certHost === hostname;
        });

        if (!hostnameMatches) {
          tempFiles.cleanup().finally(() => reject(new Error(`Certificate does not match domain ${hostname}. Certificate is valid for: ${certHostnames.join(', ')}`)));
          return;
        }

        const verifyKey = spawn('openssl', ['rsa', '-in', tempKeyPath, '-noout', '-check']);
        let keyStderr = '';

        verifyKey.stderr.on('data', (data) => {
          keyStderr += data.toString();
        });

        verifyKey.on('close', (keyCode) => {
          if (keyCode !== 0) {
            tempFiles.cleanup().finally(() => reject(new Error(`Invalid private key format: ${keyStderr}`)));
            return;
          }

          const certModulus = spawn('openssl', ['x509', '-in', tempCertPath, '-noout', '-modulus']);
          const keyModulus = spawn('openssl', ['rsa', '-in', tempKeyPath, '-noout', '-modulus']);

          let certMod = '';
          let keyMod = '';
          let certModulusDone = false;
          let keyModulusDone = false;

          certModulus.stdout.on('data', (data) => {
            certMod += data.toString();
          });

          keyModulus.stdout.on('data', (data) => {
            keyMod += data.toString();
          });

          const checkModulusMatch = () => {
            if (certModulusDone && keyModulusDone) {
              tempFiles.cleanup().finally(() => {
                if (certMod.trim() !== keyMod.trim()) {
                  reject(new Error('Certificate and private key do not match'));
                  return;
                }

                resolve({
                  valid: true,
                  expiryDate,
                  hostnames: certHostnames
                });
              });
            }
          };

          certModulus.on('close', () => {
            certModulusDone = true;
            checkModulusMatch();
          });

          keyModulus.on('close', () => {
            keyModulusDone = true;
            checkModulusMatch();
          });
        });
      });
    } catch (err) {
      if (tempFiles) {
        await tempFiles.cleanup();
      }
      reject(new Error(`Validation failed: ${err.message}`));
    }
  });
}
