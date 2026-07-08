// Auto-extracted from httpProxy.js — do not edit directly.
// Mixed into HttpProxy.prototype in httpProxy.js.


import tls from 'tls';
import selfsigned from 'selfsigned';
import { logger } from '../../../utils/logger.js';
import { database } from '../../database.js';
import { certificateManager } from '../../certificateManager.js';

// Static fallback cert — always available synchronously, never causes ERR_SSL_VERSION_OR_CIPHER_MISMATCH.
// Browser will show an untrusted-cert warning instead, which is far better than a protocol error.
const STATIC_FALLBACK_CERT = `-----BEGIN CERTIFICATE-----
MIIDRTCCAi2gAwIBAgIUVj4nRuFovZbiILI57710dAngnpcwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVbmVidWxhLnByb3h5LmZhbGxiYWNrMCAXDTI2MDYxNTEz
NDcyMFoYDzIxMjYwNTIyMTM0NzIwWjAgMR4wHAYDVQQDDBVuZWJ1bGEucHJveHku
ZmFsbGJhY2swggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDEoc6awSok
eqW0sXVN/eVikshX6F2sDgK/rKQd2c7aKzxQWcwcjZmOT+z1rLvUtEYgJHz0bA4p
dCJPICKUy1cz4GSMWnL0fwGKJC8cd7hXEYl8AxjVsB2MUvZggeJXpIpJ2zpyZL+j
UefPRO0OyD+S47SBbPScjtnr8zOa+j3w/g10UR20Ukxj1glg3DFq8AdWGzp/xRBt
7YMrmPcyf1MgnkAEGoIcAjJdNwq89UuG5Wr+OF/q1hv2JYEhK2fqiGK2ybpK81I6
O+9ZT+/Op+JPkvv5XxpRFjLNaRQEPViQBmU5xqh5nuf+PaDRSIDNQfi+GyBMjz07
Ym98DHYXyV9zAgMBAAGjdTBzMB0GA1UdDgQWBBQf+1hNrFKYkdN/QvRmc0Rhn+Sb
2TAfBgNVHSMEGDAWgBQf+1hNrFKYkdN/QvRmc0Rhn+Sb2TAPBgNVHRMBAf8EBTAD
AQH/MCAGA1UdEQQZMBeCFW5lYnVsYS5wcm94eS5mYWxsYmFjazANBgkqhkiG9w0B
AQsFAAOCAQEAc9KuD6uFV90gC35kQX8ksxYBo4LngWXW361d4qyzSx8WsZ8XdBHF
hOfYRiZzsAU+CeLpbwFMdFpnSv8TDfmNKcvusldWy6r9vL5VyvshDUkRF9NfDukG
6nJT9rSXRz7uBm/jrGApBQl9oC6JWxgd8LSU74NhwLRNE6CRf2nNyjOX+P5FDI4N
3lR8hLPozWGCTaFsl3qiIfDPpD5hxg51zl5JyMAET1KSX3+YJD8hegISA5sGUAWJ
tQEHUpfCiYkXT2Vneo+XUD2SK4uihjAa07cBgSRjieNUPPxIWNCbSSb46OKrOsZf
A7UJvt2HC5/mFrtqF3S4aT+dnxrzhk7ixQ==
-----END CERTIFICATE-----`;

const STATIC_FALLBACK_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDEoc6awSokeqW0
sXVN/eVikshX6F2sDgK/rKQd2c7aKzxQWcwcjZmOT+z1rLvUtEYgJHz0bA4pdCJP
ICKUy1cz4GSMWnL0fwGKJC8cd7hXEYl8AxjVsB2MUvZggeJXpIpJ2zpyZL+jUefP
RO0OyD+S47SBbPScjtnr8zOa+j3w/g10UR20Ukxj1glg3DFq8AdWGzp/xRBt7YMr
mPcyf1MgnkAEGoIcAjJdNwq89UuG5Wr+OF/q1hv2JYEhK2fqiGK2ybpK81I6O+9Z
T+/Op+JPkvv5XxpRFjLNaRQEPViQBmU5xqh5nuf+PaDRSIDNQfi+GyBMjz07Ym98
DHYXyV9zAgMBAAECggEANblH67xvOTxRXgdGV6LRM5eLKYmRXlsNoTUYOheyjqVV
e1atj/eYRuvLgGxLfZgruMh/Y4DKdcUHQrsy95h/IOtkTXzA/9BbqVStkoebVB60
g6+M74WI7TgVnNSf9PY92mQNmgew3Hyaa2UXp/xKcmXIgbw1MTlOjUsLhIJuvhMQ
+Z3Qb7JJCtIS9AYEwlfNbnoAkqelbGA++F1zw3GNh2PPqlqeSVfuxnp60eCtOhAH
2uh2c6OVngtdd2XwJe2phRMYaBHQukUBVvXICLLYM5elCM1nse/eAh4J3jBHlLhE
U0bLFnswy/wPmDpe/g69wOJEQ0xliF39f/h2ddGmkQKBgQDrHU9jmhgKLvgfCorC
Y0+mB9/6zk+Guzc778qa+Vbf16/kD23G0O3E+YPGvHn9CwawcyCPoCQ4/2jG15XD
FTCRJYZ5+m23PtAjqwPmCb8JxAE3q9knVQPaziAM7/IPXkttzUpclPlgJLg9YXAL
BhjDQJTGieWwbBGAcLBurRgSnQKBgQDWGWA6hiiiYVBvyGwDxPdk54fddta6G2YG
X8yzMVVFfidNism3bwTe30sNJ2es6yOVakqa9oOpPQGz7b/4Ga9SzPx9M94mHkCJ
8bvTWS8sdi73ZLwvNmjBQEc5+RIaB2KYyPEYxyJEWgJZZXdsiTsN3V7umOCcGLkh
oJdE46vVTwKBgH6KyvTXtgKdHwxN9zsCipbY/DMYIXNphiPrPsfEVX6qrs93gmUU
hDSU+tjXDm0kJxiHDkpfLb/Dr9f9pmxWFkq4wLUcFTsgQpQ/8hw4uKp/5QvaoUjr
F+UHNfbgmg6teLmDWXeU8tdNTCA1NkGoqWFFfA2ToJ0gvRa9ECixXxh9AoGAPLbb
hB0xfsLsBZcnknYT1iiWbeZahFJqv1oBebt+vANHcATwqTUxg2Z9KRDIpM/VunR3
DbTkp2Smi/jbHKdkAa4h1/uSfurLUJMduZSr/QbS0NNfTmA2mr74s+b/DCSWAE/T
lzw5anq/+cv9bukHtynU1wLBh2K3dWLOIvoRa58CgYA8jz+Y9O68+MSxFLyVvTF5
n14Ft7btkh753xL9hOQAMIkcRlxW13OtzplZkOkZ0R9Hu/EZKF2k6fZRqukvRVxl
lMLfj0hSNIRwKvuKj6lBT/Amcgh26gXd2pAKXWLC0fMR75070cxZK6GWy0WOkdU3
eiXEG3i7T7TnEV/vJRyWhQ==
-----END PRIVATE KEY-----`;

const STATIC_FALLBACK_CONTEXT = tls.createSecureContext({ cert: STATIC_FALLBACK_CERT, key: STATIC_FALLBACK_KEY });

export { STATIC_FALLBACK_CERT, STATIC_FALLBACK_KEY };

export class SniHandler {
async _getSniContext(servername, callback) {
try {
  if (!servername) {
    return callback(null, STATIC_FALLBACK_CONTEXT);
  }

  // Check cache
  const cached = this.secureContextCache.get(servername);
  if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
    if (cached.expiresAt && Date.now() > cached.expiresAt) {
      logger.warn(`[ProxyManager] Cached certificate expired for ${servername}, reloading...`);
      this.secureContextCache.delete(servername);
    } else {
      return callback(null, cached.context);
    }
  }

  // Load certificate from database
  const certData = await certificateManager.loadCertificate(servername);

  let context;
  let expiresAt = null;
  let shouldRetryAcme = false;

  if (certData) {
    try {
      const certInfo = certificateManager.parseCertificateMetadata(certData.cert);
      if (certInfo && certInfo.expiresAt) {
        expiresAt = new Date(certInfo.expiresAt).getTime();
      }
    } catch (err) {
      logger.warn(`[ProxyManager] Failed to parse cert expiration for ${servername}:`, err.message);
    }
    context = tls.createSecureContext({ cert: certData.cert, key: certData.key });
  } else {
    logger.warn(`[ProxyManager] No certificate in DB for ${servername}, using static fallback`);
    context = STATIC_FALLBACK_CONTEXT;
    shouldRetryAcme = true;
  }

  // Short TTL for the static fallback so we retry on a future request. For a
  // missing cert specifically, this doubles as ACME retry backoff (~4
  // attempts/hour per hostname — safely under Let's Encrypt's 5/hour
  // failed-validation limit) instead of falling back silently forever.
  this.secureContextCache.set(servername, {
    context,
    timestamp: Date.now(),
    expiresAt: expiresAt || (Date.now() + (shouldRetryAcme ? 15 : 5) * 60 * 1000)
  });

  if (shouldRetryAcme && this.acmeManager) {
    // Fire-and-forget — a certbot run can take several seconds and must not
    // block this TLS handshake. On success the real cert lands in the DB and
    // the next SNI lookup (after this fallback's TTL) picks it up.
    this._loadCertificateForDomain(servername).catch((err) => {
      logger.warn(`[ProxyManager] Background cert retry failed for ${servername}:`, err.message);
    });
  }

  callback(null, context);
} catch (error) {
  logger.error(`[ProxyManager] Failed to create secure context for ${servername}:`, error.message);
  callback(null, STATIC_FALLBACK_CONTEXT);
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
    // Pre-cache a self-signed cert for this hostname so the next TLS request
    // gets a valid context immediately without a CN mismatch.
    // Use a short TTL (5 min) so we retry the real cert soon.
    try {
      const fallbackSelfSigned = await this._generateSelfSignedCert(hostname);
      this.secureContextCache.set(hostname, {
        context: tls.createSecureContext({ cert: fallbackSelfSigned.cert, key: fallbackSelfSigned.private }),
        timestamp: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
        isNebulaFallback: true
      });
    } catch (_) {
      // If self-signed generation also fails, pre-cache the static fallback
      // so the next TLS request gets a cert instead of a handshake error
      this.secureContextCache.set(hostname, {
        context: STATIC_FALLBACK_CONTEXT,
        timestamp: Date.now(),
        expiresAt: Date.now() + 5 * 60 * 1000,
        isNebulaFallback: true
      });
    }
  }
}
}

/**
 * Generate self-signed certificate
 */
async _generateSelfSignedCert(hostname) {
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
const pems = await selfsigned.generate(attrs, {
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
