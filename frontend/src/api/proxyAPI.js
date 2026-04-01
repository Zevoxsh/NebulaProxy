import { api } from './instance';

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
