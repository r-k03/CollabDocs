/**
 * API
 * 
 * Automatically attaches JWT token from localStorage
 * and handles 401 responses by clearing auth state (forcing re-login).
 */
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle expired tokens globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const register = (data) => api.post('/auth/register', data);
export const login = (data) => api.post('/auth/login', data);
export const getMe = () => api.get('/auth/me');


export const createDocument = (data) => api.post('/documents', data);
export const getDocuments = () => api.get('/documents');
export const getDocument = (id) => api.get(`/documents/${id}`);
export const updateDocument = (id, data) => api.put(`/documents/${id}`, data);
export const deleteDocument = (id) => api.delete(`/documents/${id}`);
export const shareDocument = (id, data) => api.post(`/documents/${id}/share`, data);
export const getDocumentHistory = (id) => api.get(`/documents/${id}/history`);
export const restoreDocument = (id, version) => api.post(`/documents/${id}/restore`, { version });

export default api;
