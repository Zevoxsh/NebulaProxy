import { api } from './instance';

export const monitoringAPI = {
  getServices: () => api.get('/monitoring/services'),
  getStats: () => api.get('/monitoring/stats'),
  refresh: () => api.post('/monitoring/refresh')
};
