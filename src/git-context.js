import { spawnSync } from 'child_process'

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 })
  if (result.error || result.status !== 0) return ''
  return result.stdout.trim()
}

export function getGitContext(cwd, startCommit = null) {
  if (!cwd) return null

  // Check if it's a git repo
  const root = git(['rev-parse', '--show-toplevel'], cwd)
  if (!root) return null

  const branch = git(['branch', '--show-current'], cwd)

  let log
  if (startCommit) {
    // Precise: show what changed since session started
    log = git(['log', `${startCommit}..HEAD`, '--oneline'], cwd)
    // startCommit might equal HEAD (nothing new) or not be an ancestor
    if (!log && git(['merge-base', '--is-ancestor', startCommit, 'HEAD'], cwd) === '') {
      log = '(no commits since session started)'
    }
    if (!log) {
      // startCommit not in history — fall back
      log = git(['log', '--oneline', '-10'], cwd)
    }
  } else {
    log = git(['log', '--oneline', '-10'], cwd)
  }

  const status = git(['status', '--short'], cwd)

  return { branch, log, status }
}
