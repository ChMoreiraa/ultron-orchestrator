// The run's files on disk, for the CLI and the dashboard server (Node).
// run.json has one writer: the mod while the session is alive. Everyone else
// appends a command to inbox.jsonl and waits for the mod's ack; when the mod
// has gone quiet (session closed), the command is applied here instead.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { agentName, agentSlug, applyInbox, inboxLines, newRun } from '../../core/run-core.ts'

export const HOME = process.env.ULTRON_HOME || join(homedir(), '.claude', 'ultron')
export const ALIVE_MS = 6000

const readVersion = () => {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
/** This copy's plugin version: the dashboard reports it, the CLI compares it before reusing a running server. */
export const VERSION = readVersion()

/** True when version `a` is older than `b` (dotted numbers; a missing or odd version counts as oldest). */
export function isOlder(a, b) {
  const parse = v => (typeof v === 'string' && /^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null)
  const x = parse(a)
  const y = parse(b)
  if (!y) return false
  if (!x) return true
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d < 0
  }
  return false
}

export const DEFAULT_CONFIG = {
  version: 1,
  profile: 'equilibrado',
  port: 4477,
  models: { cheap: 'haiku', standard: 'sonnet', strong: 'opus' },
}

export const paths = sessionId => {
  const dir = join(HOME, 'runs', sessionId)
  return { dir, run: join(dir, 'run.json'), inbox: join(dir, 'inbox.jsonl'), heartbeat: join(dir, 'mod.json') }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 1))
  renameSync(tmp, file)
}

export function readConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(join(HOME, 'config.json'), {}) }
}

export function ensureConfig(profile) {
  const file = join(HOME, 'config.json')
  const isNew = !existsSync(file)
  mkdirSync(HOME, { recursive: true })
  const config = { ...DEFAULT_CONFIG, ...readJson(file, {}), ...(profile ? { profile } : {}) }
  if (isNew || profile) writeJsonAtomic(file, config)
  return { config, isNew }
}

export const readRun = sessionId => readJson(paths(sessionId).run, null)

export function modAlive(sessionId) {
  const beat = readJson(paths(sessionId).heartbeat, null)
  return Boolean(beat && Date.now() - beat.at < ALIVE_MS)
}

/** Applies what is waiting in the inbox here, for a session whose mod is gone. */
export function applyHere(sessionId) {
  const p = paths(sessionId)
  const run = readJson(p.run, null) ?? newRun(sessionId, Date.now())
  const lines = existsSync(p.inbox) ? inboxLines(readFileSync(p.inbox, 'utf8')) : []
  if (lines.length <= run.consumed) return run
  applyInbox(run, lines, Date.now())
  writeJsonAtomic(p.run, run)
  return run
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** Sends a command and resolves its ack, `{ ok, error? }`, with the run as it then stands. */
export async function submit(sessionId, command, { by = 'cli', waitMs = 8000 } = {}) {
  const p = paths(sessionId)
  mkdirSync(p.dir, { recursive: true })
  const id = randomUUID()
  appendFileSync(p.inbox, `${JSON.stringify({ ...command, id, by, at: Date.now() })}\n`)
  const deadline = Date.now() + waitMs
  while (modAlive(sessionId) && Date.now() < deadline) {
    const run = readJson(p.run, null)
    if (run?.acks?.[id]) return { ...run.acks[id], run }
    await sleep(150)
  }
  // The mod is gone, or did not answer in time: apply it here.
  const run = applyHere(sessionId)
  return { ...(run.acks[id] ?? { ok: false, error: 'o comando não foi aplicado' }), run }
}

// ---------------------------------------------------------------- repo agents

export const AGENTS_DIR = join(HOME, 'agents')
export const agentFile = repo => join(AGENTS_DIR, `${agentSlug(repo)}.md`)

/** The YAML frontmatter's flat keys; a list (`[a, b]` or `- a` lines) becomes an array. */
export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!m) return {}
  const out = {}
  let listKey = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s*(.*)$/.exec(line)
    if (item && listKey) {
      if (!Array.isArray(out[listKey])) out[listKey] = []
      out[listKey].push(unquote(item[1]))
      continue
    }
    const kv = /^([\w-]+):\s*(.*?)\s*$/.exec(line)
    if (!kv) continue
    const [, key, raw] = kv
    listKey = raw === '' ? key : null
    if (/^\[.*\]$/.test(raw)) out[key] = raw.slice(1, -1).split(',').map(unquote).filter(Boolean)
    else out[key] = unquote(raw)
  }
  return out
}

const unquote = s => s.trim().replace(/^(["'])(.*)\1$/, '$2')

/** A repo's agent as its file describes it, or null when there is no file. */
export function readAgent(repo) {
  const file = agentFile(repo)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const fm = frontmatter(text)
  const prs = Array.isArray(fm.prs_revisadas) ? fm.prs_revisadas : []
  return {
    file,
    repo: typeof fm.repo === 'string' && fm.repo ? fm.repo : repo,
    name: typeof fm.name === 'string' && fm.name ? fm.name : agentName(repo),
    criado: fm.criado || '',
    atualizado: fm.atualizado || '',
    ultimaRevisao: fm.ultima_revisao || '',
    prs,
  }
}

export function listAgents() {
  if (!existsSync(AGENTS_DIR)) return []
  return readdirSync(AGENTS_DIR)
    .filter(f => /^[A-Za-z0-9_.-]+__[A-Za-z0-9_.-]+\.md$/.test(f))
    .map(f => {
      const slug = f.slice(0, -3)
      const i = slug.indexOf('__')
      return readAgent(`${slug.slice(0, i)}/${slug.slice(i + 2)}`)
    })
    .filter(Boolean)
    .sort((a, b) => a.repo.localeCompare(b.repo))
}

export function listRuns() {
  const dir = join(HOME, 'runs')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map(sessionId => {
      const run = readRun(sessionId)
      if (!run || run.revision === 0) return null
      let mtime = run.updatedAt
      try {
        mtime = statSync(paths(sessionId).run).mtimeMs
      } catch {}
      return { sessionId, goal: run.goal, status: run.status, playbook: run.playbook, updatedAt: mtime, isAlive: modAlive(sessionId) }
    })
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
