/**
 * Security utilities for input validation and sanitization
 */

import { URL } from 'url';
import dns from 'dns/promises';
import { config } from '../config/config.js';

/**
 * Sanitize hostname to prevent command injection
 * @param {string} hostname - The hostname to sanitize
 * @returns {string} - Sanitized hostname
 * @throws {Error} - If hostname is invalid
 */
export function sanitizeHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    throw new Error('Invalid hostname: must be a non-empty string');
  }

  // Only allow alphanumeric, dots, hyphens, and wildcards
  // Prevents command injection like: "example.com && rm -rf /"
  const hostnameRegex = /^[a-zA-Z0-9*.-]+$/;

  if (!hostnameRegex.test(hostname)) {
    throw new Error(`Invalid hostname format: ${hostname}`);
  }

  // Additional validation for wildcard domains
  if (hostname.startsWith('*.')) {
    const wildcardRegex = /^\*\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    if (!wildcardRegex.test(hostname)) {
      throw new Error(`Invalid wildcard domain format: ${hostname}`);
    }
  } else {
    // Regular hostname validation
    const regularRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    if (!regularRegex.test(hostname)) {
      throw new Error(`Invalid hostname format: ${hostname}`);
    }
  }

  return hostname;
}

/**
 * Validate backend URL to prevent SSRF attacks
 * @param {string} url - The URL to validate
 * @returns {string} - Validated URL
 * @throws {Error} - If URL is blocked or invalid
 */
export function validateBackendUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL: must be a non-empty string');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }

  // Blocked hostnames (localhost, metadata endpoints, etc.)
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal', // GCP metadata
    '::1', // IPv6 localhost
    'metadata', // Generic metadata
  ];

  const hostname = parsedUrl.hostname.toLowerCase();

  if (blockedHosts.includes(hostname)) {
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata') {
      throw new Error(`Blocked metadata endpoint: ${hostname}`);
    }
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  // Block private IP ranges (RFC1918)
  const privateRanges = [
    /^10\./,                          // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,                    // 192.168.0.0/16
    /^127\./,                         // 127.0.0.0/8 (loopback)
    /^169\.254\./,                    // 169.254.0.0/16 (link-local)
    /^::1$/,                           // IPv6 loopback
    /^fe80:/,                           // IPv6 link-local
    /^fc00:/                            // IPv6 unique local
  ];

  // Allow private/internal backends when explicitly enabled in config
  const allowPrivate = config?.proxy?.allowPrivateBackends === true;
  if (!allowPrivate) {
    for (const range of privateRanges) {
      if (range.test(hostname)) {
        throw new Error(`Private IP address not allowed: ${hostname}`);
      }
    }
  }

  // Only allow specific protocols
  const allowedProtocols = ['http:', 'https:', 'tcp:', 'udp:'];
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new Error(`Protocol not allowed: ${parsedUrl.protocol}`);
  }

  return url;
}

/**
 * Validate backend URL with DNS resolution (protects against DNS rebinding)
 * This should be called on EVERY proxy request, not just at configuration time
 * @param {string} url - The URL to validate
 * @returns {Promise<string>} - Validated URL
 * @throws {Error} - If URL resolves to blocked IP or DNS rebinding detected
 */
export async function validateBackendUrlWithDNS(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL: must be a non-empty string');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (err) {
    throw new Error(`Invalid URL format: ${err.message}`);
  }

  // Skip DNS validation if rebinding protection is disabled
  if (!config.security.dnsRebindingProtection) {
    return validateBackendUrl(url);
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Blocked hostnames (localhost, metadata endpoints, etc.)
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal', // GCP metadata
    '::1', // IPv6 localhost
    'metadata', // Generic metadata
  ];

  if (blockedHosts.includes(hostname)) {
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata') {
      throw new Error(`Blocked metadata endpoint: ${hostname}`);
    }
    throw new Error(`Blocked hostname: ${hostname}`);
  }

  // Only resolve DNS for hostnames (not IP addresses)
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  const isIpAddress = ipRegex.test(hostname);

  if (!isIpAddress) {
    // Resolve DNS to check if it points to private IP (DNS rebinding protection)
    try {
      const addresses = await dns.resolve4(hostname);

      // Check if any resolved IP is private
      const allowPrivate = config?.proxy?.allowPrivateBackends === true;
      if (!allowPrivate) {
        const privateRanges = [
          /^10\./,                          // 10.0.0.0/8
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
          /^192\.168\./,                    // 192.168.0.0/16
          /^127\./,                         // 127.0.0.0/8 (loopback)
          /^169\.254\./,                    // 169.254.0.0/16 (link-local)
        ];

        for (const ip of addresses) {
          for (const range of privateRanges) {
            if (range.test(ip)) {
              throw new Error(`DNS resolves to private IP: ${ip} (DNS rebinding attack detected)`);
            }
          }
        }
      }
    } catch (err) {
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        throw new Error(`DNS lookup failed for ${hostname}`);
      }
      throw err;
    }
  } else {
    // It's an IP address - validate with existing logic
    return validateBackendUrl(url);
  }

  // Final validation with original function
  return validateBackendUrl(url);
}

/**
 * Sanitize string for HTML output (prevent XSS)
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize object for audit logs (prevent XSS in logs)
 * @param {Object} obj - Object to sanitize
 * @returns {Object} - Sanitized object
 */
export function sanitizeAuditDetails(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeHtml(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditDetails(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} - True if valid
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;

  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate and sanitize team name
 * @param {string} name - Team name to validate
 * @returns {string} - Sanitized name
 * @throws {Error} - If name is invalid
 */
export function sanitizeTeamName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Team name must be a non-empty string');
  }

  // Trim whitespace
  name = name.trim();

  if (name.length < 3 || name.length > 50) {
    throw new Error('Team name must be between 3 and 50 characters');
  }

  // Only allow letters, numbers, spaces, hyphens, underscores
  const nameRegex = /^[a-zA-Z0-9\s-_]+$/;
  if (!nameRegex.test(name)) {
    throw new Error('Team name can only contain letters, numbers, spaces, hyphens, and underscores');
  }

  return name;
}

/**
 * Escape LIKE pattern wildcards to prevent SQL injection amplification
 * Escapes: % (matches any sequence), _ (matches any single character), \ (escape character)
 * @param {string} pattern - The search pattern to escape
 * @returns {string} - Escaped pattern safe for SQL LIKE
 */
export function escapeLikePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    return '';
  }

  // Escape backslash first, then % and _
  // PostgreSQL uses backslash as escape character in LIKE by default
  return pattern
    .replace(/\\/g, '\\\\')  // Backslash -> \\
    .replace(/%/g, '\\%')    // Percent -> \%
    .replace(/_/g, '\\_');   // Underscore -> \_
}

/**
 * Create secure temporary files with proper permissions and cleanup
 * SECURITY: Uses system tmpdir + crypto random + restrictive permissions
 * @param {Object} files - Object with file contents { name1: content1, name2: content2 }
 * @returns {Promise<Object>} - { paths: {name1: path1, name2: path2}, cleanup: Function }
 */
export async function createSecureTempFiles(files) {
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const crypto = await import('crypto');

  const tempDir = os.tmpdir();
  const randomSuffix = crypto.randomBytes(16).toString('hex');

  const createdFiles = {};
  const filePaths = {};

  try {
    // Create all temporary files
    for (const [name, content] of Object.entries(files)) {
      const fileName = `${name}-${randomSuffix}.tmp`;
      const filePath = path.join(tempDir, fileName);

      // Write with restrictive permissions (owner read/write only)
      await fs.writeFile(filePath, content, { mode: 0o600 });

      createdFiles[name] = filePath;
      filePaths[name] = filePath;
    }

    // Return paths and cleanup function
    return {
      paths: filePaths,
      cleanup: async () => {
        // Clean up all created files
        await Promise.allSettled(
          Object.values(createdFiles).map(path =>
            fs.unlink(path).catch(() => {
              // Ignore errors during cleanup
            })
          )
        );
      }
    };
  } catch (error) {
    // On error, clean up any files that were created
    await Promise.allSettled(
      Object.values(createdFiles).map(path =>
        fs.unlink(path).catch(() => {})
      )
    );
    throw error;
  }
}
