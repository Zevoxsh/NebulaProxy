import { api } from './instance';

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

  // Challenge types
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
  toggleRedirection: (id) => api.post(`/admin/redirections/${id}/toggle`),

  // Tunnel management
  getAllTunnels: () => api.get('/tunnels'),
  createTunnel: (data) => api.post('/tunnels', data),
  getTunnel: (id) => api.get(`/tunnels/${id}`),
  generateTunnelCode: (id, data) => api.post(`/tunnels/${id}/enrollment-code`, data),
  enrollTunnel: (data) => api.post('/tunnels/enroll', data),
  getTunnelBindings: (id) => api.get(`/tunnels/${id}/bindings`),
  createTunnelBinding: (id, data) => api.post(`/tunnels/${id}/bindings`, data),
  deleteTunnelBinding: (tunnelId, bindingId) => api.delete(`/tunnels/${tunnelId}/bindings/${bindingId}`),

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

  // Backup schedules (local / S3)
  getBackupSchedule: () => api.get('/admin/backups/schedule'),
  updateBackupSchedule: (schedule) => api.put('/admin/backups/schedule', schedule),

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
