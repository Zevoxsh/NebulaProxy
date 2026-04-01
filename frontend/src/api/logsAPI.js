import { api } from './instance';

export const logsAPI = {
  getLogs: (params) => api.get('/logs', { params }),
  getStats: () => api.get('/logs/stats'),
  export: (params) => api.get('/logs/export', { params, responseType: 'blob' }),
  exportCsv: (params) => api.get('/logs/export', { params: { ...params, format: 'csv' }, responseType: 'blob' })
};
