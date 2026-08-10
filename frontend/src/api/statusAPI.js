import { api } from './instance';

export const statusAPI = {
  getStatus: () => api.get('/status')
};
