/**
 * ACME Manager - Let's Encrypt certificate management
 *
 * Manages SSL/TLS certificates using certbot with webroot mode
 * Adapted from neb project for NebulaProxy
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import net from 'net';
import { CronJob } from 'cron';
import { database } from './database.js';
import { certificateManager } from './certificateManager.js';
import { sanitizeHostname } from '../utils/security.js';
import configManager from '../config/config-manager.js';

class AcmeManager {
  constructor() {
    // Track in-progress certificate requests
    this.running = new Set();

    // Directories
    this.certDir = '/etc/letsencrypt/live';
    this.webrootDir = process.env.ACME_WEBROOT || '/var/www/letsencrypt';

    // Renewal cron job
    this.renewalJob = null;

    // DNS-01 Challenge tracking
    this.dnsChallengePending = new Map(); // domainId -> { process, token, domain, originalDomain, expiresAt }
    this.dnsValidationTimeout = 3600000; // 1 hour (in milliseconds)
  }

  /**
   * Get ACME email from configuration
   * Reads from ConfigManager (Redis) instead of process.env
   */
  getEmail() {
    return configManager.get('ACME_EMAIL', '');
  }

  /**
   * Initialize ACME manager
   * Creates webroot directory if needed
   */
  init() {
    // Create webroot directory for HTTP-01 challenges
    if (!fs.existsSync(this.webrootDir)) {
      try {
        fs.mkdirSync(this.webrootDir, { recursive: true });
        console.log(`[AcmeManager] Created webroot directory: ${this.webrootDir}`);
      } catch (error) {
        console.error('[AcmeManager] Failed to create webroot directory:', error.message);
      }
    }

    const email = this.getEmail();
    console.log('[AcmeManager] Initialized');
    console.log(`[AcmeManager] Email: ${email || '(not set)'}`);
    console.log(`[AcmeManager] Webroot: ${this.webrootDir}`);
    console.log(`[AcmeManager] Cert directory: ${this.certDir}`);
  }

  /**
   * Ensure a certificate exists for a domain
   * If not, request one from Let's Encrypt
   */
  async ensureCert(domain) {
    if (net.isIP(domain)) {
      throw new Error('ACME certificates require a DNS hostname (IP addresses are not supported).');
    }

    // Check if domain is configured for DNS-01 challenge
    const dbDomain = await database.getDomainByHostname(domain);

    if (dbDomain && dbDomain.acme_challenge_type === 'dns-01') {
      console.log(`[AcmeManager] Domain ${domain} requires DNS-01 challenge (manual setup required)`);
      console.log(`[AcmeManager] Skipping automatic HTTP-01 certificate request`);
      return;
    }

    if (await this.certFilesExist(domain)) {
      const expiresSoon = await this.certExpiresSoon(domain);
      if (!expiresSoon) {
        console.log(`[AcmeManager] Certificate already exists for ${domain}`);
        return;
      }
      console.log(`[AcmeManager] Certificate for ${domain} expires soon, attempting renewal`);
    }

    if (this.running.has(domain)) {
      throw new Error(`Certificate request already in progress for ${domain}`);
    }

    this.running.add(domain);

    try {
      await this._requestCertificate(domain);
    } finally {
      this.running.delete(domain);
    }
  }

  /**
   * Request a certificate using certbot
   * Uses webroot mode for HTTP-01 challenge
   */
  async _requestCertificate(domain) {
    const email = this.getEmail();
    if (!email) {
      throw new Error('ACME_EMAIL environment variable not set');
    }

    // Sanitize domain to prevent command injection
    const safeDomain = sanitizeHostname(domain);

    console.log(`[AcmeManager] Requesting certificate for ${safeDomain}...`);

    return new Promise((resolve, reject) => {
      const args = [
        'certonly',
        '--webroot',
        '-w', this.webrootDir,
        '-d', safeDomain,
        '--email', email,
        '--agree-tos',
        '--non-interactive',
        '--keep-until-expiring'
      ];

      const certbot = spawn('certbot', args);
      let stdout = '';
      let stderr = '';

      certbot.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      certbot.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      certbot.on('close', async (code) => {
        if (code === 0) {
          console.log(`[AcmeManager] SUCCESS: Certificate obtained for ${domain}`);

          // Update SSL certificate info in database
          try {
            const dbDomain = await database.getDomainByHostname(domain);
            if (dbDomain) {
              const certPath = path.join(this.certDir, domain, 'fullchain.pem');
              const keyPath = path.join(this.certDir, domain, 'privkey.pem');

              // Let's Encrypt certificates are valid for 90 days
              const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

              await database.updateDomainSSLPaths(dbDomain.id, certPath, keyPath, expiresAt);
              await database.updateDomainSSLStatus(dbDomain.id, 'active', certPath, keyPath, expiresAt);

              // Store certificate in database
              await certificateManager.storeCertbotCertificateInDB(dbDomain.id, certPath, keyPath);

              console.log(`[AcmeManager] SSL info updated for ${domain} (expires: ${expiresAt})`);
            }
          } catch (dbError) {
            console.error(`[AcmeManager] Failed to update SSL info in database:`, dbError.message);
          }

          resolve();
        } else {
          const trimmedStdout = stdout.trim();
          const trimmedStderr = stderr.trim();
          if (trimmedStdout) {
            console.error(`[AcmeManager] Certbot stdout (${domain}):
${trimmedStdout}`);
          }
          if (trimmedStderr) {
            console.error(`[AcmeManager] Certbot stderr (${domain}):
${trimmedStderr}`);
          }
          console.error(`[AcmeManager] Certbot failed for ${domain} (code ${code})`);
          console.error(`[AcmeManager] Command: certbot ${args.join(' ')}`);
          console.error('[AcmeManager] Check /var/log/letsencrypt/letsencrypt.log for full details');
          reject(new Error(`Certbot exited with code ${code}`));
        }
      });

      certbot.on('error', (error) => {
        console.error('[AcmeManager] Failed to spawn certbot:', error.message);
        console.error(`[AcmeManager] Command: certbot ${args.join(' ')}`);
        reject(new Error(`Failed to spawn certbot: ${error.message}`));
      });
    });
  }

  /**
   * Check if certificate files exist for a domain
   */
  async certFilesExist(domain) {
    try {
      const cert = await database.getCertificateByHostname(domain);
      if (!cert || !cert.fullchain || !cert.privateKey) {
        return false;
      }

      if (cert.expiresAt) {
        return new Date(cert.expiresAt) > new Date();
      }

      const metadata = certificateManager.parseCertificateMetadata(cert.fullchain);
      return new Date(metadata.expiresAt) > new Date();
    } catch (error) {
      console.error(`[AcmeManager] Error checking certificate in DB for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Get certificate content (for loading into TLS context)
   */
  async getCertContent(domain) {
    try {
      return await certificateManager.loadCertificateFromDB(domain);
    } catch (error) {
      console.error(`[AcmeManager] Error reading cert data for ${domain}:`, error.message);
      return null;
    }
  }

  /**
   * Get certificate expiration date
   */
  async getCertExpiry(domain) {
    try {
      const cert = await database.getCertificateByHostname(domain);
      if (!cert || !cert.fullchain) return null;

      if (cert.expiresAt) {
        return new Date(cert.expiresAt);
      }

      const metadata = certificateManager.parseCertificateMetadata(cert.fullchain);
      return new Date(metadata.expiresAt);
    } catch (error) {
      console.error(`[AcmeManager] Error getting cert expiry for ${domain}:`, error.message);
      return null;
    }
  }

  /**
   * Check if certificate expires soon (within N days)
   */
  async certExpiresSoon(domain, days = 30) {
    const expiry = await this.getCertExpiry(domain);
    if (!expiry) return false;

    const now = new Date();
    const daysLeft = (expiry - now) / (1000 * 60 * 60 * 24);
    return daysLeft < days;
  }

  /**
   * Get certificate status
   */
  async getCertStatus(domain) {
    if (!await this.certFilesExist(domain)) {
      return {
        exists: false,
        valid: false
      };
    }

    const expiry = await this.getCertExpiry(domain);
    if (!expiry) {
      return {
        exists: true,
        valid: false,
        error: 'Could not parse expiry date'
      };
    }

    const now = new Date();
    const daysLeft = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
    const expired = expiry < now;
    const expiresSoon = daysLeft < 30;

    return {
      exists: true,
      valid: !expired,
      expiry: expiry.toISOString(),
      daysLeft,
      expired,
      expiresSoon
    };
  }

  /**
   * Renew certificates that are expiring soon
   * Called by cron job daily
   */
  async renewExpiringSoon() {
    console.log('[AcmeManager] Checking for expiring certificates...');

    try {
      // Get all domains with SSL enabled and ACME enabled
      const domainsWithSSL = (await database.getAllActiveDomains())
        .filter(d => d.proxy_type === 'http' && d.ssl_enabled && d.acme_enabled);

      if (domainsWithSSL.length === 0) {
        console.log('[AcmeManager] No domains configured for auto-renewal');
        return;
      }

      let renewedCount = 0;
      let errorCount = 0;

      for (const domainObj of domainsWithSSL) {
        const hostname = domainObj.hostname;
        if (await this.certExpiresSoon(hostname)) {
          console.log(`[AcmeManager] Renewing certificate for ${hostname}...`);
          try {
            await this.ensureCert(hostname);
            renewedCount++;
          } catch (error) {
            console.error(`[AcmeManager] Failed to renew cert for ${hostname}:`, error.message);
            errorCount++;
          }
        }
      }

      console.log(`[AcmeManager] Renewal check complete: ${renewedCount} renewed, ${errorCount} errors`);
    } catch (error) {
      console.error('[AcmeManager] Error during renewal check:', error.message);
    }
  }

  /**
   * Start automatic renewal cron job
   * Runs daily at 3 AM
   */
  startRenewalCron() {
    if (this.renewalJob) {
      console.warn('[AcmeManager] Renewal cron already started');
      return;
    }

    // Run daily at 3 AM
    this.renewalJob = new CronJob('0 3 * * *', async () => {
      console.log('[AcmeManager] Running scheduled renewal check...');
      await this.renewExpiringSoon();
    });

    this.renewalJob.start();
    console.log('[AcmeManager] Renewal cron started (daily at 3 AM)');
  }

  /**
   * Stop automatic renewal cron job
   */
  stopRenewalCron() {
    if (this.renewalJob) {
      this.renewalJob.stop();
      this.renewalJob = null;
      console.log('[AcmeManager] Renewal cron stopped');
    }
  }

  /**
   * Force renewal for a specific domain
   * (bypasses "expiring soon" check)
   */
  async forceRenew(domain) {
    if (net.isIP(domain)) {
      throw new Error('ACME certificates require a DNS hostname (IP addresses are not supported).');
    }

    console.log(`[AcmeManager] Force renewing certificate for ${domain}...`);

    // Remove existing cert files to force renewal
    const dir = path.join(this.certDir, domain);
    if (fs.existsSync(dir)) {
      try {
        // Note: certbot manages this directory, we just trigger renewal
        console.log(`[AcmeManager] Triggering certbot renewal for ${domain}`);
      } catch (error) {
        console.error(`[AcmeManager] Error during force renewal:`, error.message);
      }
    }

    await this.ensureCert(domain);
  }

  // ===== WILDCARD DOMAIN METHODS =====

  /**
   * Check if domain is a wildcard domain (*.example.com)
   */
  isWildcardDomain(domain) {
    return domain.startsWith('*.');
  }

  /**
   * Get base domain from wildcard (*.example.com -> example.com)
   */
  getBaseDomain(domain) {
    return domain.replace(/^\*\./, '');
  }

  // ===== DNS-01 ACME CHALLENGE METHODS =====

  /**
   * Delete existing certificate if it exists
   * Prevents conflicts when requesting new certificates
   */
  async _deleteCertificateIfExists(domain) {
    console.log(`[AcmeManager] Checking for existing certificates for ${domain}...`);

    // Find all certificate variants (domain, domain-0001, domain-0002, etc.)
    const renewalDir = '/etc/letsencrypt/renewal';
    let certNames = [];

    try {
      if (fs.existsSync(renewalDir)) {
        const files = fs.readdirSync(renewalDir);
        certNames = files
          .filter(f => f.startsWith(domain) && f.endsWith('.conf'))
          .map(f => f.replace('.conf', ''));

        if (certNames.length > 0) {
          console.log(`[AcmeManager] Found ${certNames.length} certificate(s):`, certNames.join(', '));
        }
      }
    } catch (err) {
      console.warn(`[AcmeManager] Error reading renewal directory:`, err.message);
    }

    // Also check live directory
    try {
      if (fs.existsSync(this.certDir)) {
        const liveDirs = fs.readdirSync(this.certDir);
        const liveCerts = liveDirs.filter(d => d.startsWith(domain));

        // Add to certNames if not already there
        liveCerts.forEach(cert => {
          if (!certNames.includes(cert)) {
            certNames.push(cert);
          }
        });
      }
    } catch (err) {
      console.warn(`[AcmeManager] Error reading live directory:`, err.message);
    }

    if (certNames.length === 0) {
      console.log(`[AcmeManager] No existing certificates found for ${domain}`);
      return;
    }

    // Delete all found certificates
    for (const certName of certNames) {
      console.log(`[AcmeManager] Deleting certificate: ${certName}...`);

      await new Promise((resolve) => {
        const certbot = spawn('certbot', [
          'delete',
          '--cert-name', certName,
          '--non-interactive'
        ]);

        let stdout = '';
        let stderr = '';

        certbot.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        certbot.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        certbot.on('close', (code) => {
          if (code === 0) {
            console.log(`[AcmeManager] SUCCESS: Certificate ${certName} deleted`);
          } else {
            console.warn(`[AcmeManager] WARNING: Failed to delete ${certName} (code ${code})`);
          }
          resolve();
        });

        certbot.on('error', (error) => {
          console.warn(`[AcmeManager] Error deleting ${certName}:`, error.message);
          resolve();
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          console.warn(`[AcmeManager] Deletion timeout for ${certName}`);
          certbot.kill();
          resolve();
        }, 10000);
      });
    }

    console.log(`[AcmeManager] Certificate cleanup complete for ${domain}`);
  }

  /**
   * Check if a valid certificate already exists
   * Returns certificate info if valid, null otherwise
   */
  async _checkExistingCertificate(domain) {
    const certPath = path.join(this.certDir, domain, 'fullchain.pem');

    if (!fs.existsSync(certPath)) {
      return null;
    }

    // Get certificate info from certbot
    return new Promise((resolve) => {
      // Sanitize domain to prevent command injection
      const safeDomain = sanitizeHostname(domain);
      const certbot = spawn('certbot', ['certificates', '-d', safeDomain]);

      let stdout = '';
      let stderr = '';

      certbot.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      certbot.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      certbot.on('close', (code) => {
        if (code === 0 && stdout) {
          // Parse expiry date
          const expiryMatch = stdout.match(/Expiry Date:\s*([^\s]+)\s+([^\s]+)/);
          const validMatch = stdout.match(/VALID:\s*(\d+)\s*days/);

          if (expiryMatch && validMatch) {
            const daysValid = parseInt(validMatch[1], 10);

            // Certificate is considered valid if it has more than 30 days left
            if (daysValid > 30) {
              const expiryDateStr = `${expiryMatch[1]}T${expiryMatch[2]}`;
              const expiryDate = new Date(expiryDateStr);

              console.log(`[AcmeManager] SUCCESS: Valid certificate found for ${domain} (${daysValid} days remaining)`);

              resolve({
                valid: true,
                daysRemaining: daysValid,
                expiresAt: expiryDate,
                certPath,
                keyPath: path.join(this.certDir, domain, 'privkey.pem')
              });
              return;
            }
          }
        }

        resolve(null);
      });

      certbot.on('error', () => {
        resolve(null);
      });

      setTimeout(() => {
        certbot.kill();
        resolve(null);
      }, 10000);
    });
  }

  /**
   * Initiate DNS-01 challenge for a domain
   * Spawns certbot in manual mode and captures DNS TXT record instructions
   */
  async initiateDNSChallenge(domain, domainId) {
    if (net.isIP(domain)) {
      throw new Error('ACME certificates require a DNS hostname (IP addresses are not supported).');
    }

    if (this.running.has(domain)) {
      throw new Error(`Certificate request already in progress for ${domain}`);
    }

    const email = this.getEmail();
    if (!email) {
      throw new Error('ACME_EMAIL environment variable not set');
    }

    console.log(`[AcmeManager] Initiating DNS-01 challenge for ${domain}...`);

    // Check if a valid certificate already exists
    const existingCert = await this._checkExistingCertificate(domain);

    if (existingCert && existingCert.valid) {
      // Update database with existing certificate info
      try {
        await database.updateDomainSSLPaths(domainId, existingCert.certPath, existingCert.keyPath, existingCert.expiresAt.toISOString());
        await database.updateDomainSSLStatus(domainId, 'active', existingCert.certPath, existingCert.keyPath, existingCert.expiresAt.toISOString());

        // Store existing certificate in database
        await certificateManager.storeCertbotCertificateInDB(domainId, existingCert.certPath, existingCert.keyPath);

        console.log(`[AcmeManager] Using existing valid certificate for ${domain}`);
      } catch (dbError) {
        console.error(`[AcmeManager] Failed to update database with existing cert:`, dbError.message);
      }

      // Return success with existing certificate
      throw new Error(`CERTIFICATE_ALREADY_VALID:${existingCert.daysRemaining}`);
    }

    // Delete existing certificate if it exists but is not valid (expired or expiring soon)
    await this._deleteCertificateIfExists(domain);

    this.running.add(domain);

    return new Promise((resolve, reject) => {
      const args = [
        'certonly',
        '--manual',
        '--preferred-challenges', 'dns',
        '-d', domain,
        '--email', email,
        '--agree-tos'
      ];

      const certbot = spawn('certbot', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let dnsToken = null;
      let dnsDomain = null;

      let certificateObtainedWithoutDNS = false;
      let hasRespondedToRenewal = false;

      certbot.stdout.on('data', async (data) => {
        const output = data.toString();
        stdout += output;

        console.log(`[AcmeManager DNS] ${output.trim()}`);

        // Detect if certificate was obtained without DNS challenge (HTTP-01 fallback)
        if ((output.includes('Successfully received certificate') ||
             output.includes('Certificate is saved at')) &&
            !dnsToken && !dnsDomain) {
          console.log(`[AcmeManager] WARNING: Certificate obtained without DNS challenge (likely HTTP-01 fallback)`);
          certificateObtainedWithoutDNS = true;
        }

        // Auto-respond to certbot interactive prompts
        if (output.includes('Are you OK with your IP being logged') ||
            output.includes('public IP') ||
            output.includes('(Y)es/(N)o')) {
          console.log(`[AcmeManager] Auto-responding 'Y' to IP logging question`);
          try {
            certbot.stdin.write('Y\n');
          } catch (err) {
            console.error(`[AcmeManager] Failed to send response to certbot:`, err.message);
          }
        }

        // Auto-respond to "What would you like to do? 1: Keep / 2: Renew"
        // Only respond once to avoid multiple responses
        if (!hasRespondedToRenewal &&
            (output.includes('What would you like to do') ||
             output.includes('Select the appropriate number'))) {
          console.log(`[AcmeManager] Auto-responding '2' to renew certificate`);
          hasRespondedToRenewal = true;
          try {
            certbot.stdin.write('2\n');
          } catch (err) {
            console.error(`[AcmeManager] Failed to send response to certbot:`, err.message);
          }
        }

        // Parse certbot output to extract DNS challenge details
        // Multiple patterns to support different certbot versions:
        // Pattern 1: "_acme-challenge.example.com with the following value: token"
        // Pattern 2: "Please deploy a DNS TXT record under the name _acme-challenge.example.com with value: token"
        // Pattern 3: "_acme-challenge.example.com. with value token"

        // Try to extract domain
        if (!dnsDomain) {
          const patterns = [
            /_acme-challenge\.([^\s.]+(?:\.[^\s.]+)*)/,
            /under the name\s+_acme-challenge\.([^\s]+)/,
            /_acme-challenge\.([^\s]+)\s+with/
          ];

          for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
              dnsDomain = `_acme-challenge.${match[1].replace(/\.$/, '')}`;
              console.log(`[AcmeManager] Extracted DNS domain: ${dnsDomain}`);
              break;
            }
          }
        }

        // Try to extract token
        if (!dnsToken) {
          const patterns = [
            /with the following value:\s*([A-Za-z0-9_-]+)/,
            /with value:\s*([A-Za-z0-9_-]+)/,
            /TXT value:\s*([A-Za-z0-9_-]+)/,
            /value\s+([A-Za-z0-9_-]{40,})/  // Tokens are usually 40+ chars
          ];

          for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
              dnsToken = match[1];
              console.log(`[AcmeManager] Extracted DNS token: ${dnsToken}`);
              break;
            }
          }
        }

        // If we have both token and domain, store the challenge
        if (dnsToken && dnsDomain && !this.dnsChallengePending.has(domainId)) {
          const expiresAt = new Date(Date.now() + this.dnsValidationTimeout).toISOString();

          // Store in memory map
          this.dnsChallengePending.set(domainId, {
            process: certbot,
            token: dnsToken,
            domain: dnsDomain,
            originalDomain: domain,
            expiresAt
          });

          // Update database
          await database.updateDomainDNSChallenge(domainId, dnsToken, dnsDomain, expiresAt);

          console.log(`[AcmeManager] SUCCESS: DNS challenge ready for ${domain}`);
          console.log(`[AcmeManager] TXT Record: ${dnsDomain} = ${dnsToken}`);
        }
      });

      certbot.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[AcmeManager DNS Error] ${data.toString().trim()}`);
      });

      certbot.on('error', (error) => {
        this.running.delete(domain);
        this.dnsChallengePending.delete(domainId);
        console.error('[AcmeManager] Failed to spawn certbot:', error.message);
        console.error(`[AcmeManager] Command: certbot ${args.join(' ')}`);
        reject(new Error(`Failed to spawn certbot: ${error.message}`));
      });

      // Wait for token and domain to be extracted
      const checkInterval = setInterval(() => {
        if (dnsToken && dnsDomain) {
          clearInterval(checkInterval);
          resolve({
            token: dnsToken,
            domain: dnsDomain
          });
        }
      }, 100);

      // Timeout if no DNS challenge received within 60 seconds
      setTimeout(async () => {
        if (!dnsToken || !dnsDomain) {
          clearInterval(checkInterval);

          // Check if certificate was obtained without DNS challenge
          if (certificateObtainedWithoutDNS) {
            console.log(`[AcmeManager] SUCCESS: Certificate obtained successfully (via HTTP-01 fallback)`);

            // Update database
            try {
              const certPath = path.join(this.certDir, domain, 'fullchain.pem');
              const keyPath = path.join(this.certDir, domain, 'privkey.pem');
              const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

              await database.updateDomainSSLPaths(domainId, certPath, keyPath, expiresAt);
              await database.updateDomainSSLStatus(domainId, 'active', certPath, keyPath, expiresAt);

              // Store certificate in database
              await certificateManager.storeCertbotCertificateInDB(domainId, certPath, keyPath);

              console.log(`[AcmeManager] SSL info updated for ${domain}`);
            } catch (dbError) {
              console.error(`[AcmeManager] Failed to update database:`, dbError.message);
            }

            this.running.delete(domain);

            // Return special success code to indicate HTTP-01 was used
            reject(new Error('CERTIFICATE_OBTAINED_HTTP01'));
            return;
          }

          console.error(`[AcmeManager] Timeout waiting for DNS challenge from certbot`);
          console.error(`[AcmeManager] stdout: ${stdout}`);
          console.error(`[AcmeManager] stderr: ${stderr}`);

          try {
            certbot.kill('SIGTERM');
          } catch (err) {
            console.error(`[AcmeManager] Error killing certbot process:`, err.message);
          }

          this.running.delete(domain);
          this.dnsChallengePending.delete(domainId);

          let errorMsg = 'Timeout waiting for DNS challenge from certbot.';
          if (stderr.includes('already exists')) {
            errorMsg = 'A certificate already exists for this domain. Please delete it first.';
          } else if (stderr.includes('Certificate not yet due for renewal')) {
            errorMsg = 'Certificate already exists and is still valid. No renewal needed.';
          } else if (stderr) {
            errorMsg = `Certbot error: ${stderr.substring(0, 200)}`;
          }

          reject(new Error(errorMsg));
        }
      }, 60000);
    });
  }

  /**
   * Validate DNS challenge and complete certificate issuance
   * Called after user manually creates the TXT record
   */
  async validateDNSChallenge(domainId) {
    const pending = this.dnsChallengePending.get(domainId);

    if (!pending) {
      throw new Error('No pending DNS challenge found for this domain');
    }

    const { process: certbot, originalDomain, expiresAt } = pending;

    // Check if challenge expired
    if (new Date() > new Date(expiresAt)) {
      await this.cancelDNSChallenge(domainId);
      throw new Error('DNS challenge has expired. Please initiate a new request.');
    }

    console.log(`[AcmeManager] Validating DNS challenge for ${originalDomain}...`);

    // Update status to validating
    await database.updateDNSValidationStatus(domainId, 'validating');

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Capture stdout and stderr for better error reporting
      certbot.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`[AcmeManager DNS Validation] ${data.toString().trim()}`);
      });

      certbot.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(`[AcmeManager DNS Validation Error] ${data.toString().trim()}`);
      });

      // Send newline to certbot stdin to continue validation
      try {
        certbot.stdin.write('\n');
      } catch (error) {
        console.error(`[AcmeManager] Failed to send stdin to certbot:`, error.message);
        this.running.delete(originalDomain);
        this.dnsChallengePending.delete(domainId);
        database.updateDNSValidationStatus(domainId, 'failed').catch((dbError) => {
          console.error(`[AcmeManager] Failed to update DNS validation status:`, dbError.message);
        });
        return reject(new Error('Failed to communicate with certbot process'));
      }

      certbot.on('close', async (code) => {
        this.running.delete(originalDomain);
        this.dnsChallengePending.delete(domainId);

        if (code === 0) {
          console.log(`[AcmeManager] SUCCESS: Certificate obtained for ${originalDomain}`);

          // Update database - certificate is now available
          await database.updateDNSValidationStatus(domainId, 'completed');
          await database.clearDNSChallenge(domainId);

          // Update SSL certificate paths and expiration
          try {
            const certPath = path.join(this.certDir, originalDomain, 'fullchain.pem');
            const keyPath = path.join(this.certDir, originalDomain, 'privkey.pem');

            // Let's Encrypt certificates are valid for 90 days
            const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

            await database.updateDomainSSLPaths(domainId, certPath, keyPath, expiresAt);
            await database.updateDomainSSLStatus(domainId, 'active', certPath, keyPath, expiresAt);

            // Store certificate in database
            await certificateManager.storeCertbotCertificateInDB(domainId, certPath, keyPath);

            console.log(`[AcmeManager] SSL info updated for ${originalDomain} (expires: ${expiresAt})`);
          } catch (dbError) {
            console.error(`[AcmeManager] Failed to update SSL info in database:`, dbError.message);
          }

          resolve();
        } else {
          console.error(`[AcmeManager] ✗ DNS validation failed for ${originalDomain} (code ${code})`);
          console.error(`[AcmeManager] stderr: ${stderr}`);

          await database.updateDNSValidationStatus(domainId, 'failed');

          // Provide more detailed error message
          let errorMessage = `DNS validation failed with code ${code}`;
          if (stderr.includes('DNS problem')) {
            errorMessage = 'DNS validation failed: DNS record not found or not yet propagated';
          } else if (stderr.includes('rate limit')) {
            errorMessage = 'DNS validation failed: Let\'s Encrypt rate limit exceeded';
          } else if (stderr.includes('unauthorized')) {
            errorMessage = 'DNS validation failed: Unauthorized domain';
          }

          reject(new Error(errorMessage));
        }
      });

      // Timeout: 5 minutes for validation
      setTimeout(() => {
        if (this.dnsChallengePending.has(domainId)) {
          certbot.kill();
          this.dnsChallengePending.delete(domainId);
          this.running.delete(originalDomain);
          database.updateDNSValidationStatus(domainId, 'failed').catch((dbError) => {
            console.error(`[AcmeManager] Failed to update DNS validation status:`, dbError.message);
          });
          reject(new Error('DNS validation timeout'));
        }
      }, 300000);
    });
  }

  /**
   * Check if DNS TXT record has propagated
   */
  async checkDNSPropagation(domain, expectedValue) {
    const dns = await import('dns').then(m => m.promises);

    try {
      const records = await dns.resolveTxt(domain);
      const flatRecords = records.flat();

      const found = flatRecords.some(record => record === expectedValue);

      console.log(`[AcmeManager] DNS check for ${domain}: ${found ? 'FOUND' : 'NOT FOUND'}`);
      return found;
    } catch (error) {
      console.log(`[AcmeManager] DNS check failed for ${domain}:`, error.message);
      return false;
    }
  }

  /**
   * Cancel pending DNS challenge
   */
  async cancelDNSChallenge(domainId) {
    const pending = this.dnsChallengePending.get(domainId);

    if (pending) {
      pending.process.kill();
      this.running.delete(pending.originalDomain);
      this.dnsChallengePending.delete(domainId);
      await database.clearDNSChallenge(domainId);
      console.log(`[AcmeManager] Cancelled DNS challenge for domain ID ${domainId}`);
    }
  }
}

// Export singleton instance
export const acmeManager = new AcmeManager();
