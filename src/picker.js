// Minimal raw-mode terminal picker — zero npm deps
const ESC = '\x1b'
const UP = '\x1b[A'
const DOWN = '\x1b[B'
const ENTER = '\r'
const CTRL_C = '\x03'
const CTRL_P = '\x10'
const CTRL_N = '\x0e'

// Strip ANSI escape codes to get visible character count
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

// Truncate a string to maxLen visible chars, appending … if cut
function truncate(s, maxLen) {
  const clean = s.replace(/\x1b\[[0-9;]*m/g, '')
  if (clean.length <= maxLen) return s
  // Simple truncation on the raw string — close enough for display purposes
  return s.slice(0, maxLen - 1) + '…'
}

// How many terminal rows does a string take given terminal width?
function lineCount(s, cols) {
  const len = visibleLen(s)
  return Math.max(1, Math.ceil(len / cols))
}

function cols() {
  return (process.stdout.columns || 120) - 2 // leave 2-char margin
}

function clearLines(count) {
  for (let i = 0; i < count; i++) {
    process.stdout.write('\x1b[2K\x1b[1A')
  }
  process.stdout.write('\x1b[2K')
}

function render(items, cursor, maxVisible) {
  const termCols = cols()
  const start = Math.max(0, Math.min(cursor - Math.floor(maxVisible / 2), items.length - maxVisible))
  const end = Math.min(start + maxVisible, items.length)

  let totalLines = 0
  const out = []

  for (let i = start; i < end; i++) {
    const selected = i === cursor
    const prefix = selected ? '▶ ' : '  '
    const raw = truncate(items[i].display, termCols - 4)
    const line = `${prefix}${raw}`
    const styled = selected ? `\x1b[1;36m${line}\x1b[0m` : `\x1b[2m${line}\x1b[0m`
    out.push(styled)
    totalLines += lineCount(line, termCols)
  }

  const footer = `\x1b[2m  ${cursor + 1}/${items.length}  ↑↓ · Enter · Esc\x1b[0m`
  out.push(footer)
  totalLines += 1

  process.stdout.write(out.join('\n'))
  return totalLines
}

export function pick(items, header) {
  return new Promise((resolve) => {
    if (!items.length) { resolve(null); return }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      resolve(null); return
    }

    const termRows = process.stdout.rows || 24
    const maxVisible = Math.min(items.length, Math.max(5, termRows - 4))
    let cursor = 0
    let linesWritten = 0
    let headerLines = 0

    if (header) {
      const h = `\n\x1b[1m${header}\x1b[0m\n`
      process.stdout.write(h)
      headerLines = 2 // blank line before + header line
    }

    linesWritten = render(items, cursor, maxVisible)

    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    function redraw() {
      clearLines(linesWritten)
      linesWritten = render(items, cursor, maxVisible)
    }

    function cleanup(result) {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      clearLines(linesWritten)
      if (headerLines) {
        clearLines(headerLines)
      }
      process.stdout.write('\n')
      resolve(result)
    }

    function onData(key) {
      if (key === CTRL_C || (key === ESC && key.length === 1)) {
        cleanup(null)
      } else if (key === UP || key === CTRL_P) {
        cursor = Math.max(0, cursor - 1)
        redraw()
      } else if (key === DOWN || key === CTRL_N) {
        cursor = Math.min(items.length - 1, cursor + 1)
        redraw()
      } else if (key === ENTER) {
        cleanup(items[cursor].value)
      }
    }

    process.stdin.on('data', onData)
  })
}
