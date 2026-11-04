export class AuthError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

export function createAuthApi(fetchRequest = (...args) => fetch(...args)) {
  async function request(path, options = {}) {
    let response
    try {
      response = await fetchRequest(`/api/auth${path}`, {
        credentials: 'same-origin', cache: 'no-store', ...options,
      })
    } catch {
      throw new AuthError('Cannot reach the server. Please try again.')
    }
    let data
    try { data = await response.json() } catch {
      throw new AuthError('The server returned an unexpected response.', response.status)
    }
    if (!response.ok) {
      const fallback = response.status === 429
        ? 'Too many login attempts. Please try again later.' : 'The request could not be completed.'
      throw new AuthError(typeof data?.error === 'string' ? data.error : fallback, response.status)
    }
    return data
  }

  async function post(path, body = {}) {
    // Fetch for each mutation: login rotates the session, and another tab may too.
    // Tokens stay in memory; cookies remain managed by the browser.
    const { csrfToken } = await request('/csrf')
    if (typeof csrfToken !== 'string' || !csrfToken) {
      throw new AuthError('Unable to prepare a secure request. Please try again.')
    }
    return request(path, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken,
    }, body: JSON.stringify(body) })
  }

  return {
    async me() {
      try {
        const user = await request('/me')
        if (!Number.isInteger(user?.userId) || user.userId <= 0) {
          throw new AuthError('The server returned an unexpected account response.')
        }
        return user
      } catch (error) {
        if (error.status === 401) return null
        throw error
      }
    },
    login: (credentials) => post('/login', credentials),
    register: (account) => post('/register', account),
    logout: () => post('/logout'),
  }
}

export const authApi = createAuthApi()
