import { readFileSync, readdirSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

const SESSIONS_DIR = join(homedir(), '.factory', 'sessions')

function walkDroidSessions(dir) {
  const results = []
  let entries
  try { entries = readdirSync(dir) } catch { return results }

  for (const entry of entries) {
    const full = join(dir, entry)
    let stat
    try { stat = statSync(full) } catch { continue }

    if (stat.isDirectory()) {
      results.push(...walkDroidSessions(full))
    } else if (entry.endsWith('.jsonl')) {
      results.push({ path: full, mtime: stat.mtimeMs })
    }
  }

  return results
}

function readSessionStart(filePath) {
  try {
    const firstLine = readFileSync(filePath, 'utf8')
      .split('\n')
      .find(l => l.trim())
    if (!firstLine) return null
    const obj = JSON.parse(firstLine)
    if (obj.type !== 'session_start') return null
    return obj
  } catch {
    return null
  }
}

function isInDir(cwd, filterDir) {
  return cwd === filterDir || cwd.startsWith(filterDir + '/')
}

function stripSystemReminders(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractText(content, stripReminders = false) {
  if (typeof content === 'string') {
    return stripReminders ? stripSystemReminders(content) : content.trim()
  }
  if (!Array.isArray(content)) return ''

  const text = content
    .filter(c => c?.type === 'text')
    .map(c => c.text || '')
    .join('\n')
    .trim()

  return stripReminders ? stripSystemReminders(text) : text
}

export function queryDroidSessions({ limit = 30, filterDir = null } = {}) {
  const all = walkDroidSessions(SESSIONS_DIR).sort((a, b) => b.mtime - a.mtime)
  const rows = []

  for (const { path, mtime } of all) {
    const meta = readSessionStart(path)
    const cwd = meta?.cwd || null
    if (filterDir && (!cwd || !isInDir(cwd, filterDir))) continue

    rows.push({
      id: meta?.id || basename(path, '.jsonl'),
      title: (meta?.sessionTitle || meta?.title || '').trim(),
      cwd,
      updatedAt: mtime,
      path,
    })

    if (rows.length >= limit) break
  }

  return rows
}

export function findDroidSessionById(id) {
  const all = walkDroidSessions(SESSIONS_DIR)

  const normalized = id.endsWith('.jsonl') ? id.slice(0, -6) : id
  const exact = all.find(({ path }) => basename(path, '.jsonl') === normalized)
  if (exact) return exact.path

  return all.find(({ path }) => basename(path).includes(normalized))?.path || null
}

export function getLastDroidSession(filterDir = null) {
  const rows = queryDroidSessions({ limit: 1, filterDir })
  return rows[0]?.path || null
}

export function parseDroidSession(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())

  if (!lines.length) throw new Error('Empty session file')

  let sessionId = basename(filePath, '.jsonl')
  let cwd = null
  let title = ''
  const turns = []

  for (const line of lines) {
    let obj
    try { obj = JSON.parse(line) } catch { continue }

    if (obj.type === 'session_start') {
      sessionId = obj.id || sessionId
      cwd = obj.cwd || cwd
      title = obj.sessionTitle || obj.title || title
      continue
    }

    if (obj.type !== 'message' || !obj.message) continue

    const role = obj.message.role
    if (role !== 'user' && role !== 'assistant') continue

    const text = extractText(obj.message.content, role === 'user')
    if (text) turns.push({ role, text })
  }

  const taskTurn = turns.find(t => t.role === 'user')

  return {
    sessionId,
    cwd,
    startCommit: null,
    task: taskTurn?.text || title || '',
    turns,
  }
}
