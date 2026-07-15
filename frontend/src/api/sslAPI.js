import { api } from './instance';

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
  cancelDNS: (domainId) => api.post(`/ssl/cancel-dns/${domainId}`),

  // Event history
  getEvents: (domainId, limit = 50) => api.get(`/ssl/events/${domainId}`, { params: { limit } })
};
