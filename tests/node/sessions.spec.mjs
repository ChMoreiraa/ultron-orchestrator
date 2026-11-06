// node --test tests/node — the Sessions tabs: registry, titles, tasks from the dashboard.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOME = mkdtempSync(join(tmpdir(), 'ultron-sessions-'))
const CONFIG = mkdtempSync(join(tmpdir(), 'ultron-claude-'))
const PORT = 46000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const env = { ...process.env, ULTRON_HOME: HOME, ULTRON_PORT: String(PORT), CLAUDE_CONFIG_DIR: CONFIG }

process.env.ULTRON_HOME = HOME
process.env.CLAUDE_CONFIG_DIR = CONFIG
const { cleanTask, listSessions, openInTerminal } = await import('../../bin/lib/sessions.mjs')

const OPEN = 'sess-open'
const IDLE = 'sess-idle'
const BUSY = 'sess-busy'
const DONE = 'sess-done'

function seed() {
  const now = Date.now()
  const sessions = join(HOME, 'sessions')
  mkdirSync(sessions, { recursive: true })
  const info = (sid, extra = {}) => writeFileSync(join(sessions, `${sid}.json`), JSON.stringify({ sessionId: sid, cwd: HOME, branch: 'feat/x', startedAt: now - 60_000, at: now, ...extra }))
  info(OPEN)
  info(IDLE)
  info(BUSY)
  info(DONE, { at: now - 3_600_000, endedAt: now - 3_600_000 })
  const run = (sid, status) => {
    mkdirSync(join(HOME, 'runs', sid), { recursive: true })
    writeFileSync(
      join(HOME, 'runs', sid, 'run.json'),
      JSON.stringify({
        version: 1, sessionId: sid, goal: `Meta de ${sid}`, playbook: 'scout-then-build', profile: 'equilibrado', rationale: '', complexity: 3,
        status, revision: 1, approval: null, events: [], consumed: 0, acks: {}, createdAt: now, updatedAt: now,
        steps: [
          { id: 'map', title: 'Mapear', role: 'scout', mode: 'agent', agentType: 'Explore', model: 'haiku', effort: 'low', wave: 1, dependsOn: [], status: 'done' },
          { id: 'build', title: 'Construir', role: 'builder', mode: 'agent', agentType: 'general-purpose', model: 'sonnet', effort: 'medium', wave: 2, dependsOn: ['map'], status: status === 'done' ? 'done' : 'running' },
        ],
      }),
    )
  }
  run(BUSY, 'running')
  run(DONE, 'done')
  // Session names live in the transcripts: the last /rename wins over the AI title.
  const project = join(CONFIG, 'projects', 'C--proj')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, `${OPEN}.jsonl`), [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Título automático', sessionId: OPEN }),
    JSON.stringify({ type: 'custom-title', customTitle: 'Minha sessão "nomeada"', sessionId: OPEN }),
    JSON.stringify({ type: 'ai-title', aiTitle: 'Outro automático', sessionId: OPEN }),
  ].join('\n'))
  writeFileSync(join(project, `${BUSY}.jsonl`), JSON.stringify({ type: 'ai-title', aiTitle: 'Auth por token', sessionId: BUSY }))
}

let server
before(async () => {
  seed()
  server = spawn(process.execPath, [join(ROOT, 'dashboard', 'server.mjs')], { env, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('server did not start')
})

after(() => {
  server?.kill()
  rmSync(HOME, { recursive: true, force: true })
  rmSync(CONFIG, { recursive: true, force: true })
})

const post = (sid, what, body, headers = {}) =>
  fetch(`${BASE}/api/sessions/${sid}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, ...headers }, body: JSON.stringify(body) })

test('the list holds every session, open or closed, with name, branch and where its flow stands', () => {
  const list = listSessions()
  const by = Object.fromEntries(list.map(s => [s.sessionId, s]))
  assert.deepEqual(new Set(Object.keys(by)), new Set([OPEN, IDLE, BUSY, DONE]))
  assert.equal(by[OPEN].title, 'Minha sessão "nomeada"')
  assert.equal(by[BUSY].title, 'Auth por token')
  assert.equal(by[IDLE].title, null)
  assert.equal(by[OPEN].branch, 'feat/x')
  assert.equal(by[OPEN].isAlive, true)
  assert.equal(by[DONE].isAlive, false)
  assert.equal(by[BUSY].run.status, 'running')
  assert.equal(by[BUSY].run.step.id, 'build')
  assert.equal(by[BUSY].run.wave, 2)
  assert.equal(by[DONE].run.done, 2)
  assert.equal(by[IDLE].run, null)
})

test('the sessions stream sends the list', async () => {
  const ctrl = new AbortController()
  const r = await fetch(`${BASE}/api/sessions/stream`, { signal: ctrl.signal })
  const { value } = await r.body.getReader().read()
  ctrl.abort()
  const text = new TextDecoder().decode(value)
  assert.match(text, /^event: sessions/)
  assert.match(text, new RegExp(OPEN))
})

test('a task for an open session is queued for its mod', async () => {
  const r = await (await post(IDLE, 'task', { prompt: '  adicionar\n testes  ' })).json()
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'sent')
  const task = JSON.parse(readFileSync(join(HOME, 'sessions', `${IDLE}.task.json`), 'utf8'))
  assert.equal(task.prompt, 'adicionar testes')
  assert.ok(task.id)
  const listed = (await (await fetch(`${BASE}/api/sessions`)).json()).sessions.find(s => s.sessionId === IDLE)
  assert.equal(listed.pendingTask.prompt, 'adicionar testes')
})

test('a queued task can be taken back', async () => {
  assert.equal((await (await post(IDLE, 'task', { cancel: true })).json()).ok, true)
  const task = JSON.parse(readFileSync(join(HOME, 'sessions', `${IDLE}.task.json`), 'utf8'))
  assert.equal(task.isCancelled, true)
  assert.ok(task.takenAt)
})

test('a session with a flow under way takes no new task', async () => {
  const r = await post(BUSY, 'task', { prompt: 'outra coisa' })
  assert.equal(r.status, 409)
  assert.match((await r.json()).error, /fluxo em andamento/)
})

test('a closed session keeps the task for when it comes back', async () => {
  const r = await (await post(DONE, 'task', { prompt: 'nova tarefa' })).json()
  assert.equal(r.ok, true)
  assert.equal(r.mode, 'queued')
  assert.equal(JSON.parse(readFileSync(join(HOME, 'sessions', `${DONE}.task.json`), 'utf8')).prompt, 'nova tarefa')
})

test('an open session is not opened again', async () => {
  assert.equal((await post(OPEN, 'open', {})).status, 409)
})

test('tasks and opening refuse other origins, bad ids and empty text', async () => {
  assert.equal((await post(IDLE, 'task', { prompt: 'x' }, { origin: 'http://evil.example' })).status, 403)
  assert.equal((await post(IDLE, 'open', {}, { 'content-type': 'text/plain' })).status, 403)
  assert.equal((await post('..%2Fx', 'task', { prompt: 'x' })).status, 400)
  assert.equal((await post('nope', 'task', { prompt: 'x' })).status, 404)
  assert.equal((await post(IDLE, 'task', { prompt: '   ' })).status, 400)
})

test('task text is one clean line, bounded', () => {
  assert.deepEqual(cleanTask('a\u0000b\r\nc\td'), { text: 'a b c d' })
  assert.match(cleanTask('').error, /escreva/)
  assert.match(cleanTask('x'.repeat(4001)).error, /4000/)
})

test('opening refuses a missing folder and one a launcher could misread', () => {
  assert.match(openInTerminal('bad id!', HOME).error, /inválida/)
  assert.match(openInTerminal(OPEN, join(HOME, 'nao-existe')).error, /não existe/)
  const odd = join(HOME, 'a&b')
  mkdirSync(odd)
  assert.match(openInTerminal(OPEN, odd).error, /caracteres/)
})
