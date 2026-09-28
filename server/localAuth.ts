import crypto from 'node:crypto'
import express from 'express'
import type { Pool } from 'pg'

const SESSION_COOKIE = 'hikid_session'
const SESSION_SECONDS = 60 * 60 * 24 * 30
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10
const PASSWORD_BYTES = 64
const RECOVERY_CODE_BYTES = 24
const INVALID_RECOVERY_HASH = crypto.createHash('sha256').update('invalid-recovery-code').digest()

type SessionRequest = express.Request & {
  userId?: string
  familyId?: string
  email?: string
}

type RateEntry = { count: number; resetAt: number }
const authAttempts = new Map<string, RateEntry>()

function passwordHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_BYTES, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024
    }, (error, derived) => error ? reject(error) : resolve(derived))
  })
}

const dummyPasswordHash = passwordHash(
  'not-a-real-account-password',
  Buffer.from('68696b69642d617574682d64756d6d79', 'hex')
)

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}

function cookieValue(req: express.Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}

function sessionCookie(token: string, production: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${production ? '; Secure' : ''}`
}

function clearAuthCookies(production: boolean): string[] {
  const secure = production ? '; Secure' : ''
  return [
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    `hikid_parent_grant=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  ]
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function recoveryHash(code: string): Buffer {
  return crypto.createHash('sha256').update(code).digest()
}

function rateLimited(req: express.Request, endpoint: string, res: express.Response): boolean {
  const key = `${endpoint}:${req.ip || req.socket.remoteAddress || 'unknown'}`
  const now = Date.now()
  for (const [entryKey, entry] of authAttempts) {
    if (entry.resetAt <= now) authAttempts.delete(entryKey)
  }
  const entry = authAttempts.get(key)
  if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)))
    res.status(429).json({ error: 'Too many attempts. Try again later.' })
    return true
  }
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
  } else {
    entry.count += 1
  }
  return false
}

export function sameOriginRequest(req: express.Request): boolean {
  const origin = req.get('origin')
  if (!origin) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim()
  const expectedHost = forwardedHost || req.get('host')
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const expectedProtocol = forwardedProto ? `${forwardedProto}:` : `${req.protocol}:`
  if (!expectedHost || parsed.protocol !== expectedProtocol) return false
  if (parsed.host.toLowerCase() === expectedHost.toLowerCase()) return true
  // Vite's dev proxy changes Host to localhost:3000 while preserving the
  // browser's public Replit preview origin. Only allow that exact development
  // domain; deployed requests must match the forwarded public host.
  if (process.env.NODE_ENV === 'production' || forwardedHost) return false
  try {
    const expected = new URL(`${expectedProtocol}//${expectedHost}`)
    const loopback = new Set(['localhost', '127.0.0.1', '[::1]'])
    const previewHost = process.env.REPLIT_DEV_DOMAIN
    if (loopback.has(expected.hostname) && previewHost &&
        parsed.protocol === 'https:' && parsed.hostname === previewHost &&
        !parsed.port) return true
    return expected.hostname === parsed.hostname && loopback.has(parsed.hostname)
  } catch {
    return false
  }
}

export function requireSameOrigin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase()) || sameOriginRequest(req)) {
    next()
    return
  }
  res.status(403).json({ error: 'Request origin could not be verified' })
}

export function createSessionAuthenticator(pool: Pool): express.RequestHandler {
  return async (req: SessionRequest, res, next) => {
    const token = cookieValue(req, SESSION_COOKIE)
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    try {
      const result = await pool.query(
        `SELECT a.id AS account_id, a.email, a.family_id
         FROM local_sessions s
         JOIN local_accounts a ON a.id = s.account_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [tokenHash(token)]
      )
      const account = result.rows[0]
      if (!account) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      req.userId = account.account_id as string
      req.familyId = account.family_id as string
      req.email = account.email as string
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function createLocalAuthRouter(pool: Pool): express.Router {
  const router = express.Router()
  const production = process.env.NODE_ENV === 'production'
  const authenticated = createSessionAuthenticator(pool)

  router.get('/me', authenticated, (req: SessionRequest, res) => {
    res.json({ email: req.email })
  })

  router.post('/signup', async (req, res) => {
    if (rateLimited(req, 'signup', res)) return
    const email = normalizeEmail(req.body?.email)
    const password = req.body?.password
    if (!email || typeof password !== 'string' || password.length < 12 || password.length > 128) {
      res.status(400).json({ error: 'Enter a valid email and a password of 12–128 characters' })
      return
    }
    const accountId = crypto.randomUUID()
    const familyId = crypto.randomUUID()
    const passwordSalt = crypto.randomBytes(16)
    const passwordDigest = await passwordHash(password, passwordSalt)
    const recoveryCode = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('base64url')
    const sessionToken = crypto.randomBytes(32).toString('base64url')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      // Never look up or attach a family by email: this identifier is unique to
      // the new account and cannot claim an existing Clerk-owned family.
      await client.query(
        'INSERT INTO families (id, clerk_user_id) VALUES ($1, $2)',
        [familyId, `local:${accountId}`]
      )
      await client.query(
        `INSERT INTO local_accounts (id, email, password_salt, password_hash, recovery_hash, family_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, email, passwordSalt.toString('hex'), passwordDigest.toString('hex'),
          recoveryHash(recoveryCode).toString('hex'), familyId]
      )
      await client.query(
        `INSERT INTO local_sessions (account_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [accountId, tokenHash(sessionToken)]
      )
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      if ((error as { code?: string })?.code === '23505') {
        res.status(409).json({ error: 'An account with this email already exists' })
        return
      }
      res.status(500).json({ error: 'Could not create account' })
      return
    } finally {
      client.release()
    }
    res.setHeader('Set-Cookie', [
      sessionCookie(sessionToken, production),
      ...clearAuthCookies(production).slice(1)
    ])
    res.status(201).json({ email, recoveryCode })
  })

  router.post('/login', async (req, res) => {
    if (rateLimited(req, 'login', res)) return
    const email = normalizeEmail(req.body?.email)
    const password = req.body?.password
    if (!email || typeof password !== 'string' || password.length > 128) {
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }
    try {
      const result = await pool.query(
        `SELECT id, email, password_salt, password_hash, family_id
         FROM local_accounts WHERE email = $1`,
        [email]
      )
      const account = result.rows[0]
      const salt = account
        ? Buffer.from(account.password_salt as string, 'hex')
        : Buffer.from('68696b69642d617574682d64756d6d79', 'hex')
      const expected = account
        ? Buffer.from(account.password_hash as string, 'hex')
        : await dummyPasswordHash
      const candidate = await passwordHash(password, salt)
      const valid = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)
      if (!account || !valid) {
        res.status(401).json({ error: 'Invalid email or password' })
        return
      }
      const token = crypto.randomBytes(32).toString('base64url')
      await pool.query(
        `INSERT INTO local_sessions (account_id, token_hash, expires_at)
         VALUES ($1, $2, now() + interval '30 days')`,
        [account.id, tokenHash(token)]
      )
      res.setHeader('Set-Cookie', [
        sessionCookie(token, production),
        ...clearAuthCookies(production).slice(1)
      ])
      res.json({ email: account.email })
    } catch {
      res.status(500).json({ error: 'Could not sign in' })
    }
  })

  router.post('/recover', async (req, res) => {
    if (rateLimited(req, 'recover', res)) return
    const email = normalizeEmail(req.body?.email)
    const recoveryCode = typeof req.body?.recoveryCode === 'string' &&
      req.body.recoveryCode.length <= 128 ? req.body.recoveryCode : ''
    const newPassword = req.body?.newPassword
    if (!email || !recoveryCode || typeof newPassword !== 'string' ||
        newPassword.length < 12 || newPassword.length > 128) {
      res.status(400).json({ error: 'Could not recover account' })
      return
    }

    const client = await pool.connect()
    let transactionOpen = false
    try {
      await client.query('BEGIN')
      transactionOpen = true
      const result = await client.query(
        `SELECT id, email, password_salt, recovery_hash
         FROM local_accounts WHERE email = $1 FOR UPDATE`,
        [email]
      )
      const account = result.rows[0]
      const suppliedHash = recoveryHash(recoveryCode)
      const savedHash = account && typeof account.recovery_hash === 'string'
        ? Buffer.from(account.recovery_hash, 'hex')
        : INVALID_RECOVERY_HASH
      const matches = suppliedHash.length === savedHash.length &&
        crypto.timingSafeEqual(suppliedHash, savedHash)
      if (!account || !matches) {
        await client.query('ROLLBACK')
        transactionOpen = false
        res.status(400).json({ error: 'Could not recover account' })
        return
      }

      const passwordSalt = crypto.randomBytes(16)
      const passwordDigest = await passwordHash(newPassword, passwordSalt)
      const nextRecoveryCode = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('base64url')
      await client.query(
        `UPDATE local_accounts
         SET password_salt = $1, password_hash = $2, recovery_hash = $3
         WHERE id = $4`,
        [passwordSalt.toString('hex'), passwordDigest.toString('hex'),
          recoveryHash(nextRecoveryCode).toString('hex'), account.id]
      )
      await client.query('DELETE FROM local_sessions WHERE account_id = $1', [account.id])
      await client.query('COMMIT')
      transactionOpen = false
      res.setHeader('Set-Cookie', clearAuthCookies(production))
      res.json({ email: account.email, recoveryCode: nextRecoveryCode })
    } catch {
      if (transactionOpen) await client.query('ROLLBACK')
      res.status(500).json({ error: 'Could not recover account' })
    } finally {
      client.release()
    }
  })

  router.post('/logout', async (req, res) => {
    const token = cookieValue(req, SESSION_COOKIE)
    if (token) {
      try {
        await pool.query('DELETE FROM local_sessions WHERE token_hash = $1', [tokenHash(token)])
      } catch {
        res.status(500).json({ error: 'Could not sign out' })
        return
      }
    }
    res.setHeader('Set-Cookie', clearAuthCookies(production))
    res.status(204).end()
  })

  return router
}