/**
 * Axios instance pre-configured with the API base URL.
 * Automatically attaches the JWT token from localStorage to every request.
 */

import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api',
})

// Request interceptor – attach JWT if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('crm_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor – redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('crm_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
