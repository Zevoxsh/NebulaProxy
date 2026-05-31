// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.


import { logger } from '../../../utils/logger.js';
export class SniHandler {
async _getSniContext(servername, callback) {
try {
  if (!servername) {
    return callback(null, this.defaultSecureContext);
  }

  // Check cache
  const cached = this.secureContextCache.get(servername);
  if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
    // SECURITY FIX: Check if cached certificate is expired
    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      logger.warn(`[ProxyManager] Cached certificate expired for ${servername}, reloading...`);
      this.secureContextCache.delete(servername);
    } else {
      return callback(null, cached.context);
    }
  }

  // Load certificate from database ONLY (no file fallback)
  let cert, key, expiresAt = null;

  const certData = await certificateManager.loadCertificate(servername);

  if (certData) {
    cert = certData.cert;
    key = certData.key;

    // Extract expiration date from certificate
    try {
      const certInfo = certificateManager.parseCertificateMetadata(cert);
      if (certInfo && certInfo.expiresAt) {
        expiresAt = new Date(certInfo.expiresAt).getTime();
      }
    } catch (err) {
      logger.warn(`[ProxyManager] Failed to parse cert expiration for ${servername}:`, err.message);
    }
  }

  // Fallback to Nebula default certificate if no real cert available
  if (!cert || !key) {
    logger.warn(`[ProxyManager] No certificate in DB for ${servername}, serving Nebula default fallback`);
    // Use the pre-generated default context — guaranteed to exist and never cause a cipher mismatch
    if (this.defaultSecureContext) {
      return callback(null, this.defaultSecureContext);
    }
    // Absolute last resort: try a fresh self-signed cert (should never reach here)
    try {
      const selfSigned = this._generateSelfSignedCert(servername);
      cert = selfSigned.cert;
      key = selfSigned.private;
      expiresAt = Date.now() + (365 * 24 * 60 * 60 * 1000);
    } catch (genErr) {
      logger.error(`[ProxyManager] Self-signed generation failed for ${servername}:`, genErr.message);
      return callback(null, this.defaultSecureContext);
    }
  }

  const context = tls.createSecureContext({ cert, key });

  // Cache it with expiration timestamp
  this.secureContextCache.set(servername, {
    context,
    timestamp: Date.now(),
    expiresAt
  });

  callback(null, context);
} catch (error) {
  logger.error(`[ProxyManager] Failed to create secure context for ${servername}:`, error.message);
  // Always fall back to the Nebula default — never pass an error to the TLS callback
  // (doing so causes ERR_SSL_VERSION_OR_CIPHER_MISMATCH in browsers)
  if (this.defaultSecureContext) {
    return callback(null, this.defaultSecureContext);
  }
  // If even defaultSecureContext is missing (startup issue), try one more time
  try {
    const emergency = this._generateSelfSignedCert('nebula.default.local');
    callback(null, tls.createSecureContext({ cert: emergency.cert, key: emergency.private }));
  } catch (fallbackError) {
    logger.error(`[ProxyManager] Emergency fallback cert failed for ${servername}:`, fallbackError.message);
    callback(error);
  }
}
}

/**
 * Load certificate for a domain (ACME or self-signed)
 */
async _loadCertificateForDomain(hostname) {
// Clear cache to force reload
this.secureContextCache.delete(hostname);

// Try to ensure ACME certificate exists
if (this.acmeManager) {
  try {
    if (this._isIpAddress(hostname)) {
      logger.info(`[ProxyManager] Skipping ACME for IP address ${hostname}`);
      return;
    }

    // Get domain info to check challenge type
    const domain = await database.getDomainByHostname(hostname);

    // Only auto-request certificate for HTTP-01 challenges
    // DNS-01 challenges must be done manually through the web interface
    if (domain && domain.acme_challenge_type === 'http-01') {
      await this.acmeManager.ensureCert(hostname);
      logger.info(`[ProxyManager] ACME certificate loaded for ${hostname}`);
    } else if (domain && domain.acme_challenge_type === 'dns-01') {
      logger.info(`[ProxyManager] Domain ${hostname} requires DNS-01 challenge (manual setup required)`);
    } else {
      await this.acmeManager.ensureCert(hostname);
      logger.info(`[ProxyManager] ACME certificate loaded for ${hostname}`);
    }
  } catch (error) {
    logger.warn(`[ProxyManager] Failed to load ACME cert for ${hostname}, will use Nebula default fallback:`, error.message);
    // Pre-cache the Nebula default context for this hostname so the next TLS request
    // gets a valid context immediately instead of hitting a cipher-mismatch error.
    // Use a short TTL (5 min) so we retry the real cert soon.
    if (this.defaultSecureContext) {
      this.secureContextCache.set(hostname, {
        context: this.defaultSecureContext,
        timestamp: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes — retries cert after expiry
        isNebulaFallback: true
      });
    }
  }
}
}

/**
 * Generate self-signed certificate
 */
_generateSelfSignedCert(hostname) {
const safeHost = hostname && typeof hostname === 'string' ? hostname : 'default.local';
const attrs = [{ name: 'commonName', value: safeHost }];
const extensions = [];

if (this._isIpAddress(safeHost)) {
  extensions.push({
    name: 'subjectAltName',
    altNames: [{ type: 7, ip: safeHost }]
  });
} else {
  extensions.push({
    name: 'subjectAltName',
    altNames: [{ type: 2, value: safeHost }]
  });
}
const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
  extensions
});

return pems;
}

/**
 * Handle ACME HTTP-01 challenge
 * SECURITY: Prevents path traversal attacks
 */
}
