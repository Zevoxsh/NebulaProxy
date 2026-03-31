import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { toast } from '../hooks/use-toast';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL: apiBaseUrl,
  withCredentials: true,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Debounce network error toasts so we don't spam the user
let _lastNetworkToast = 0;
function showNetworkError(title, description) {
  const now = Date.now();
  if (now - _lastNetworkToast < 5000) return;
  _lastNetworkToast = now;
  toast({ variant: 'destructive', title, description });
}

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (status === 401) {
      // Clear auth state and redirect to login
      useAuthStore.getState().logout();

      // Avoid redirect loop on public auth pages
      const currentPath = window.location.pathname;
      if (
        currentPath !== '/login'
        && currentPath !== '/register'
        && currentPath !== '/reset-password'
        && currentPath !== '/admin/pin-reset'
      ) {
        window.location.href = '/login';
      }
    } else if (status >= 500) {
      showNetworkError('Erreur serveur', 'Le serveur a retourné une erreur. Réessayez dans quelques instants.');
    } else if (!error.response) {
      // Network error or timeout
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      showNetworkError(
        isTimeout ? 'Délai dépassé' : 'Erreur réseau',
        isTimeout
          ? 'La requête a pris trop de temps. Vérifiez votre connexion.'
          : 'Impossible de joindre le serveur. Vérifiez votre connexion.'
      );
    }

    return Promise.reject(error);
  }
);

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

export const proxyAPI = {
  forward: (targetUrl, method = 'GET', data = null, headers = {}) => {
    return api({
      method,
      url: '/proxy/',
      params: { url: targetUrl },
      data,
      headers
    });
  }
};

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
  clearLiveTraffic: (id) => api.delete(`/domains/${id}/traffic/live`),
};

export const redirectionAPI = {
  list: () => api.get('/redirections'),
  get: (id) => api.get(`/redirections/${id}`),
  create: (data) => api.post('/redirections', data),
  update: (id, data) => api.put(`/redirections/${id}`, data),
  delete: (id) => api.delete(`/redirections/${id}`),
  toggle: (id) => api.post(`/redirections/${id}/toggle`),
  getStats: (id) => api.get(`/redirections/${id}/stats`)
};

export const adminAPI = {
  listUsers: () => api.get('/admin/users'),
  getUser: (id) => api.get(`/admin/users/${id}`),
  updateQuotas: (id, quotas) => api.put(`/admin/users/${id}/quotas`, quotas),
  toggleUser: (id) => api.post(`/admin/users/${id}/toggle`),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  getStats: () => api.get('/admin/stats'),
  getAuditLogs: (params) => api.get('/admin/audit-logs', { params }),

  // Admin domain management
  getAllDomains: () => api.get('/admin/domains'),
  updateDomain: (id, data) => api.put(`/admin/domains/${id}`, data),
  deleteDomain: (id) => api.delete(`/admin/domains/${id}`),

  // DDoS protection
  getDdosBans: (params) => api.get('/admin/ddos/bans', { params }),
  createDdosBan: (data) => api.post('/admin/ddos/bans', data),
  deleteDdosBan: (id) => api.delete(`/admin/ddos/bans/${id}`),
  getDdosStats: () => api.get('/admin/ddos/stats'),
  getDdosBlocklists: () => api.get('/admin/ddos/blocklists'),
  syncDdosBlocklists: () => api.post('/admin/ddos/blocklists/sync'),
  getDdosWhitelist: () => api.get('/admin/ddos/whitelist'),
  createDdosWhitelist: (data) => api.post('/admin/ddos/whitelist', data),
  deleteDdosWhitelist: (id) => api.delete(`/admin/ddos/whitelist/${id}`),
  getDdosEvents: (params) => api.get('/admin/ddos/events', { params }),
  getDdosEventStats: () => api.get('/admin/ddos/events/stats'),
  getChallengeTypes: () => api.get('/admin/ddos/challenge-types'),
  setChallengeTypes: (enabledIds) => api.put('/admin/ddos/challenge-types', { enabledIds }),

  // Live traffic (all domains)
  getAdminLiveTraffic: () => api.get('/admin/traffic/live'),
  clearAdminLiveTraffic: () => api.delete('/admin/traffic/live'),

  // Admin team management
  getAllTeams: () => api.get('/admin/teams'),
  updateTeamQuota: (id, data) => api.put(`/admin/teams/${id}/quotas`, data),

  // Admin redirection management
  getAllRedirections: () => api.get('/admin/redirections'),
  updateRedirection: (id, data) => api.put(`/admin/redirections/${id}`, data),
  deleteRedirection: (id) => api.delete(`/admin/redirections/${id}`),
  toggleRedirection: (id) => api.post(`/admin/redirections/${id}/toggle`)
  ,
  // Admin config
  getRedisConfig: () => api.get('/admin/config/redis'),
  updateRedisConfig: (data) => api.put('/admin/config/redis', data),
  getConfig: () => api.get('/admin/config'),
  validateConfig: (data) => api.post('/admin/config/validate', data),
  updateConfig: (data) => api.put('/admin/config', data),
  exportConfig: () => api.get('/admin/config/export'),

  // Admin branding
  getBranding: () => api.get('/admin/branding'),
  updateBranding: (data) => api.put('/admin/branding', data),

  // Admin monitoring
  getSystemMetrics: () => api.get('/admin/monitoring/metrics'),
  getSystemLogs: (lines = 50) => api.get('/admin/monitoring/logs', { params: { lines } }),
  getProcessList: () => api.get('/admin/monitoring/processes'),

  // Admin database backups
  getDatabaseStats: () => api.get('/admin/database/stats'),
  listDatabaseBackups: () => api.get('/admin/database/backups'),
  createDatabaseBackup: () => api.post('/admin/database/backups'),
  getLatestDatabaseBackupJob: () => api.get('/admin/database/backups/jobs/latest'),
  getDatabaseBackupJob: (jobId) => api.get(`/admin/database/backups/jobs/${encodeURIComponent(jobId)}`),
  downloadDatabaseBackup: (filename) => api.get(`/admin/database/backups/${encodeURIComponent(filename)}/download`, { responseType: 'blob' }),
  deleteDatabaseBackup: (filename) => api.delete(`/admin/database/backups/${encodeURIComponent(filename)}`),
  restoreDatabaseBackup: (filename) => api.post(`/admin/database/backups/${encodeURIComponent(filename)}/restore`),

  // Admin S3 cloud backup
  getS3BackupConfig: () => api.get('/admin/backups/s3/config'),
  saveS3BackupConfig: (config) => api.put('/admin/backups/s3/config', config),
  testS3BackupConnection: () => api.post('/admin/backups/s3/test'),
  listS3Backups: () => api.get('/admin/backups/s3/list'),
  uploadBackupToS3: (filename) => api.post(`/admin/backups/s3/upload/${encodeURIComponent(filename)}`),
  getS3UploadJob: (jobId) => api.get(`/admin/backups/s3/jobs/${jobId}`),
  deleteS3Backup: (key) => {
    const encoded = btoa(key).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return api.delete(`/admin/backups/s3/${encoded}`);
  },

  // Admin services (Docker)
  listContainers: () => api.get('/admin/services/containers'),
  startContainer: (name) => api.post(`/admin/services/containers/${name}/start`),
  stopContainer: (name) => api.post(`/admin/services/containers/${name}/stop`),
  restartContainer: (name) => api.post(`/admin/services/containers/${name}/restart`),
  getContainerLogs: (name, lines = 50) => api.get(`/admin/services/containers/${name}/logs`, { params: { lines } }),

  // Admin notifications
  getNotificationConfig: () => api.get('/admin/notifications/config'),
  updateNotificationConfig: (data) => api.put('/admin/notifications/config', data),
  testNotification: (type) => api.post(`/admin/notifications/test/${type}`),

  // User creation (local mode only)
  createUser: (data) => api.post('/admin/users', data),

  // Registration configuration
  getRegistrationConfig: () => api.get('/admin/registration-config'),
  updateRegistrationConfig: (data) => api.put('/admin/registration-config', data),

  // URL Blocking Rules
  getUrlBlockingRules: (domainId) => api.get(`/url-blocking/domains/${domainId}/rules`),
  createUrlBlockingRule: (domainId, data) => api.post(`/url-blocking/domains/${domainId}/rules`, data),
  updateUrlBlockingRule: (ruleId, data) => api.put(`/url-blocking/rules/${ruleId}`, data),
  deleteUrlBlockingRule: (ruleId) => api.delete(`/url-blocking/rules/${ruleId}`),
  testUrlPattern: (pattern, pattern_type, test_paths) =>
    api.post('/url-blocking/rules/test', { pattern, pattern_type, test_paths })
};

export const teamAPI = {
  list: () => api.get('/teams'),
  get: (id) => api.get(`/teams/${id}`),
  create: (data) => api.post('/teams', data),
  update: (id, data) => api.put(`/teams/${id}`, data),
  delete: (id) => api.delete(`/teams/${id}`),

  // Team members
  getMembers: (id) => api.get(`/teams/${id}/members`),
  addMember: (id, username, permissions) => api.post(`/teams/${id}/members`, { username, permissions }),
  removeMember: (id, memberId) => api.delete(`/teams/${id}/members/${memberId}`),
  updateMemberPermissions: (id, memberId, permissions) => api.put(`/teams/${id}/members/${memberId}/permissions`, { permissions }),

  // Team domains
  getDomains: (id) => api.get(`/teams/${id}/domains`),
  assignDomain: (id, domainId) => api.post(`/teams/${id}/domains/${domainId}`),
  removeDomain: (id, domainId) => api.delete(`/teams/${id}/domains/${domainId}`),

  // Team invitations
  sendInvitation: (id, username, permissions) => api.post(`/teams/${id}/invitations`, { username, permissions }),
  getInvitations: (id) => api.get(`/teams/${id}/invitations`),
  cancelInvitation: (id, invitationId) => api.delete(`/teams/${id}/invitations/${invitationId}`),
  getMyInvitations: () => api.get('/teams/invitations/me'),
  getMyInvitationsCount: () => api.get('/teams/invitations/me/count'),
  acceptInvitation: (invitationId) => api.post(`/teams/invitations/${invitationId}/accept`),
  rejectInvitation: (invitationId) => api.post(`/teams/invitations/${invitationId}/reject`),

  // Team notification settings
  getNotificationSettings: (id) => api.get(`/teams/${id}/notifications`),
  updateNotificationSettings: (id, data) => api.put(`/teams/${id}/notifications`, data),
  testNotification: (id) => api.post(`/teams/${id}/notifications/test`),

  // Team logo
  uploadLogo: (id, formData) => api.post(`/teams/${id}/logo`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  deleteLogo: (id) => api.delete(`/teams/${id}/logo`)
};

export const domainGroupAPI = {
  // Get all accessible groups
  list: () => api.get('/domain-groups'),

  // Get specific group with domains
  get: (id) => api.get(`/domain-groups/${id}`),

  // Create new group
  create: (data) => api.post('/domain-groups', data),

  // Update group
  update: (id, data) => api.put(`/domain-groups/${id}`, data),

  // Delete group
  delete: (id) => api.delete(`/domain-groups/${id}`),

  // Assign domain to group
  assignDomain: (groupId, domainId) => api.post(`/domain-groups/${groupId}/domains/${domainId}`),

  // Remove domain from group
  removeDomain: (groupId, domainId) => api.delete(`/domain-groups/${groupId}/domains/${domainId}`),

  // Bulk assign domains
  bulkAssignDomains: (groupId, domainIds) => api.post(`/domain-groups/${groupId}/domains/bulk`, { domainIds }),

  // Get group members
  getMembers: (groupId) => api.get(`/domain-groups/${groupId}/members`),

  // Add member to group
  addMember: (groupId, userId, permissions) => api.post(`/domain-groups/${groupId}/members`, { userId, permissions }),

  // Update member permissions
  updateMemberPermissions: (groupId, memberId, permissions) => api.put(`/domain-groups/${groupId}/members/${memberId}/permissions`, { permissions }),

  // Remove member from group
  removeMember: (groupId, memberId) => api.delete(`/domain-groups/${groupId}/members/${memberId}`)
};

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

export const logsAPI = {
  getLogs: (params) => api.get('/logs', { params }),
  getStats: () => api.get('/logs/stats'),
  export: (params) => api.get('/logs/export', { params, responseType: 'blob' }),
  exportCsv: (params) => api.get('/logs/export', { params: { ...params, format: 'csv' }, responseType: 'blob' })
};

export const monitoringAPI = {
  getServices: () => api.get('/monitoring/services'),
  getStats: () => api.get('/monitoring/stats'),
  refresh: () => api.post('/monitoring/refresh')
};

export const sslAPI = {
  getCertificates: () => api.get('/ssl/certificates'),
  getStats: () => api.get('/ssl/stats'),
  renew: (domainId) => api.post(`/ssl/renew/${domainId}`),
  toggleAutoRenew: (domainId, autoRenew) => api.put(`/ssl/auto-renew/${domainId}`, { autoRenew }),
  download: (domainId) => api.get(`/ssl/download/${domainId}`, { responseType: 'blob' }),
  upload: (data) => api.post('/ssl/upload', data),

  // Certificate detail methods
  getCertificateDetails: (domainId) => api.get(`/ssl/certificate-details/${domainId}`),
  deleteCertificate: (domainId) => api.delete(`/ssl/certificate/${domainId}`),
  downloadCertificatePart: (domainId, type) => api.get(`/ssl/download-part/${domainId}/${type}`, { responseType: 'text' }),

  // DNS-01 Challenge Methods
  requestDNS: (domainId) => api.post(`/ssl/request-dns/${domainId}`),
  getDNSInstructions: (domainId) => api.get(`/ssl/dns-instructions/${domainId}`),
  validateDNS: (domainId, checkDNSFirst = false) =>
    api.post(`/ssl/validate-dns/${domainId}`, { checkDNSFirst }),
  checkDNSPropagation: (domainId) => api.post(`/ssl/check-dns/${domainId}`),
  cancelDNS: (domainId) => api.post(`/ssl/cancel-dns/${domainId}`)
};

export const wildcardCertAPI = {
  getAll: () => api.get('/ssl/wildcards'),
  generate: (hostname) => api.post('/ssl/wildcards/generate', { hostname }),
  upload: (hostname, fullchain, privateKey) => api.post('/ssl/wildcards/upload', { hostname, fullchain, privateKey }),
  delete: (id) => api.delete(`/ssl/wildcards/${id}`)
};

export const settingsAPI = {
  // Notification Settings
  getNotificationSettings: () => api.get('/settings/notifications'),
  updateNotificationSettings: (data) => api.put('/settings/notifications', data),
  testWebhook: () => api.post('/settings/notifications/test'),
  testEmail: () => api.post('/settings/notifications/test-email')
};

export const apiKeysAPI = {
  list: () => api.get('/api-keys'),
  get: (id) => api.get(`/api-keys/${id}`),
  create: (data) => api.post('/api-keys', data),
  update: (id, data) => api.put(`/api-keys/${id}`, data),
  delete: (id) => api.delete(`/api-keys/${id}`),
  getUsage: (id, days = 7) => api.get(`/api-keys/${id}/usage`, { params: { days } }),
  getAvailableScopes: () => api.get('/api-keys/scopes/available')
};

export const smtpProxyAPI = {
  getStats: () => api.get('/smtp-proxy/stats'),
  restart: () => api.post('/smtp-proxy/restart'),
  getLogs: (params) => api.get('/smtp-proxy/logs', { params }),
  getSummary: () => api.get('/smtp-proxy/logs/summary')
};

export const statusAPI = {
  getStatus: () => api.get('/status')
};

export const notificationAPI = {
  list: (params) => api.get('/notifications', { params }),
  getCount: () => api.get('/notifications/count'),
  markAsRead: (id) => api.post(`/notifications/${id}/read`),
  markAllAsRead: () => api.post('/notifications/read-all')
};

export default api;
