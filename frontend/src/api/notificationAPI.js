import { api } from './instance';

export const notificationAPI = {
  list: (params) => api.get('/notifications', { params }),
  getCount: () => api.get('/notifications/count'),
  markAsRead: (id) => api.post(`/notifications/${id}/read`),
  markAllAsRead: () => api.post('/notifications/read-all'),
  getPreferences: () => api.get('/notification-preferences'),
  updatePreferences: (data) => api.put('/notification-preferences', data),
  testWebhook: () => api.post('/notification-preferences/test'),
};
