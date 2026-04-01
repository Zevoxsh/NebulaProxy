import { api } from './instance';

export const settingsAPI = {
  // Notification Settings
  getNotificationSettings: () => api.get('/settings/notifications'),
  updateNotificationSettings: (data) => api.put('/settings/notifications', data),
  testWebhook: () => api.post('/settings/notifications/test'),
  testEmail: () => api.post('/settings/notifications/test-email')
};
