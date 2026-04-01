import { api } from './instance';

export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  getPasskeyOptions: (data = {}) => api.post('/auth/passkey/options', data),
  verifyPasskeyLogin: (data) => api.post('/auth/passkey/verify', data),
  getAdminPinStatus: () => api.get('/auth/admin-pin/status'),
  setupAdminPin: (pin) => api.post('/auth/admin-pin/setup', { pin }),
  verifyAdminPin: (pin) => api.post('/auth/admin-pin/verify', { pin }),
  requestAdminPinReset: () => api.post('/auth/admin-pin/reset/request'),
  confirmAdminPinReset: (token, pin) => api.post('/auth/admin-pin/reset/confirm', { token, pin }),
  request2faChallenge: (data) => api.post('/auth/2fa/challenge', data),
  verify2fa: (data) => api.post('/auth/2fa/verify', data),
  requestPasswordReset: (identifier) => api.post('/auth/password-reset/request', { identifier }),
  confirmPasswordReset: (payload) => api.post('/auth/password-reset/confirm', payload),
  changeBootstrapPassword: (newPassword) => api.post('/auth/bootstrap/change-password', { newPassword }),
  get2faStatus: () => api.get('/auth/2fa/status'),
  initTotp2fa: () => api.post('/auth/2fa/totp/init'),
  enableTotp2fa: (data) => api.post('/auth/2fa/totp/enable', data),
  initEmail2fa: () => api.post('/auth/2fa/email/enable/init'),
  verifyEmail2fa: (data) => api.post('/auth/2fa/email/enable/verify', data),
  initDisableEmail2fa: () => api.post('/auth/2fa/email/disable/init'),
  disable2fa: (data) => api.post('/auth/2fa/disable', data),
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  verify: () => api.get('/auth/verify'),
  getMode: () => api.get('/auth/mode'),
  testLDAP: () => api.get('/auth/test-ldap')
};
