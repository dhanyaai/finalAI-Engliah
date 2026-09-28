/**
 * HiKid web backend — Express API server (port 3000)
 * Proxied through the Vite dev server at /api so the browser only needs port 5000.
 *
 * Provides:
 *   GET  /api/config          — load persisted config
 *   POST /api/config          — save config
 *   GET  /api/deps            — always OK (no native binaries needed in web mode)
 *   POST /api/chat            — SSE-streaming LLM chat
 *   POST /api/interrupt       — abort current LLM request
 *   POST /api/reset           — clear conversation history
 */

import express from 'express'
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { promisify } from 'util'
import { Pool } from 'pg'
import { validateCurriculumInput, canPublishLesson } from '../src/shared/curriculum'
import {
  createLocalAuthRouter,
  createSessionAuthenticator,
  requireSameOrigin
} from './localAuth'

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hi-kid')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

const DEFAULT_SYSTEM_PROMPT = `You are a friendly English conversation partner named {{AI_NAME}}. Your goal is to help the user practice spoken English.

Rules:
- Always respond in English
- Keep responses concise (1-3 sentences) for natural conversation flow
- Be encouraging and supportive
- If the user makes grammar mistakes, gently correct them
- Ask follow-up questions to keep the conversation going
- Adapt to the user's level - if they're beginner, use simpler vocabulary
- Absolute prohibition of emoji usage / Emojis are strictly forbidden
`

interface AppConfig {
  version: number
  aiName: string
  systemPrompt: string
  baseUrl: string
  apiKey: string
  modelName: string
}

function getDefaultConfig(): AppConfig {
  // Prefer explicit overrides, then auto-detect from well-known env vars
  const hasOpenAI = !!process.env.OPENAI_API_KEY
  return {
    version: 1,
    aiName: 'Kitten',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    baseUrl:
      process.env.LLM_BASE_URL ??
      (hasOpenAI ? 'https://api.openai.com/v1' : 'http://localhost:11434/v1'),
    apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? 'ollama',
    modelName: process.env.LLM_MODEL ?? (hasOpenAI ? 'gpt-4o-mini' : 'qwen3:0.6b')
  }
}

function loadConfig(): AppConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      const defaults = getDefaultConfig()
      return {
        version: parsed.version ?? defaults.version,
        aiName: parsed.aiName?.trim() || defaults.aiName,
        systemPrompt: parsed.systemPrompt || defaults.systemPrompt,
        baseUrl: parsed.baseUrl?.trim() || defaults.baseUrl,
        apiKey: parsed.apiKey ?? defaults.apiKey,
        modelName: parsed.modelName?.trim() || defaults.modelName
      }
    }
  } catch (err) {
    console.warn('[Config] Failed to load, using defaults:', err)
  }
  return getDefaultConfig()
}

function saveConfig(config: AppConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  const tmp = `${CONFIG_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_FILE)
}

// ─── Conversation state ───────────────────────────────────────────────────────

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── Sentence splitter (mirrors agent.ts logic) ───────────────────────────────

function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/[.!?。！？]/.test(ch)) {
      const next = text[i + 1]
      if (next === undefined || /\s/.test(next) || /[.!?。！？]/.test(next)) {
        const sentence = text.slice(start, i + 1).trim()
        if (sentence) sentences.push(sentence)
        start = i + 1
        while (start < text.length && /\s/.test(text[start])) start++
        i = start - 1
      }
    }
  }
  return { sentences, remainder: text.slice(start) }
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express()
app.set('trust proxy', 1)
app.use(express.json())
app.use('/api', requireSameOrigin)

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
app.use('/api/auth', createLocalAuthRouter(pool))
const scrypt = promisify(crypto.scrypt)
const DEFAULT_SCORES = { Speaking: 34, Listening: 51, Reading: 28, Writing: 22, Vocabulary: 63, Grammar: 39 }
type AuthRequest = express.Request & { userId?: string; familyId?: string; email?: string }
const PARENT_GRANT_COOKIE = 'hikid_parent_grant'
const PARENT_GRANT_SECONDS = 15 * 60
const PIN_WINDOW_MS = 15 * 60 * 1000
const PIN_MAX_ATTEMPTS = 5
const pinAttempts = new Map<string, { count: number; resetAt: number }>()

const requireAuth = createSessionAuthenticator(pool)

async function familyIdFor(userId: string): Promise<string> {
  const result = await pool.query(
    'SELECT family_id FROM local_accounts WHERE id = $1',
    [userId]
  )
  const familyId = result.rows[0]?.family_id
  if (typeof familyId !== 'string') throw new Error('Authenticated family not found')
  return familyId
}

function authSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('SESSION_SECRET is required for parent authorization')
  return secret
}

function cookieValue(req: express.Request, name: string): string | undefined {
  const cookie = req.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : undefined
}

function parentGrant(userId: string, familyId: string): string {
  const payload = Buffer.from(JSON.stringify({
    userId,
    familyId,
    expiresAt: Date.now() + PARENT_GRANT_SECONDS * 1000
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function hasValidParentGrant(req: AuthRequest, familyId: string): boolean {
  const token = cookieValue(req, PARENT_GRANT_COOKIE)
  if (!token) return false
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return false
  const expected = crypto.createHmac('sha256', authSecret()).update(payload).digest()
  const received = Buffer.from(signature, 'base64url')
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return false
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      userId?: string
      familyId?: string
      expiresAt?: number
    }
    return parsed.userId === req.userId && parsed.familyId === familyId &&
      typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()
  } catch {
    return false
  }
}

function setParentGrant(res: express.Response, userId: string, familyId: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie',
    `${PARENT_GRANT_COOKIE}=${encodeURIComponent(parentGrant(userId, familyId))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${PARENT_GRANT_SECONDS}${secure}`)
}

async function requireParentAccess(req: AuthRequest, res: express.Response, next: express.NextFunction): Promise<void> {
  try {
    const familyId = await familyIdFor(req.userId!)
    const result = await pool.query('SELECT parent_pin_hash IS NOT NULL AS has_pin FROM families WHERE id=$1', [familyId])
    if (!result.rows[0]?.has_pin || hasValidParentGrant(req, familyId)) {
      next()
      return
    }
    res.status(403).json({ error: 'Parent PIN verification required' })
  } catch (error) {
    next(error)
  }
}

function curriculumLesson(row: Record<string, any>): Record<string, unknown> {
  return {
    id: row.id, courseLevel: row.level, unitId: row.unit_id, ageBands: row.age_bands, title: row.title,
    objective: row.objective, duration: row.duration, type: row.lesson_type,
    status: row.review_state === 'published' ? 'Published' : row.review_state,
    reviewState: row.review_state, video: row.video, subtitles: row.subtitles,
    transcript: row.transcript, vocabulary: row.vocabulary, activities: row.activities,
    assessment: row.assessment,
    review: { educatorApproved: row.educator_approved, ageSafetyApproved: row.age_safety_approved,
      reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, notes: row.review_notes },
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function cleanCurriculum(body: Record<string, unknown>, id?: string): Record<string, unknown> {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  const objective = typeof body.objective === 'string' ? body.objective.trim().slice(0, 500) : ''
  const level = typeof body.courseLevel === 'string' ? body.courseLevel : body.level
  const unitId = typeof body.unitId === 'string' ? body.unitId.slice(0, 40) : ''
  const ageBands = Array.isArray(body.ageBands) ? body.ageBands.filter((band): band is string => typeof band === 'string') : []
  const video = body.video as Record<string, unknown> | undefined
  const validation = validateCurriculumInput({title, objective, level, unitId, ageBands, video})
  if (validation) throw new Error(validation)
  return { id, title, objective, level, unitId, ageBands: JSON.stringify(ageBands), duration: Math.min(180, Math.max(1, Number(body.duration) || 10)),
    lessonType: typeof body.type === 'string' ? body.type.slice(0, 80) : 'Structured practice',
    video: JSON.stringify(video), subtitles: JSON.stringify(Array.isArray(body.subtitles) ? body.subtitles : []),
    transcript: typeof body.transcript === 'string' ? body.transcript.slice(0, 20000) : '',
    vocabulary: JSON.stringify(Array.isArray(body.vocabulary) ? body.vocabulary.slice(0, 30) : []),
    activities: JSON.stringify(Array.isArray(body.activities) ? body.activities : []),
    assessment: body.assessment ? JSON.stringify(body.assessment) : null }
}

app.get('/api/curriculum', requireAuth, async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM curriculum_lessons WHERE review_state = $1 ORDER BY level, unit_id, id', ['published'])
    res.json(result.rows.map(curriculumLesson))
  } catch (error) {
    console.error('[curriculum] load failed', error)
    res.status(500).json({ error: 'Could not load curriculum' })
  }
})

app.get('/api/admin/curriculum', requireAuth, requireParentAccess, async (_req: AuthRequest, res) => {
  try {
    const result = await pool.query('SELECT * FROM curriculum_lessons ORDER BY updated_at DESC, level, unit_id, id')
    res.json(result.rows.map(curriculumLesson))
  } catch { res.status(500).json({ error: 'Could not load curriculum studio' }) }
})

app.post('/api/curriculum/lessons', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  try {
    const input = cleanCurriculum(req.body as Record<string, unknown>)
    const id = `lesson-${crypto.randomUUID()}`
    const result = await pool.query(
      `INSERT INTO curriculum_lessons (id,level,unit_id,age_bands,title,objective,duration,lesson_type,video,subtitles,transcript,vocabulary,activities,assessment)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14::jsonb) RETURNING *`,
      [id,input.level,input.unitId,input.ageBands,input.title,input.objective,input.duration,input.lessonType,input.video,input.subtitles,input.transcript,input.vocabulary,input.activities,input.assessment])
    res.status(201).json(curriculumLesson(result.rows[0]))
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create lesson' }) }
})

app.put('/api/curriculum/lessons/:lessonId', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  try {
    const input = cleanCurriculum(req.body as Record<string, unknown>, req.params.lessonId.toString())
    const result = await pool.query(
      `UPDATE curriculum_lessons SET level=$2,unit_id=$3,age_bands=$4::jsonb,title=$5,objective=$6,duration=$7,lesson_type=$8,video=$9::jsonb,subtitles=$10::jsonb,transcript=$11,vocabulary=$12::jsonb,activities=$13::jsonb,assessment=$14::jsonb,review_state=CASE WHEN review_state='published' THEN 'draft' ELSE review_state END,updated_at=now()
       WHERE id=$1 RETURNING *`,
      [input.id,input.level,input.unitId,input.ageBands,input.title,input.objective,input.duration,input.lessonType,input.video,input.subtitles,input.transcript,input.vocabulary,input.activities,input.assessment])
    if (!result.rowCount) { res.status(404).json({ error: 'Lesson not found' }); return }
    res.json(curriculumLesson(result.rows[0]))
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Could not update lesson' }) }
})

app.post('/api/curriculum/lessons/:lessonId/review', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  try {
    const educator = typeof req.body?.educatorApproved === 'boolean' ? req.body.educatorApproved : undefined
    const safety = typeof req.body?.ageSafetyApproved === 'boolean' ? req.body.ageSafetyApproved : undefined
    const result = await pool.query(
      `UPDATE curriculum_lessons SET educator_approved=COALESCE($2,educator_approved), age_safety_approved=COALESCE($3,age_safety_approved),
       review_notes=COALESCE($4,review_notes), reviewed_by=$5, reviewed_at=now(),
       review_state=CASE WHEN COALESCE($2,educator_approved) AND COALESCE($3,age_safety_approved) THEN 'approved' ELSE 'in_review' END, updated_at=now()
       WHERE id=$1 RETURNING *`, [req.params.lessonId, educator, safety, typeof req.body?.notes === 'string' ? req.body.notes.slice(0,2000) : null, req.userId])
    if (!result.rowCount) { res.status(404).json({ error: 'Lesson not found' }); return }
    res.json(curriculumLesson(result.rows[0]))
  } catch { res.status(500).json({ error: 'Could not save review' }) }
})

app.post('/api/curriculum/lessons/:lessonId/publish', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  try {
    const check = await pool.query('SELECT educator_approved, age_safety_approved FROM curriculum_lessons WHERE id=$1', [req.params.lessonId])
    if (!check.rowCount || !canPublishLesson(check.rows[0])) { res.status(409).json({ error: 'Educator and age-safety approval are both required before publishing' }); return }
    const result = await pool.query(`UPDATE curriculum_lessons SET review_state='published',updated_at=now() WHERE id=$1 RETURNING *`, [req.params.lessonId])
    if (!result.rowCount) { res.status(409).json({ error: 'Educator and age-safety approval are both required before publishing' }); return }
    res.json(curriculumLesson(result.rows[0]))
  } catch { res.status(500).json({ error: 'Could not publish lesson' }) }
})

function cleanProfile(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const ageBand = body.ageBand
  const level = typeof body.level === 'string' ? body.level.trim().slice(0, 20) : ''
  const dailyGoalMinutes = Number(body.dailyGoalMinutes)
  if (!name || !['5–8', '9–12', '13–15'].includes(String(ageBand)) || !level ||
      !Number.isInteger(dailyGoalMinutes) || dailyGoalMinutes < 5 || dailyGoalMinutes > 180) {
    throw new Error('Invalid learner profile')
  }
  return { name, ageBand: String(ageBand), level, dailyGoalMinutes }
}

app.get('/api/family', requireAuth, async (req: AuthRequest, res) => {
  try {
    const familyId = await familyIdFor(req.userId!)
    const family = await pool.query(
      `SELECT daily_limit_minutes, privacy_settings, parent_pin_hash IS NOT NULL AS has_pin
       FROM families WHERE id = $1`,
      [familyId]
    )
    const children = await pool.query(
      `SELECT c.id, c.name, c.age_band, c.level, c.daily_goal_minutes,
              p.completed_lesson_ids, p.minutes, p.streak, p.skill_scores, p.assessments
       FROM child_profiles c
       JOIN child_progress p ON p.child_id = c.id
       WHERE c.family_id = $1 ORDER BY c.created_at`,
      [familyId]
    )
    res.json({
      settings: {
        dailyLimitMinutes: family.rows[0].daily_limit_minutes,
        privacySettings: family.rows[0].privacy_settings,
        hasPin: family.rows[0].has_pin
      },
      children: children.rows.map((row) => ({
        id: row.id,
        profile: { name: row.name, ageBand: row.age_band, level: row.level, dailyGoalMinutes: row.daily_goal_minutes },
        progress: {
          completedLessonIds: row.completed_lesson_ids,
          minutes: row.minutes,
          streak: row.streak,
          skillScores: row.skill_scores,
          assessments: row.assessments
        }
      }))
    })
  } catch (error) {
    console.error('[family] load failed', error)
    res.status(500).json({ error: 'Could not load family data' })
  }
})

app.post('/api/family/children', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  const client = await pool.connect()
  try {
    const profile = cleanProfile(req.body as Record<string, unknown>)
    const familyId = await familyIdFor(req.userId!)
    await client.query('BEGIN')
    const child = await client.query(
      `INSERT INTO child_profiles (family_id, name, age_band, level, daily_goal_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [familyId, profile.name, profile.ageBand, profile.level, profile.dailyGoalMinutes]
    )
    await client.query(
      `INSERT INTO child_progress (child_id, skill_scores) VALUES ($1,$2::jsonb)`,
      [child.rows[0].id, JSON.stringify(DEFAULT_SCORES)]
    )
    await client.query('COMMIT')
    res.status(201).json({ id: child.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(400).json({ error: error instanceof Error ? error.message : 'Could not create learner' })
  } finally {
    client.release()
  }
})

app.post('/api/family/migrate', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  const client = await pool.connect()
  try {
    const body = req.body as Record<string, unknown>
    const profile = cleanProfile((body.profile ?? {}) as Record<string, unknown>)
    const progress = (body.progress ?? {}) as Record<string, unknown>
    const familyId = await familyIdFor(req.userId!)
    const existing = await client.query('SELECT 1 FROM child_profiles WHERE family_id = $1 LIMIT 1', [familyId])
    if (existing.rowCount) {
      res.status(409).json({ error: 'Family already has learner profiles' })
      return
    }
    await client.query('BEGIN')
    const child = await client.query(
      `INSERT INTO child_profiles (family_id, name, age_band, level, daily_goal_minutes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [familyId, profile.name, profile.ageBand, profile.level, profile.dailyGoalMinutes]
    )
    const lessonIds = Array.isArray(progress.completedLessonIds) ? progress.completedLessonIds.filter((x): x is string => typeof x === 'string') : []
    const scores = typeof progress.skillScores === 'object' && progress.skillScores ? progress.skillScores : DEFAULT_SCORES
    await client.query(
      `INSERT INTO child_progress (child_id, completed_lesson_ids, minutes, streak, skill_scores, assessments)
       VALUES ($1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb)`,
      [child.rows[0].id, JSON.stringify(lessonIds), Math.max(0, Number(progress.minutes) || 0),
       Math.max(0, Number(progress.streak) || 0), JSON.stringify(scores),
       JSON.stringify(Array.isArray(progress.assessments) ? progress.assessments : [])]
    )
    if (Number.isInteger(Number(body.dailyLimitMinutes))) {
      await client.query('UPDATE families SET daily_limit_minutes = $1 WHERE id = $2',
        [Math.min(180, Math.max(5, Number(body.dailyLimitMinutes))), familyId])
    }
    await client.query('COMMIT')
    res.status(201).json({ id: child.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK')
    res.status(400).json({ error: error instanceof Error ? error.message : 'Migration failed' })
  } finally {
    client.release()
  }
})

app.post('/api/family/children/:childId/lessons/:lessonId/complete', requireAuth, async (req: AuthRequest, res) => {
  try {
    const familyId = await familyIdFor(req.userId!)
    const duration = Math.min(180, Math.max(0, Number(req.body?.duration) || 0))
    const score = Math.min(100, Math.max(0, Number(req.body?.score) || 0))
    const lessonId = req.params.lessonId.slice(0, 120)
    const result = await pool.query(
      `UPDATE child_progress p SET
         completed_lesson_ids = p.completed_lesson_ids || to_jsonb($1::text),
         minutes = p.minutes + $2,
         assessments = p.assessments || jsonb_build_array(jsonb_build_object('lessonId',$1,'score',$5,'completedAt',now())),
         skill_scores = jsonb_set(jsonb_set(p.skill_scores, '{Speaking}', to_jsonb(LEAST(100, COALESCE((p.skill_scores->>'Speaking')::int,0)+8))), '{Listening}', to_jsonb(LEAST(100, COALESCE((p.skill_scores->>'Listening')::int,0)+5))),
         updated_at = now()
       FROM child_profiles c
       WHERE p.child_id = c.id AND c.id = $3 AND c.family_id = $4
         AND NOT p.completed_lesson_ids ? $1
       RETURNING p.child_id`,
      [lessonId, duration, req.params.childId, familyId, score]
    )
    res.json({ changed: Boolean(result.rowCount) })
  } catch {
    res.status(500).json({ error: 'Could not save lesson progress' })
  }
})

app.put('/api/family/settings', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  try {
    const familyId = await familyIdFor(req.userId!)
    const limit = Math.min(180, Math.max(5, Number(req.body?.dailyLimitMinutes) || 20))
    const privacy = { shareAnalytics: Boolean(req.body?.privacySettings?.shareAnalytics) }
    await pool.query(
      'UPDATE families SET daily_limit_minutes=$1, privacy_settings=$2::jsonb, updated_at=now() WHERE id=$3',
      [limit, JSON.stringify(privacy), familyId]
    )
    res.json({ ok: true })
  } catch {
    res.status(500).json({ error: 'Could not save settings' })
  }
})

app.put('/api/family/pin', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  const pin = typeof req.body?.pin === 'string' ? req.body.pin : ''
  if (!/^\d{4,8}$/.test(pin)) {
    res.status(400).json({ error: 'PIN must be 4–8 digits' })
    return
  }
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = (await scrypt(pin, salt, 64) as Buffer).toString('hex')
  const familyId = await familyIdFor(req.userId!)
  await pool.query('UPDATE families SET parent_pin_hash=$1, parent_pin_salt=$2 WHERE id=$3', [hash, salt, familyId])
  setParentGrant(res, req.userId!, familyId)
  res.json({ ok: true })
})

app.post('/api/family/pin/verify', requireAuth, async (req: AuthRequest, res) => {
  const attempt = pinAttempts.get(req.userId!)
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= PIN_MAX_ATTEMPTS) {
    res.setHeader('Retry-After', String(Math.ceil((attempt.resetAt - Date.now()) / 1000)))
    res.status(429).json({ error: 'Too many attempts. Try again later.' })
    return
  }
  if (!attempt || attempt.resetAt <= Date.now()) {
    pinAttempts.set(req.userId!, { count: 0, resetAt: Date.now() + PIN_WINDOW_MS })
  }
  const familyId = await familyIdFor(req.userId!)
  const result = await pool.query('SELECT parent_pin_hash, parent_pin_salt FROM families WHERE id=$1', [familyId])
  const row = result.rows[0]
  if (!row?.parent_pin_hash || typeof req.body?.pin !== 'string') {
    pinAttempts.get(req.userId!)!.count++
    res.status(403).json({ error: 'Invalid PIN' })
    return
  }
  const candidate = (await scrypt(req.body.pin, row.parent_pin_salt, 64) as Buffer)
  const saved = Buffer.from(row.parent_pin_hash, 'hex')
  if (candidate.length !== saved.length || !crypto.timingSafeEqual(candidate, saved)) {
    pinAttempts.get(req.userId!)!.count++
    res.status(403).json({ error: 'Invalid PIN' })
    return
  }
  pinAttempts.delete(req.userId!)
  setParentGrant(res, req.userId!, familyId)
  res.json({ ok: true })
})

app.delete('/api/family', requireAuth, requireParentAccess, async (req: AuthRequest, res) => {
  // Family deletion cascades through its local account and sessions, ensuring
  // that the deleted account cannot remain signed in.
  const familyId = await familyIdFor(req.userId!)
  await pool.query('DELETE FROM families WHERE id=$1', [familyId])
  res.setHeader('Set-Cookie', `${PARENT_GRANT_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`)
  res.status(204).end()
})

// Never send the server's LLM credential to a browser.
app.get('/api/config', requireAuth, (_req, res) => {
  res.json({ ...loadConfig(), apiKey: '' })
})

// Shared LLM configuration is not a family setting. Only permit local
// configuration during development; production is controlled by server env.
app.post('/api/config', requireAuth, (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'Server configuration cannot be changed here' })
    return
  }
  const body = req.body as Partial<AppConfig>
  const current = loadConfig()
  const updated: AppConfig = {
    version: current.version,
    aiName:
      typeof body.aiName === 'string' && body.aiName.trim() ? body.aiName.trim() : current.aiName,
    systemPrompt:
      typeof body.systemPrompt === 'string' && body.systemPrompt
        ? body.systemPrompt
        : current.systemPrompt,
    baseUrl:
      typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl.trim()
        : current.baseUrl,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : current.apiKey,
    modelName:
      typeof body.modelName === 'string' && body.modelName.trim()
        ? body.modelName.trim()
        : current.modelName
  }
  saveConfig(updated)
  res.json({ ...updated, apiKey: '' })
})

// GET /api/deps — web mode never needs native binaries
app.get('/api/deps', (_req, res) => {
  res.json({ sox: true, espeakNg: true, ollama: true })
})

// POST /api/reset
app.post('/api/reset', requireAuth, (_req, res) => {
  // The browser owns its conversation history; nothing shared to reset.
  res.json({ ok: true })
})

// POST /api/interrupt
app.post('/api/interrupt', requireAuth, (_req, res) => {
  // The browser interrupts its own streaming request by aborting fetch.
  res.json({ ok: true })
})

// POST /api/chat — SSE streaming
app.post('/api/chat', requireAuth, async (req, res) => {
  const body = req.body as {
    messages?: Array<{ role?: string; text?: unknown; content?: unknown }>
  }

  const llmHistory: Message[] = Array.isArray(body?.messages)
    ? body.messages
      .map((m) => {
        const raw =
          typeof m.text === 'string' ? m.text : typeof m.content === 'string' ? m.content : ''
        return {
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: raw.trim()
        }
      })
      .filter((m) => m.content)
    : []
  if (llmHistory.length === 0) {
    res.status(400).json({ error: 'messages array contains no valid entries' })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  function send(obj: object): void {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  const cfg = loadConfig()
  const systemPrompt = cfg.systemPrompt.replace(/\{\{AI_NAME\}\}/g, cfg.aiName)

  // Each browser owns its history and aborts only its own streaming fetch.
  const abort = new AbortController()
  res.on('close', () => abort.abort())

  try {
    const llmRes = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.modelName,
        messages: [{ role: 'system', content: systemPrompt }, ...llmHistory],
        stream: true
      }),
      signal: abort.signal
    })

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => llmRes.statusText)
      send({ type: 'error', message: `LLM error ${llmRes.status}: ${errText}` })
      res.end()
      return
    }

    if (!llmRes.body) {
      send({ type: 'error', message: 'LLM returned no response body' })
      res.end()
      return
    }

    const reader = llmRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sentenceBuffer = ''

    send({ type: 'thinking' })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[]
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            sentenceBuffer += delta
            send({ type: 'delta', text: delta })

            // Flush complete sentences so frontend can start TTS early
            const { sentences, remainder } = extractSentences(sentenceBuffer)
            for (const sentence of sentences) {
              send({ type: 'sentence', text: sentence })
            }
            sentenceBuffer = remainder
          }
        } catch {
          // malformed chunk — skip
        }
      }
    }

    // Flush any remaining partial sentence
    if (sentenceBuffer.trim()) {
      send({ type: 'sentence', text: sentenceBuffer.trim() })
    }

    send({ type: 'done' })
    res.end()
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      send({ type: 'interrupted' })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[chat] Error:', message)
      send({ type: 'error', message })
    }
    res.end()
  }
})

// ─── Static frontend (production only) ───────────────────────────────────────
// In dev mode Vite serves the frontend itself; in production Express serves the
// pre-built files from src/renderer/dist so only one process/port is needed.

if (process.env.NODE_ENV === 'production') {
  // __dirname is not available in ESM; resolve relative to the process cwd
  const distPath = path.resolve(process.cwd(), 'src', 'renderer', 'dist')
  app.use(express.static(distPath))
  // SPA fallback — serve index.html for any non-API route (Express 5 syntax)
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// ─── Start ────────────────────────────────────────────────────────────────────

// DigitalOcean App Platform injects PORT; fall back to 3000 for local dev.
const PORT = parseInt(process.env.PORT || process.env.API_PORT || '3000', 10)
async function startServer(): Promise<void> {
  // The external production database may not have run the Replit post-merge
  // hook. Apply the idempotent schema before accepting requests.
  await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database', 'schema.sql'), 'utf8'))
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[HiKid] Server running on http://0.0.0.0:${PORT}`)
    console.log(`[HiKid] LLM endpoint: ${loadConfig().baseUrl}`)
    if (process.env.NODE_ENV === 'production') {
      console.log('[HiKid] Serving built frontend from src/renderer/dist')
    }
  })
}

void startServer().catch(() => {
  console.error('[HiKid] Database schema initialization failed; server was not started')
  process.exitCode = 1
})
