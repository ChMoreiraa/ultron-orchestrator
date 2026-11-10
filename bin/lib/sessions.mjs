// Every Claude Code session the mod runs in, for the dashboard's Sessions tabs.
// The mod writes sessions/<id>.json (and a heartbeat in it); the dashboard
// writes sessions/<id>.task.json, the one task the mod is to start there.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readdirSync, readSync, closeSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { isTerminal, progress } from '../../core/run-core.ts'
import { nameSessions } from './names.mjs'
import { HOME, readJson, readRun, writeJsonAtomic } from './store.mjs'

export const SESSIONS_DIR = join(HOME, 'sessions')
/** A session whose mod wrote nothing for this long is closed. */
export const SESSION_ALIVE_MS = 15_000
export const SESSION_ID = /^[\w-]{1,80}$/
const MAX_TASK = 4000

const sessionFile = sid => join(SESSIONS_DIR, `${sid}.json`)
export const taskFile = sid => join(SESSIONS_DIR, `${sid}.task.json`)

export const readSession = sid => readJson(sessionFile(sid), null)
export const isSessionAlive = s => Boolean(s && !s.endedAt && Date.now() - (s.at ?? 0) < SESSION_ALIVE_MS)

// ---------------------------------------------------------------- titles

const PROJECTS = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
const titles = new Map() // sid → { file, stamp, title, checkedAt }

function findTranscript(sid) {
  if (!existsSync(PROJECTS)) return null
  for (const dir of readdirSync(PROJECTS)) {
    const file = join(PROJECTS, dir, `${sid}.jsonl`)
    if (existsSync(file)) return file
  }
  return null
}

/** The last `custom-title` (a /rename), else the last `ai-title`, read from the end of the transcript. */
function titleIn(file) {
  const size = statSync(file).size
  const span = Math.min(size, 2_000_000)
  const buf = Buffer.alloc(span)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buf, 0, span, size - span)
  } finally {
    closeSync(fd)
  }
  const text = buf.toString('utf8')
  const last = re => {
    let found = null
    for (const m of text.matchAll(re)) found = m[1]
    return found
  }
  const raw = last(/"customTitle":"((?:[^"\\]|\\.)*)"/g) ?? last(/"aiTitle":"((?:[^"\\]|\\.)*)"/g)
  if (!raw) return null
  try {
    return JSON.parse(`"${raw}"`)
  } catch {
    return raw
  }
}

/** The session's name as Claude Code shows it, cached until the transcript changes (checked every 20s at most). */
export function sessionTitle(sid) {
  const now = Date.now()
  const held = titles.get(sid)
  if (held && now - held.checkedAt < 20_000) return held.title
  const file = held?.file && existsSync(held.file) ? held.file : findTranscript(sid)
  let title = held?.title ?? null
  let stamp = ''
  if (file) {
    try {
      const st = statSync(file)
      stamp = `${st.size}:${st.mtimeMs}`
      if (stamp !== held?.stamp) title = titleIn(file)
    } catch {}
  }
  titles.set(sid, { file, stamp, title, checkedAt: now })
  return title
}

// ---------------------------------------------------------------- the list

/** Where a run stands, in a card's words. */
export function runSummary(run) {
  if (!run || run.revision === 0) return null
  const { done, total } = progress(run)
  const step = run.steps.find(s => s.status === 'running') ?? run.steps.find(s => s.status === 'failed') ?? run.steps.find(s => s.status === 'pending')
  const waves = [...new Set(run.steps.map(s => s.wave))].sort((a, b) => a - b)
  return {
    goal: run.goal,
    status: run.status,
    playbook: run.playbook,
    revision: run.revision,
    isApproved: Boolean(run.approval && run.approval.revision === run.revision),
    done,
    total,
    running: run.steps.filter(s => s.status === 'running').length,
    step: step ? { id: step.id, title: step.title, wave: step.wave, status: step.status, model: step.model, effort: step.effort, mode: step.mode } : null,
    wave: step ? waves.indexOf(step.wave) + 1 : waves.length,
    waves: waves.length,
    updatedAt: run.updatedAt,
  }
}

function card(sid, info) {
  const run = readRun(sid)
  const task = readJson(taskFile(sid), null)
  return {
    sessionId: sid,
    title: sessionTitle(sid),
    cwd: info?.cwd ?? null,
    project: info?.cwd ? basename(info.cwd) : null,
    branch: info?.branch ?? null,
    isAlive: isSessionAlive(info),
    startedAt: info?.startedAt ?? run?.createdAt ?? null,
    lastSeen: info?.endedAt ?? info?.at ?? run?.updatedAt ?? null,
    run: runSummary(run),
    pendingTask: task && !task.takenAt ? { prompt: task.prompt, at: task.at } : null,
  }
}

/** Every session the mod saw, plus older runs from before it registered sessions. */
export function listSessions() {
  const ids = new Set()
  if (existsSync(SESSIONS_DIR)) {
    for (const f of readdirSync(SESSIONS_DIR)) {
      const m = /^([\w-]{1,80})\.json$/.exec(f)
      if (m) ids.add(m[1])
    }
  }
  const runs = join(HOME, 'runs')
  if (existsSync(runs)) for (const d of readdirSync(runs)) if (SESSION_ID.test(d) && existsSync(join(runs, d, 'run.json'))) ids.add(d)
  const cards = [...ids].map(sid => card(sid, readSession(sid))).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  return nameSessions(cards, readSession)
}

/** A session is busy while its run is under way: a new task waits for it to end. */
export const isBusy = s => Boolean(s.run && !isTerminal(s.run.status))

// ---------------------------------------------------------------- tasks

/** Cleans the text a person typed into one `/ultron` argument line. */
export function cleanTask(prompt) {
  const text = String(prompt ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return { error: 'escreva a tarefa' }
  if (text.length > MAX_TASK) return { error: `a tarefa passa de ${MAX_TASK} caracteres` }
  return { text }
}

/** Leaves the task for the session's mod, which runs `/ultron <task>` there. */
export function queueTask(sid, text) {
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const task = { id: randomUUID(), prompt: text, at: Date.now() }
  writeJsonAtomic(taskFile(sid), task)
  return task
}

// ---------------------------------------------------------------- opening a closed session

/** Characters a terminal launcher could read as syntax: refuse such a folder rather than quote it. */
const UNSAFE_PATH = /[;&|<>^"`$%!\r\n]/

/**
 * Opens a new terminal in the session's folder running `claude --resume <id>`.
 * The values reach the launcher through the environment, never through a
 * command line it parses.
 */
export function openInTerminal(sid, cwd) {
  if (!SESSION_ID.test(sid)) return { error: 'sessão inválida' }
  if (!cwd || !existsSync(cwd) || !statSync(cwd).isDirectory()) return { error: 'a pasta da sessão não existe mais' }
  if (UNSAFE_PATH.test(cwd)) return { error: 'a pasta da sessão tem caracteres que o terminal não aceita; abra à mão' }
  const env = { ...process.env, ULTRON_OPEN_CWD: cwd, ULTRON_OPEN_SID: sid }
  let cmd
  let args
  if (process.platform === 'win32') {
    cmd = 'powershell.exe'
    args = ['-NoProfile', '-NonInteractive', '-Command', "Start-Process -FilePath 'cmd.exe' -WorkingDirectory $env:ULTRON_OPEN_CWD -ArgumentList '/k','claude','--resume',$env:ULTRON_OPEN_SID"]
  } else if (process.platform === 'darwin') {
    cmd = 'osascript'
    args = ['-e', 'tell application "Terminal" to do script "cd " & quoted form of (system attribute "ULTRON_OPEN_CWD") & " && claude --resume " & (system attribute "ULTRON_OPEN_SID")', '-e', 'tell application "Terminal" to activate']
  } else {
    return { error: `abra um terminal em ${cwd} e rode: claude --resume ${sid}` }
  }
  try {
    spawn(cmd, args, { env, detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch (err) {
    return { error: String(err?.message ?? err) }
  }
  return { ok: true }
}
