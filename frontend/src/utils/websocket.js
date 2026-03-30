export function resolveWebSocketUrl(path, options = {}) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  const wsBaseUrl = options.wsBaseUrl || import.meta.env.VITE_WS_BASE_URL;
  if (wsBaseUrl) {
    return joinBaseAndPath(wsBaseUrl, normalizedPath);
  }

  const apiBaseUrl = options.apiBaseUrl || import.meta.env.VITE_API_BASE_URL;
  if (apiBaseUrl && /^https?:\/\//i.test(apiBaseUrl)) {
    try {
      const apiUrl = new URL(apiBaseUrl);
      const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${apiUrl.host}${normalizedPath}`;
    } catch (error) {
      // Fall through to window location
    }
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalizedPath}`;
}

function joinBaseAndPath(base, path) {
  if (/^https?:\/\//i.test(base)) {
    const protocol = base.startsWith('https://') ? 'wss://' : 'ws://';
    const normalizedBase = base.replace(/^https?:\/\//i, protocol);
    return normalizedBase.replace(/\/$/, '') + path;
  }

  if (/^wss?:\/\//i.test(base)) {
    return base.replace(/\/$/, '') + path;
  }

  // Relative base (e.g. '/ws')
  if (base.startsWith('/')) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${base.replace(/\/$/, '')}${path}`;
  }

  return base.replace(/\/$/, '') + path;
}
