import md5 from 'blueimp-md5';

/**
 * Generate a Gravatar URL from an email address
 * @param {string} email - User's email address
 * @param {number} size - Image size (default: 80)
 * @param {string} defaultImage - Default image type if no Gravatar exists
 *                                Options: '404', 'mp', 'identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'blank'
 * @returns {string|null} Gravatar URL
 */
export function getGravatarUrl(email, size = 80, defaultImage = 'identicon') {
  if (!email) {
    return null;
  }

  // Normalize email: trim and lowercase (as per Gravatar specification)
  const normalizedEmail = email.trim().toLowerCase();

  // Generate MD5 hash
  const hash = md5(normalizedEmail);

  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultImage}`;
}

/**
 * Get avatar URL with Gravatar fallback
 * @param {string} avatarUrl - Custom avatar URL
 * @param {string} email - User's email for Gravatar fallback
 * @param {number} size - Image size for Gravatar
 * @param {string|number} avatarUpdatedAt - Optional timestamp/date for cache busting
 * @returns {string|null} Avatar URL or null
 */
export function getAvatarUrl(avatarUrl, email, size = 80, avatarUpdatedAt = null) {
  if (avatarUrl) {
    // Add cache-busting parameter to custom avatar URLs
    let cacheBuster = '';
    if (avatarUpdatedAt) {
      // Convert date string to timestamp if needed
      const timestamp = typeof avatarUpdatedAt === 'string'
        ? new Date(avatarUpdatedAt).getTime()
        : avatarUpdatedAt;
      const separator = avatarUrl.includes('?') ? '&' : '?';
      cacheBuster = `${separator}t=${timestamp}`;
    }
    return `${avatarUrl}${cacheBuster}`;
  }

  if (email) {
    return getGravatarUrl(email, size);
  }

  return null;
}
