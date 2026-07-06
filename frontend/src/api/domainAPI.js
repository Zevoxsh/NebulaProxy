import { api } from './instance';

export const domainAPI = {
  list: () => api.get('/domains'),
  get: (id) => api.get(`/domains/${id}`),
  create: (data) => api.post('/domains', data),
  update: (id, data) => api.put(`/domains/${id}`, data),
  delete: (id) => api.delete(`/domains/${id}`),
  toggleSSL: (id) => api.post(`/domains/${id}/ssl/enable`),
  toggle: (id) => api.post(`/domains/${id}/toggle`),
  checkRouting: (id) => api.get(`/domains/${id}/check-routing`),

  // Request logs
  getLogs: (id, params) => api.get(`/domains/${id}/logs`, { params }),
  getLogStats: (id, params) => api.get(`/domains/${id}/logs/stats`, { params }),
  getLogErrors: (id, params) => api.get(`/domains/${id}/logs/errors`, { params }),

  // Load Balancing / Backends
  getBackends: (id) => api.get(`/domains/${id}/backends`),
  createBackend: (id, data) => api.post(`/domains/${id}/backends`, data),
  updateBackend: (id, backendId, data) => api.put(`/domains/${id}/backends/${backendId}`, data),
  deleteBackend: (id, backendId) => api.delete(`/domains/${id}/backends/${backendId}`),
  toggleBackend: (id, backendId) => api.post(`/domains/${id}/backends/${backendId}/toggle`),
  updateLoadBalancing: (id, data) => api.put(`/domains/${id}/load-balancing`, data),

  // V3 Feature endpoints
  setMaintenance: (id, data) => api.put(`/domains/${id}/maintenance`, data),
  setErrorPages: (id, data) => api.put(`/domains/${id}/error-pages`, data),
  setRateLimit: (id, data) => api.put(`/domains/${id}/rate-limit`, data),
  setMirror: (id, data) => api.put(`/domains/${id}/mirror`, data),
  setGeoip: (id, data) => api.put(`/domains/${id}/geoip`, data),
  setStickySessions: (id, data) => api.put(`/domains/${id}/sticky-sessions`, data),
  setProxyProtocol: (id, data) => api.put(`/domains/${id}/proxy-protocol`, data),
  setGeyserProxyProtocol: (id, data) => api.put(`/domains/${id}/geyser-proxy-protocol`, data),
  setDdosProtection: (id, data) => api.put(`/domains/${id}/ddos-protection`, data),

  // Circuit breaker (admin)
  getCircuitBreakerStatus: () => api.get('/domains/circuit-breaker/status'),
  resetCircuitBreaker: (key) => api.post(`/domains/circuit-breaker/reset/${encodeURIComponent(key)}`),

  // Live traffic
  getAllLiveTraffic: () => api.get('/domains/traffic/live'),
  getLiveTraffic: (id) => api.get(`/domains/${id}/traffic/live`),
  clearLiveTraffic: (id) => api.delete(`/domains/${id}/traffic/live`)
};
