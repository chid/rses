import { spawn } from 'child_process'

export function launchWithHandoff(tool, handoff, cwd, passthroughArgs = []) {
  // opencode uses `opencode run <message>`, claude/codex/droid accept prompt as bare arg
  const args = tool === 'opencode'
    ? ['run', ...passthroughArgs, handoff]
    : [...passthroughArgs, handoff]
  const opts = {
    stdio: 'inherit',
    cwd: cwd || process.cwd(),
    // Detach from our process so the tool gets a clean TTY
    shell: false,
  }

  const child = spawn(tool, args, opts)

  child.on('error', (err) => {
    if (err.code === 'ENOENT') {
      const installHints = {
        claude: '  Install: npm i -g @anthropic-ai/claude-code',
        codex: '  Install: npm i -g @openai/codex',
        opencode: '  Install: see https://github.com/opencode-ai/opencode',
        droid: '  Install: see https://docs.factory.ai/cli/getting-started/overview',
      }
      console.error(`\nError: '${tool}' not found on PATH. Is it installed?`)
      console.error(installHints[tool] || `  Install ${tool} and ensure it's on your PATH.`)
      process.exit(1)
    }
    throw err
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })
}
