#!/usr/bin/env node
/**
 * Agent runner — the process every DSH agent container starts.
 *
 * It turns a plain DeepSeek Harness container into a member of the
 * ai-dev-team pipeline:
 *
 *   1. register itself with the orchestrator
 *   2. heartbeat periodically (status: idle | working)
 *   3. poll the orchestrator for a dispatched task
 *   4. execute the task with  dsh --profile headless "<prompt>"
 *      in its own isolated workspace
 *   5. report the result; loop
 *
 * Zero dependencies: Node built-ins only (fetch, child_process).
 * The orchestrator holds all state in PostgreSQL (source of truth)
 * and uses Redis only as an event bus; the runner never touches
 * Postgres or Redis directly.
 *
 * Environment:
 *   AGENT_ID           required  agent id, e.g. "backend"
 *   AGENT_ROLE         optional  role label, e.g. "backend-developer"
 *   AGENT_WORKSPACE    optional  workspace dir (default /workspace/project)
 *   ORCHESTRATOR_URL   optional  base URL (default http://orchestrator:8000)
 *   DSH_BIN            optional  dsh binary (default "dsh"; on PATH in the image)
 *   DSH_PROFILE        optional  dsh profile (default "headless")
 *   HEARTBEAT_MS       optional  heartbeat interval (default 15000)
 *   LONGPOLL_MS        optional  next-task long-poll budget (default 30000)
 *   DSH_TIMEOUT_MS     optional  hard timeout per dsh run (0 = none, default)
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env

// ---------------------------------------------------------------- config
const AGENT_ID = env.AGENT_ID?.trim()
if (!AGENT_ID) {
  console.error('[runner] AGENT_ID is required (set it in docker-compose)')
  process.exit(1)
}
const AGENT_ROLE = env.AGENT_ROLE?.trim() ?? 'agent'
const WORKSPACE = env.AGENT_WORKSPACE ?? '/workspace/project'
const ORCHESTRATOR = (env.ORCHESTRATOR_URL ?? 'http://orchestrator:8000').replace(/\/+$/, '')
const DSH_BIN = env.DSH_BIN ?? 'dsh'
const DSH_PROFILE = env.DSH_PROFILE ?? 'headless'
const HEARTBEAT_MS = Number(env.HEARTBEAT_MS ?? 15000)
const LONGPOLL_MS = Number(env.LONGPOLL_MS ?? 30000)
const DSH_TIMEOUT_MS = Number(env.DSH_TIMEOUT_MS ?? 0)
const RUNS_DIR = join(WORKSPACE, '.agent-team', 'runs')

const log = (...args) => console.log(`[${new Date().toISOString()}][${AGENT_ID}]`, ...args)

let running = true
let child = null

// ---------------------------------------------------------------- helpers
async function api(path, options = {}) {
  const res = await fetch(`${ORCHESTRATOR}/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  })
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body }
}

function run(cmd, args, { cwd, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    const p = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: timeoutMs })
    resolve({ code: p.status ?? 1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' })
  })
}

/** Bootstrap the workspace as a git repo (idempotent). */
async function ensureRepo(repositoryUrl, defaultBranch) {
  mkdirSync(WORKSPACE, { recursive: true })
  if (!existsSync(join(WORKSPACE, '.git'))) {
    log('initializing git repo in workspace')
    await run('git', ['init', '-q', '-b', defaultBranch || 'main'], { cwd: WORKSPACE })
  }
  if (repositoryUrl) {
    const remotes = await run('git', ['remote'], { cwd: WORKSPACE })
    if (!remotes.stdout.includes('origin')) {
      await run('git', ['remote', 'add', 'origin', repositoryUrl], { cwd: WORKSPACE })
    } else {
      await run('git', ['remote', 'set-url', 'origin', repositoryUrl], { cwd: WORKSPACE })
    }
  }
  // The dsh user needs a git identity to commit on behalf of this agent.
  await run('git', ['config', 'user.name', `dsh-${AGENT_ID}`], { cwd: WORKSPACE })
  await run('git', ['config', 'user.email', `${AGENT_ID}@agents.local`], { cwd: WORKSPACE })
}

/** Run one DSH headless task; stream output to a run log. */
async function executeTask(job) {
  const { run_id, task, project, prompt } = job
  mkdirSync(RUNS_DIR, { recursive: true })
  const logFile = join(RUNS_DIR, `run-${run_id}.log`)
  const startedAt = new Date().toISOString()
  log(`run ${run_id} started: TASK-${String(task.id).padStart(3, '0')} "${task.title}"`)

  await ensureRepo(project?.repository_url ?? null, project?.default_branch ?? 'main')

  writeFileSync(logFile, [
    `# ai-dev-team run ${run_id}`,
    `agent: ${AGENT_ID} (${AGENT_ROLE})`,
    `task: TASK-${String(task.id).padStart(3, '0')} ${task.title}`,
    `started: ${startedAt}`,
    '',
    '## prompt',
    '',
    prompt,
    '',
    '## output',
    '',
  ].join('\n'))

  const args = ['--profile', DSH_PROFILE, prompt]
  log(`exec: ${DSH_BIN} ${args.join(' ')}`)
  child = spawn(DSH_BIN, args, {
    cwd: WORKSPACE,
    env: { ...env, DSH_HOME: env.DSH_HOME ?? '/home/dsh/.dsh' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let tail = ''
  const TAIL_BYTES = 32 * 1024
  const capture = (chunk) => {
    appendFileSync(logFile, chunk)
    tail = (tail + chunk).slice(-TAIL_BYTES)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)

  const hardTimeout = DSH_TIMEOUT_MS > 0
    ? setTimeout(() => { log('dsh run timed out, killing'); child?.kill('SIGKILL') }, DSH_TIMEOUT_MS)
    : null

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1))
    child.on('error', (err) => { appendFileSync(logFile, `\n[runner] spawn error: ${err.message}\n`); resolve(1) })
  })
  child = null
  if (hardTimeout) clearTimeout(hardTimeout)

  const branch = (await run('git', ['branch', '--show-current'], { cwd: WORKSPACE })).stdout.trim()
  const status = exitCode === 0 ? 'succeeded' : 'failed'
  const finishedAt = new Date().toISOString()
  log(`run ${run_id} ${status} (exit ${exitCode})${branch ? ` on branch ${branch}` : ''} — log: ${logFile}`)

  return {
    status,
    exit_code: exitCode,
    output: tail,
    branch: branch || null,
    summary: `run ${run_id} ${status} in ${Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000)}s`,
  }
}

// ---------------------------------------------------------------- lifecycle
async function register() {
  const res = await api('/agents/register', {
    method: 'POST',
    body: JSON.stringify({ id: AGENT_ID, role: AGENT_ROLE, workspace: WORKSPACE }),
  })
  if (res.status >= 400) log(`register failed (${res.status}) — will retry on heartbeat`)
  else log(`registered as ${AGENT_ID} (${AGENT_ROLE})`)
}

async function heartbeat(status = 'idle', currentRunId = null) {
  try {
    await api(`/agents/${encodeURIComponent(AGENT_ID)}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ status, current_run_id: currentRunId }),
    })
  } catch (err) {
    log(`heartbeat failed: ${err.message}`)
  }
}

/** Long-poll for the next dispatched task. Returns job or null. */
async function pollNext() {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), LONGPOLL_MS + 5000)
  try {
    const res = await fetch(`${ORCHESTRATOR}/api/agents/${encodeURIComponent(AGENT_ID)}/next`, {
      signal: ac.signal,
      headers: { accept: 'application/json' },
    })
    if (res.status === 204) return null
    if (res.status !== 200) {
      log(`next-task poll returned ${res.status}`)
      return null
    }
    return await res.json()
  } catch (err) {
    if (err.name === 'AbortError') return null
    log(`next-task poll error: ${err.message}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  log(`starting runner (role=${AGENT_ROLE}, workspace=${WORKSPACE}, orchestrator=${ORCHESTRATOR})`)
  mkdirSync(WORKSPACE, { recursive: true })

  // Best-effort registration; heartbeats also upsert the agent row.
  await register().catch((err) => log(`register error: ${err.message}`))

  setInterval(() => heartbeat(child ? 'working' : 'idle'), HEARTBEAT_MS)

  let consecutiveErrors = 0
  while (running) {
    const job = await pollNext()
    if (!running) break
    if (!job) {
      consecutiveErrors = 0 // a clean poll (even 204) means the channel is healthy
      await new Promise((r) => setTimeout(r, 500))
      continue
    }

    consecutiveErrors = 0
    let result
    try {
      result = await executeTask(job)
    } catch (err) {
      log(`executeTask failed: ${err.message}`)
      result = { status: 'failed', exit_code: 1, output: `runner error: ${err.message}`, summary: 'runner error' }
    }

    try {
      const res = await api(`/agents/${encodeURIComponent(AGENT_ID)}/runs/${job.run_id}/result`, {
        method: 'POST',
        body: JSON.stringify(result),
      })
      if (res.status >= 400) log(`result report failed (${res.status})`)
      else log(`result for run ${job.run_id} accepted`)
    } catch (err) {
      log(`result report error: ${err.message}`)
    }
  }
  log('runner stopped')
  process.exit(0)
}

process.on('SIGTERM', () => {
  running = false
  if (child) child.kill('SIGTERM')
})
process.on('SIGINT', () => {
  running = false
  if (child) child.kill('SIGTERM')
})

main()
