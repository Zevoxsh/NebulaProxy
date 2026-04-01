import { api } from './instance';

export const userAPI = {
  getMe: () => api.get('/user/me'),
  getPermissions: () => api.get('/user/permissions'),
  updateProfile: (data) => api.put('/user/profile', data),
  getPasskeyPromptStatus: () => api.get('/user/passkey-prompt/status'),
  respondPasskeyPrompt: (action) => api.post('/user/passkey-prompt/response', { action }),
  listPasskeys: () => api.get('/user/passkeys'),
  getPasskeyRegistrationOptions: () => api.post('/user/passkeys/register/options'),
  verifyPasskeyRegistration: (data) => api.post('/user/passkeys/register/verify', data),
  deletePasskey: (id) => api.delete(`/user/passkeys/${id}`)
};
