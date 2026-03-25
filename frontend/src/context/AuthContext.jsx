/**
 * AuthContext – provides JWT token, user info, login and logout helpers
 * to the entire React application via useContext.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../hooks/useApi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('crm_token'))
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Fetch current user profile when a token is present
  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }

    api.get('/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => setUser(res.data))
      .catch(() => {
        // Invalid/expired token – clear it
        localStorage.removeItem('crm_token')
        setToken(null)
      })
      .finally(() => setLoading(false))
  }, [token])

  const login = useCallback((newToken, userData) => {
    localStorage.setItem('crm_token', newToken)
    setToken(newToken)
    setUser(userData)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch (_) { /* ignore */ }
    localStorage.removeItem('crm_token')
    setToken(null)
    setUser(null)
  }, [token])

  return (
    <AuthContext.Provider value={{ token, user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
