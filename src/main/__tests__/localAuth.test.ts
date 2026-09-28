import express from 'express'
import crypto from 'node:crypto'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createLocalAuthRouter,
  createSessionAuthenticator,
  requireSameOrigin
} from '../../../server/localAuth'

type Account = {
  id: string
  email: string
  password_salt: string
  password_hash: string
  recovery_hash: string
  family_id: string
}

class MemoryPool {
  families = new Map<string, string>()
  accounts = new Map<string, Account>()
  sessions = new Map<string, { accountId: string; expiresAt: number }>()
  statements: string[] = []

  async query(sql: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.statements.push(sql)
    if (sql.includes('FROM local_accounts WHERE email')) {
      const account = this.accounts.get(String(values[0]))
      return { rows: account ? [{ ...account }] : [] }
    }
    if (sql.includes('FROM local_sessions s')) {
      const session = this.sessions.get(String(values[0]))
      const account = session && session.expiresAt > Date.now()
        ? [...this.accounts.values()].find((item) => item.id === session.accountId)
        : undefined
      return { rows: account ? [{
        account_id: account.id,
        email: account.email,
        family_id: account.family_id
      }] : [] }
    }
    if (sql.startsWith('DELETE FROM local_sessions')) {
      this.sessions.delete(String(values[0]))
      return { rows: [] }
    }
    if (sql.startsWith('INSERT INTO local_sessions')) {
      this.sessions.set(String(values[1]), {
        accountId: String(values[0]),
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
      })
      return { rows: [] }
    }
    throw new Error(`Unexpected query: ${sql}`)
  }

  async connect(): Promise<{
    query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
    release: () => void
  }> {
    const familiesBefore = new Map(this.families)
    const accountsBefore = new Map(this.accounts)
    const sessionsBefore = new Map(this.sessions)
    let inTransaction = false
    const query = async (sql: string, values: unknown[] = []) => {
      this.statements.push(sql)
      if (sql === 'BEGIN') {
        inTransaction = true
        return { rows: [] }
      }
      if (sql === 'COMMIT') {
        inTransaction = false
        return { rows: [] }
      }
      if (sql === 'ROLLBACK') {
        if (inTransaction) {
          this.families = new Map(familiesBefore)
          this.accounts = new Map(accountsBefore)
          this.sessions = new Map(sessionsBefore)
        }
        inTransaction = false
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO families')) {
        this.families.set(String(values[0]), String(values[1]))
        return { rows: [] }
      }
      if (sql.includes('INSERT INTO local_accounts')) {
        const email = String(values[1])
        if (this.accounts.has(email)) throw Object.assign(new Error('duplicate'), { code: '23505' })
        const account = {
          id: String(values[0]),
          email,
          password_salt: String(values[2]),
          password_hash: String(values[3]),
          recovery_hash: String(values[4]),
          family_id: String(values[5])
        }
        this.accounts.set(email, account)
        return { rows: [] }
      }
      if (sql.includes('FROM local_accounts WHERE email = $1 FOR UPDATE')) {
        const account = this.accounts.get(String(values[0]))
        return { rows: account ? [{ ...account }] : [] }
      }
      if (sql.startsWith('UPDATE local_accounts')) {
        const account = [...this.accounts.values()].find((item) => item.id === String(values[3]))
        if (account) {
          account.password_salt = String(values[0])
          account.password_hash = String(values[1])
          account.recovery_hash = String(values[2])
        }
        return { rows: [] }
      }
      if (sql.startsWith('DELETE FROM local_sessions WHERE account_id')) {
        for (const [hash, session] of this.sessions) {
          if (session.accountId === String(values[0])) this.sessions.delete(hash)
        }
        return { rows: [] }
      }
      return this.query(sql, values)
    }
    return { query, release: () => undefined }
  }
}

async function startServer(pool: MemoryPool) {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use('/api', requireSameOrigin)
  app.use('/api/auth', createLocalAuthRouter(pool as unknown as Pool))
  app.get('/protected', createSessionAuthenticator(pool as unknown as Pool), (req, res) => {
    const authReq = req as express.Request & { userId?: string; familyId?: string; email?: string }
    res.json({ userId: authReq.userId, familyId: authReq.familyId, email: authReq.email })
  })
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test server address')
  const baseUrl = `http://localhost:${address.port}`
  return {
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

function origin(baseUrl: string): string {
  return new URL(baseUrl).origin
}

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie')?.match(/hikid_session=([^;]+)/)?.[1]
  if (!value) throw new Error('Session cookie not set')
  return `hikid_session=${value}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('self-hosted local authentication', () => {
  it('requires a same-origin request for mutations', async () => {
    const pool = new MemoryPool()
    const server = await startServer(pool)
    try {
      const missingOrigin = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent@example.com', password: 'a-long-secure-password' })
      })
      expect(missingOrigin.status).toBe(403)
      const crossOrigin = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { Origin: 'http://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent@example.com', password: 'a-long-secure-password' })
      })
      expect(crossOrigin.status).toBe(403)
      const viteProxyOrigin = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { Origin: 'http://localhost:5000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent@example.com', password: 'a-long-secure-password' })
      })
      expect(viteProxyOrigin.status).toBe(201)
      expect(pool.accounts.size).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('signs up, persists hashed sessions, logs in, and logs out', async () => {
    const pool = new MemoryPool()
    pool.families.set('legacy-family', 'clerk-user-123')
    const server = await startServer(pool)
    const sameOrigin = origin(server.baseUrl)
    try {
      const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ' Parent@Example.com ', password: 'a-long-secure-password' })
      })
      expect(signup.status).toBe(201)
      const signupBody = await signup.json()
      expect(signupBody.email).toBe('parent@example.com')
      expect(signupBody.recoveryCode).toMatch(/^[A-Za-z0-9_-]{32}$/)
      const signupCookie = sessionCookie(signup)
      expect(signup.headers.get('set-cookie')).toContain('HttpOnly')
      expect(signup.headers.get('set-cookie')).toContain('SameSite=Strict')
      expect(pool.sessions.size).toBe(1)
      expect([...pool.sessions.keys()][0]).not.toBe(decodeURIComponent(signupCookie.split('=')[1]))
      expect(pool.families.get('legacy-family')).toBe('clerk-user-123')
      const account = [...pool.accounts.values()][0]
      expect(pool.families.get(account.family_id)).toBe(`local:${account.id}`)
      expect(account.recovery_hash).toBe(
        crypto.createHash('sha256').update(signupBody.recoveryCode).digest('hex')
      )
      expect(account.recovery_hash).not.toBe(signupBody.recoveryCode)

      const me = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { Cookie: signupCookie }
      })
      expect(me.status).toBe(200)
      expect(await me.json()).toEqual({ email: 'parent@example.com' })

      const invalidLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'parent@example.com', password: 'incorrect-password' })
      })
      expect(invalidLogin.status).toBe(401)
      expect(await invalidLogin.json()).toEqual({ error: 'Invalid email or password' })

      const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'PARENT@example.com', password: 'a-long-secure-password' })
      })
      expect(login.status).toBe(200)
      expect(await login.json()).toEqual({ email: 'parent@example.com' })
      const loginCookie = sessionCookie(login)
      expect(pool.sessions.size).toBe(2)
      const protectedResponse = await fetch(`${server.baseUrl}/protected`, {
        headers: { Cookie: loginCookie }
      })
      expect(protectedResponse.status).toBe(200)
      const protectedAccount = await protectedResponse.json()
      expect(protectedAccount).toMatchObject({
        email: 'parent@example.com',
        familyId: [...pool.accounts.values()][0].family_id
      })
      expect(protectedAccount.userId).toBe([...pool.accounts.values()][0].id)

      const logout = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Origin: sameOrigin, Cookie: loginCookie }
      })
      expect(logout.status).toBe(204)
      expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(pool.sessions.size).toBe(1)
      const signedOut = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { Cookie: loginCookie }
      })
      expect(signedOut.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('uses secure cookies in production and rate limits login attempts', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const pool = new MemoryPool()
    const server = await startServer(pool)
    const sameOrigin = origin(server.baseUrl)
    try {
      const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'secure@example.com', password: 'a-long-secure-password' })
      })
      expect(signup.status).toBe(201)
      expect(signup.headers.get('set-cookie')).toContain('Secure')

      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(`${server.baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: {
            Origin: sameOrigin,
            'X-Forwarded-For': '198.51.100.10',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ email: 'invalid', password: 'bad' })
        })
        expect(response.status).toBe(401)
      }
      const limited = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: sameOrigin,
          'X-Forwarded-For': '198.51.100.10',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: 'invalid', password: 'bad' })
      })
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBeTruthy()
    } finally {
      await server.close()
    }
  })

  it('recovers only with the current code, rotates it, and revokes all sessions', async () => {
    const pool = new MemoryPool()
    const server = await startServer(pool)
    const sameOrigin = origin(server.baseUrl)
    try {
      const signup = await fetch(`${server.baseUrl}/api/auth/signup`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'recover@example.com', password: 'original-password-123' })
      })
      const signupBody = await signup.json()
      const signupCookie = sessionCookie(signup)
      const login = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'recover@example.com', password: 'original-password-123' })
      })
      expect(login.status).toBe(200)
      expect(pool.sessions.size).toBe(2)

      const invalidKnown = await fetch(`${server.baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'recover@example.com',
          recoveryCode: 'wrong-code',
          newPassword: 'new-secure-password-123'
        })
      })
      const invalidUnknown = await fetch(`${server.baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unknown@example.com',
          recoveryCode: 'wrong-code',
          newPassword: 'new-secure-password-123'
        })
      })
      expect(invalidKnown.status).toBe(400)
      expect(await invalidKnown.json()).toEqual({ error: 'Could not recover account' })
      expect(invalidUnknown.status).toBe(400)
      expect(await invalidUnknown.json()).toEqual({ error: 'Could not recover account' })

      const recovery = await fetch(`${server.baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'recover@example.com',
          recoveryCode: signupBody.recoveryCode,
          newPassword: 'new-secure-password-123'
        })
      })
      expect(recovery.status).toBe(200)
      const recoveryBody = await recovery.json()
      expect(recoveryBody.email).toBe('recover@example.com')
      expect(recoveryBody.recoveryCode).toMatch(/^[A-Za-z0-9_-]{32}$/)
      expect(recoveryBody.recoveryCode).not.toBe(signupBody.recoveryCode)
      expect(recovery.headers.get('set-cookie')).toContain('Max-Age=0')
      expect(pool.sessions.size).toBe(0)
      expect(pool.statements.some((statement) => statement.includes('FOR UPDATE'))).toBe(true)

      const oldCode = await fetch(`${server.baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'recover@example.com',
          recoveryCode: signupBody.recoveryCode,
          newPassword: 'another-secure-password-456'
        })
      })
      expect(oldCode.status).toBe(400)

      const signIn = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { Origin: sameOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'recover@example.com', password: 'new-secure-password-123' })
      })
      expect(signIn.status).toBe(200)
      const revoked = await fetch(`${server.baseUrl}/api/auth/me`, {
        headers: { Cookie: signupCookie }
      })
      expect(revoked.status).toBe(401)
    } finally {
      await server.close()
    }
  })

  it('rate limits recovery attempts without revealing account existence', async () => {
    const pool = new MemoryPool()
    const server = await startServer(pool)
    const sameOrigin = origin(server.baseUrl)
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        const response = await fetch(`${server.baseUrl}/api/auth/recover`, {
          method: 'POST',
          headers: {
            Origin: sameOrigin,
            'X-Forwarded-For': '198.51.100.11',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: 'not-an-email',
            recoveryCode: 'bad',
            newPassword: 'short'
          })
        })
        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({ error: 'Could not recover account' })
      }
      const limited = await fetch(`${server.baseUrl}/api/auth/recover`, {
        method: 'POST',
        headers: {
          Origin: sameOrigin,
          'X-Forwarded-For': '198.51.100.11',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: 'nobody@example.com',
          recoveryCode: 'bad',
          newPassword: 'new-secure-password-123'
        })
      })
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBeTruthy()
    } finally {
      await server.close()
    }
  })
})