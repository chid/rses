#!/usr/bin/env -S node --no-warnings=ExperimentalWarning

import { program } from 'commander'
import { resolve, basename } from 'path'
import { homedir } from 'os'

function expandPath(p) {
  if (!p) return p
  if (p.startsWith('~/') || p === '~') return p.replace('~', homedir())
  return resolve(p)
}
import {
  parseCodexSession, findCodexSessions, findCodexSessionById,
  getLastCodexSession, queryCodexSessions
} from '../src/parse-codex.js'
import { parseClaudeSession, findClaudeSessionById, getLastClaudeSession, findClaudeSessions } from '../src/parse-claude.js'
import {
  parseOpenCodeSession, findOpenCodeSessionById, getLastOpenCodeSession,
  queryOpenCodeSessions
} from '../src/parse-opencode.js'
import { buildHandoff } from '../src/build-handoff.js'
import { launchWithHandoff } from '../src/launch.js'
import { lsSessions } from '../src/ls.js'
import { pick } from '../src/picker.js'

const VALID_TOOLS = new Set(['claude', 'codex', 'opencode'])
const RESUME_HINTS = {
  claude: '  claude --resume',
  codex: '  codex resume',
  opencode: '  opencode (select session from built-in picker)',
}

program
  .name('rses')
  .version('0.1.0')
  .description('Cross-resume between Claude Code, Codex CLI, and OpenCode sessions')

program
  .command('export <source> <id>')
  .description('Print handoff text from a session without launching anything')
  .option('--turns <n>', 'Number of recent turns to include', '6')
  .action((source, id, opts) => {
    if (!VALID_TOOLS.has(source)) {
      console.error(`Unknown source: ${source}. Use 'claude', 'codex', or 'opencode'.`)
      process.exit(1)
    }
    const handoff = resolveAndBuild(source, id, { ...opts, last: false })
    if (handoff) console.log(handoff)
  })

program
  .command('ls [tool]')
  .description('List recent sessions (claude, codex, opencode, or all)')
  .option('--dir <path>', 'Filter by working directory')
  .action((tool, opts) => {
    const tools = tool ? [tool] : ['codex', 'claude', 'opencode']
    for (const t of tools) {
      if (!VALID_TOOLS.has(t)) {
        console.error(`Unknown tool: ${t}. Use 'claude', 'codex', or 'opencode'.`)
        process.exit(1)
      }
      lsSessions(t, opts.dir ? expandPath(opts.dir) : null)
    }
  })

// ── Manual argv parsing for: rses <target> with <source> [id] ──────────────
const args = process.argv.slice(2)
const withIdx = args.indexOf('with')

if (withIdx === 1 && !['ls', 'export', '--help', '-h', '--version', '-V'].includes(args[0])) {
  const target = args[0]
  const source = args[withIdx + 1]
  const rest = args.slice(withIdx + 2)

  const opts = { last: false, dryRun: false, dir: null, turns: '6', passthrough: [] }
  let id = null

  // Known rses flags — everything else is forwarded to the target tool
  const RSES_FLAGS = new Set(['--last', '--dry-run', '--dir', '--turns'])

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (arg === '--last') opts.last = true
    else if (arg === '--dry-run') opts.dryRun = true
    else if (arg === '--dir') { opts.dir = rest[++i] }
    else if (arg === '--turns') { opts.turns = rest[++i] }
    else if (!arg.startsWith('-')) id = arg
    else {
      // Unknown flag — pass through to the target tool
      // Handle --flag value (where value doesn't start with -)
      opts.passthrough.push(arg)
      // If the flag takes a value (next token exists and isn't a flag), consume it too
      if (rest[i + 1] !== undefined && !rest[i + 1].startsWith('-') && !RSES_FLAGS.has(arg)) {
        opts.passthrough.push(rest[++i])
      }
    }
  }

  if (!target || !source) {
    console.error('Usage: rses <target> with <source> [id] [--last] [--dry-run]')
    process.exit(1)
  }

  runHandoff(target, source, id, opts).catch(e => {
    console.error(e.message)
    process.exit(1)
  })
} else {
  program.parse()
}

// ── Session picker ──────────────────────────────────────────────────────────

async function pickSession(source, filterDir) {
  const home = process.env.HOME || ''
  const shorten = p => p ? p.replace(home, '~') : '—'

  // Fixed column widths — date(16) + gap(2) + cwd(26) + gap(2) + title(rest)
  // Total budget ≈ terminal width. Picker truncates to actual cols at render time.
  const DATE_W = 16
  const CWD_W = 26

  function padCol(s, w) {
    if (!s) s = '—'
    if (s.length > w) return s.slice(0, w - 1) + '…'
    return s.padEnd(w)
  }

  function makeDisplay(date, cwd, title) {
    return `${padCol(date, DATE_W)}  ${padCol(cwd, CWD_W)}  ${title || '(no title)'}`
  }

  if (source === 'codex') {
    const rows = queryCodexSessions({ limit: 30, filterDir }) || []

    if (!rows.length) {
      const files = findCodexSessions(filterDir)
      if (!files.length) return null
      const items = files.slice(0, 30).map(({ path, mtime }) => {
        const date = new Date(mtime).toISOString().slice(0, 16).replace('T', ' ')
        return { display: makeDisplay(date, shorten(path).slice(-CWD_W), basename(path)), value: path }
      })
      return pick(items, 'Select a Codex session:')
    }

    const items = rows.map(r => {
      const date = new Date(r.updatedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')
      const cwd = shorten(r.cwd)
      return {
        display: makeDisplay(date, cwd, r.title),
        value: r,
      }
    })

    const selected = await pick(items, 'Select a Codex session:')
    if (!selected) return null
    if (selected.rolloutPath) return selected.rolloutPath
    return findCodexSessionById(selected.id)

  } else if (source === 'opencode') {
    const rows = queryOpenCodeSessions({ limit: 30, filterDir }) || []
    if (!rows.length) return null

    const items = rows.map(r => {
      const date = new Date(r.updatedAt).toISOString().slice(0, 16).replace('T', ' ')
      const cwd = shorten(r.cwd)
      return {
        display: makeDisplay(date, cwd, r.title),
        value: r.id,
      }
    })

    return pick(items, 'Select an OpenCode session:')

  } else {
    const files = findClaudeSessions(filterDir)
    if (!files.length) return null

    const { readFileSync } = await import('fs')
    const items = files.slice(0, 30).map(({ path, mtime }) => {
      const date = new Date(mtime).toISOString().slice(0, 16).replace('T', ' ')
      let task = '(no task)'
      try {
        const line = readFileSync(path, 'utf8').split('\n').find(l => {
          try { return JSON.parse(l).type === 'user' } catch { return false }
        })
        if (line) {
          const o = JSON.parse(line)
          const c = o.content
          task = (typeof c === 'string' ? c : (Array.isArray(c) ? c.find(x => x.type === 'text')?.text || '' : ''))
        }
      } catch {}
      return { display: makeDisplay(date, '—', task), value: path }
    })

    return pick(items, 'Select a Claude session:')
  }
}

// ── Core logic ──────────────────────────────────────────────────────────────

async function resolveAndBuildAsync(source, id, opts) {
  const turns = parseInt(opts.turns || '3', 10)
  const filterDir = opts.dir ? expandPath(opts.dir) : null

  let filePath
  let parsed

  if (source === 'codex') {
    if (opts.last) {
      filePath = getLastCodexSession(filterDir)
      if (!filePath) {
        console.error('No Codex sessions found' + (filterDir ? ` in ${filterDir}` : '') + '.')
        process.exit(1)
      }
    } else if (id) {
      filePath = findCodexSessionById(id)
      if (!filePath) {
        console.error(`Codex session not found: ${id}`)
        console.error('Tip: run `rses ls codex` to list sessions.')
        process.exit(1)
      }
    } else {
      filePath = await pickSession('codex', filterDir)
      if (!filePath) { console.error('Cancelled.'); process.exit(0) }
    }

    try { parsed = parseCodexSession(filePath); parsed.filePath = filePath } catch (e) {
      console.error(`Failed to parse Codex session: ${e.message}`)
      process.exit(1)
    }

  } else if (source === 'claude') {
    if (opts.last) {
      filePath = getLastClaudeSession(filterDir)
      if (!filePath) { console.error('No Claude sessions found.'); process.exit(1) }
    } else if (id) {
      filePath = findClaudeSessionById(id)
      if (!filePath) {
        console.error(`Claude session not found: ${id}`)
        console.error('Tip: run `rses ls claude` to list sessions.')
        process.exit(1)
      }
    } else {
      filePath = await pickSession('claude', filterDir)
      if (!filePath) { console.error('Cancelled.'); process.exit(0) }
    }

    try { parsed = parseClaudeSession(filePath); parsed.filePath = filePath } catch (e) {
      console.error(`Failed to parse Claude session: ${e.message}`)
      process.exit(1)
    }

  } else if (source === 'opencode') {
    let sessionId
    if (opts.last) {
      sessionId = getLastOpenCodeSession(filterDir)
      if (!sessionId) {
        console.error('No OpenCode sessions found' + (filterDir ? ` in ${filterDir}` : '') + '.')
        process.exit(1)
      }
    } else if (id) {
      sessionId = findOpenCodeSessionById(id)
      if (!sessionId) {
        console.error(`OpenCode session not found: ${id}`)
        console.error('Tip: run `rses ls opencode` to list sessions.')
        process.exit(1)
      }
    } else {
      sessionId = await pickSession('opencode', filterDir)
      if (!sessionId) { console.error('Cancelled.'); process.exit(0) }
    }

    try { parsed = parseOpenCodeSession(sessionId) } catch (e) {
      console.error(`Failed to parse OpenCode session: ${e.message}`)
      process.exit(1)
    }

  } else {
    console.error(`Unknown source tool: ${source}. Use 'claude', 'codex', or 'opencode'.`)
    process.exit(1)
  }

  parsed.turns = parsed.turns.slice(-turns * 2)
  return buildHandoff(source, parsed)
}

function resolveAndBuild(source, id, opts) {
  // Sync path for export command
  const turns = parseInt(opts.turns || '3', 10)
  const filterDir = opts.dir ? expandPath(opts.dir) : null
  let filePath, parsed

  if (source === 'codex') {
    if (!id && !opts.last) { console.error('export requires a session ID.'); process.exit(1) }
    filePath = opts.last ? getLastCodexSession(filterDir) : findCodexSessionById(id)
    if (!filePath) { console.error(`Codex session not found: ${id}`); process.exit(1) }
    parsed = parseCodexSession(filePath); parsed.filePath = filePath
  } else if (source === 'claude') {
    if (!id && !opts.last) { console.error('export requires a session ID.'); process.exit(1) }
    filePath = opts.last ? getLastClaudeSession() : findClaudeSessionById(id)
    if (!filePath) { console.error(`Claude session not found: ${id}`); process.exit(1) }
    parsed = parseClaudeSession(filePath); parsed.filePath = filePath
  } else if (source === 'opencode') {
    if (!id && !opts.last) { console.error('export requires a session ID.'); process.exit(1) }
    const sessionId = opts.last ? getLastOpenCodeSession(filterDir) : findOpenCodeSessionById(id)
    if (!sessionId) { console.error(`OpenCode session not found: ${id}`); process.exit(1) }
    parsed = parseOpenCodeSession(sessionId)
  } else {
    console.error(`Unknown source: ${source}. Use 'claude', 'codex', or 'opencode'.`)
    process.exit(1)
  }

  parsed.turns = parsed.turns.slice(-turns * 2)
  return buildHandoff(source, parsed)
}

async function runHandoff(target, source, id, opts) {
  if (!VALID_TOOLS.has(target)) {
    console.error(`Unknown target: ${target}. Use 'claude', 'codex', or 'opencode'.`); process.exit(1)
  }
  if (!VALID_TOOLS.has(source)) {
    console.error(`Unknown source: ${source}. Use 'claude', 'codex', or 'opencode'.`); process.exit(1)
  }
  if (target === source) {
    console.error(`Same source and target (${target}). Use the native resume:`)
    console.error(RESUME_HINTS[target] || `  ${target} --resume`)
    process.exit(1)
  }

  const handoff = await resolveAndBuildAsync(source, id, opts)
  if (!handoff) return

  if (opts.dryRun) {
    console.log(handoff)
    return
  }

  // Brief summary before launch
  const lines = handoff.split('\n')
  const cwdLine = lines.find(l => l.startsWith('CWD:'))
  const taskLines = lines.slice(
    lines.findIndex(l => l === 'Original task:') + 1,
    lines.findIndex(l => l === 'Original task:') + 2
  )
  console.log()
  if (cwdLine) console.log(`  ${cwdLine}`)
  if (taskLines[0]) console.log(`  Task: "${taskLines[0].trim().slice(0, 80)}"`)
  console.log()
  console.log(`  Launching ${target}...\n`)

  launchWithHandoff(target, handoff, null, opts.passthrough || [])
}
