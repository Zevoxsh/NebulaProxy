import { api } from './instance';

export const analyticsAPI = {
  getStats: (timeRange = '24h') => api.get('/analytics/stats', { params: { timeRange } }),
  getTraffic: (timeRange = '24h') => api.get('/analytics/traffic', { params: { timeRange } }),
  getTopDomains: (timeRange = '24h', limit = 10) => api.get('/analytics/top-domains', { params: { timeRange, limit } }),
  getTopIps: (timeRange = '24h', limit = 20) => api.get('/analytics/top-ips', { params: { timeRange, limit } }),
  getTopPaths: (timeRange = '24h', limit = 20) => api.get('/analytics/top-paths', { params: { timeRange, limit } }),
  getStatusCodes: (timeRange = '24h') => api.get('/analytics/status-codes', { params: { timeRange } }),
  getTopUserAgents: (timeRange = '24h', limit = 15) => api.get('/analytics/top-user-agents', { params: { timeRange, limit } }),
  // Redis-backed endpoints
  getRealtimeHistory: () => api.get('/analytics/realtime-history'),
  getTraffic24h: () => api.get('/analytics/traffic-24h')
};
