import { api } from './instance';

export const smtpProxyAPI = {
  getStats: () => api.get('/smtp-proxy/stats'),
  restart: () => api.post('/smtp-proxy/restart'),
  getLogs: (params) => api.get('/smtp-proxy/logs', { params }),
  getSummary: () => api.get('/smtp-proxy/logs/summary')
};
