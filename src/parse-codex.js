import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { DatabaseSync } from 'node:sqlite'

const SESSIONS_DIR = join(homedir(), '.codex', 'sessions')

// Discover highest-versioned state DB (state_5.sqlite, state_6.sqlite, etc.)
// so rses survives Codex version bumps without code changes.
function findCodexDbPath() {
  const codexDir = join(homedir(), '.codex')
  try {
    const entries = readdirSync(codexDir)
    const dbs = entries
      .filter(f => /^state_\d+\.sqlite$/.test(f))
      .map(f => ({ name: f, version: parseInt(f.match(/state_(\d+)/)[1], 10) }))
      .sort((a, b) => b.version - a.version)
    return dbs.length ? join(codexDir, dbs[0].name) : null
  } catch {
    return null
  }
}

const DB_PATH = findCodexDbPath()

// ── SQLite session index (same data source as `codex resume` picker) ───────

function getCodexDb() {
  if (!DB_PATH || !existsSync(DB_PATH)) return null
  try {
    return new DatabaseSync(DB_PATH, { readonly: true })
  } catch {
    return null
  }
}

export function queryCodexSessions({ limit = 30, filterDir = null } = {}) {
  const db = getCodexDb()
  if (!db) return null // signal to caller: fall back to filesystem

  try {
    let sql = `
      SELECT id, title, cwd, first_user_message, updated_at,
             git_branch, git_sha, rollout_path
      FROM threads
      WHERE archived = 0
    `
    const params = []

    if (filterDir) {
      sql += ` AND (cwd = ? OR cwd LIKE ?)`
      params.push(filterDir, filterDir + '/%')
    }

    sql += ` ORDER BY updated_at DESC LIMIT ?`
    params.push(limit)

    const rows = db.prepare(sql).all(...params)
    db.close()
    return rows.map(r => ({
      id: r.id,
      title: cleanTitle(r.title || r.first_user_message || ''),
      cwd: r.cwd || null,
      firstMessage: r.first_user_message || '',
      updatedAt: r.updated_at, // unix seconds
      branch: r.git_branch || null,
      startCommit: r.git_sha || null,
      rolloutPath: r.rollout_path || null,
    }))
  } catch {
    try { db.close() } catch {}
    return null
  }
}

export function findCodexSessionByIdFromDb(id) {
  const db = getCodexDb()
  if (!db) return null
  try {
    const row = db.prepare('SELECT * FROM threads WHERE id = ? LIMIT 1').get(id)
    db.close()
    return row || null
  } catch {
    try { db.close() } catch {}
    return null
  }
}

function cleanTitle(text) {
  // Strip Claude Code terminal banner characters that end up as session titles
  return text
    .replace(/[\u2580-\u259F\u258A-\u258F\u2590-\u259F\u25FC\u25FD▐▛▜▝▘▙▚▟▞]+\s*/g, '')
    .replace(/Claude Code v[\d.]+\s*/g, '')
    .replace(/Opus.*?Claude Max\s*/g, '')
    .replace(/✻ Conversation compacted.*?\n/g, '')
    .replace(/⎿.*?\n/g, '')
    .replace(/-{10,}\n/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .split('\n')
    .pop() // take the last non-empty line, which tends to be the actual task
    ?.trim() || ''
}

// ── JSONL parsing ──────────────────────────────────────────────────────────

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(c => c.type === 'text' || c.type === 'input_text' || c.type === 'output_text')
      .map(c => c.text || '')
      .join('\n')
  }
  return ''
}

function parseSchemaA(lines) {
  let cwd = null
  let uuid = null
  const turns = []

  for (const line of lines) {
    let obj
    try { obj = JSON.parse(line) } catch { continue }

    if (obj.type === 'session_meta') {
      cwd = obj.payload?.cwd || null
      uuid = obj.payload?.id || null
    } else if (obj.type === 'event_msg' && obj.payload?.type === 'user_message') {
      const text = obj.payload.message || ''
      if (text) turns.push({ role: 'user', text })
    } else if (obj.type === 'response_item') {
      const role = obj.payload?.role
      if (role === 'assistant') {
        const text = extractText(obj.payload?.content || [])
        if (text) turns.push({ role: 'assistant', text })
      }
    }
  }

  return { schema: 'A', cwd, uuid, startCommit: null, turns }
}

function extractEnvContext(text) {
  const cwdMatch = text.match(/<cwd>(.*?)<\/cwd>/)
  const cwd = cwdMatch ? cwdMatch[1] : null
  const clean = text.replace(/<environment_context>[\s\S]*?<\/environment_context>\s*/g, '').trim()
  return { cwd, clean }
}

function parseSchemaB(lines, firstObj) {
  const uuid = firstObj.id || null
  const startCommit = firstObj.git?.commit_hash || null
  const branch = firstObj.git?.branch || null
  let cwd = firstObj.cwd || null
  const turns = []

  for (const line of lines.slice(1)) {
    let obj
    try { obj = JSON.parse(line) } catch { continue }

    if (obj.type === 'message' && (obj.role === 'user' || obj.role === 'assistant')) {
      const raw = extractText(obj.content || [])
      if (!raw) continue

      if (obj.role === 'user') {
        const { cwd: extractedCwd, clean } = extractEnvContext(raw)
        if (extractedCwd && !cwd) cwd = extractedCwd
        if (clean) turns.push({ role: 'user', text: clean })
      } else {
        turns.push({ role: 'assistant', text: raw })
      }
    }
  }

  return { schema: 'B', cwd, uuid, startCommit, branch, turns }
}

export function parseCodexSession(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  if (!lines.length) throw new Error('Empty session file')

  let firstObj
  try { firstObj = JSON.parse(lines[0]) } catch { throw new Error('Invalid JSONL') }

  const parsed = firstObj.type === 'session_meta'
    ? parseSchemaA(lines)
    : parseSchemaB(lines, firstObj)

  const taskTurn = parsed.turns.find(t => t.role === 'user')
  // Clean Claude Code terminal banner noise that sometimes ends up as the first message
  parsed.task = cleanTitle(taskTurn?.text || '')

  return parsed
}

// ── Filesystem fallback ────────────────────────────────────────────────────

function walkSessions(dir) {
  const results = []
  let entries
  try { entries = readdirSync(dir) } catch { return results }

  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try { stat = statSync(full) } catch { continue }
    if (stat.isDirectory()) {
      results.push(...walkSessions(full))
    } else if (entry.endsWith('.jsonl')) {
      results.push({ path: full, mtime: stat.mtimeMs })
    }
  }
  return results
}

export function findCodexSessions(filterDir = null) {
  const all = walkSessions(SESSIONS_DIR)
  all.sort((a, b) => b.mtime - a.mtime)

  if (!filterDir) return all

  return all.filter(({ path }) => {
    try {
      const firstLine = readFileSync(path, 'utf8').split('\n')[0]
      const obj = JSON.parse(firstLine)
      const cwd = obj.payload?.cwd || obj.cwd || ''
      return cwd.startsWith(filterDir)
    } catch {
      return false
    }
  })
}

export function findCodexSessionById(id) {
  // Try SQLite first
  const row = findCodexSessionByIdFromDb(id)
  if (row?.rollout_path && existsSync(row.rollout_path)) return row.rollout_path

  // Filesystem fallback
  const all = walkSessions(SESSIONS_DIR)
  return all.find(({ path }) => basename(path).includes(id))?.path || null
}

export function getLastCodexSession(filterDir = null) {
  // Try SQLite first
  const sessions = queryCodexSessions({ limit: 5, filterDir })
  if (sessions?.length) {
    const first = sessions[0]
    if (first.rolloutPath && existsSync(first.rolloutPath)) return first.rolloutPath
    // Search filesystem for the UUID
    const path = findCodexSessionById(first.id)
    if (path) return path
  }

  // Filesystem fallback
  const all = findCodexSessions(filterDir)
  return all[0]?.path || null
}
