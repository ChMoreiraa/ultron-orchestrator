// node --test tests/node — the dashboard server and the CLI against a home of their own.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { request } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOME = mkdtempSync(join(tmpdir(), 'ultron-test-'))
const PORT = 45000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const SID = 'sess-test'
const env = { ...process.env, ULTRON_HOME: HOME, CLAUDE_CONFIG_DIR: HOME, ULTRON_PORT: String(PORT) }

const cli = (...args) => execFileSync(process.execPath, [join(ROOT, 'bin', 'ultron.mjs'), ...args, '--session', SID], { env, encoding: 'utf8', stdio: 'pipe' })

let server
before(async () => {
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
})

const post = (body, headers = {}) =>
  fetch(`${BASE}/api/runs/${SID}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, ...headers },
    body: JSON.stringify(body),
  })

test('the CLI writes a plan the dashboard then serves', async () => {
  const plan = JSON.stringify({
    goal: 'Teste',
    playbook: 'scout-then-build',
    steps: [
      { id: 'map', title: 'Mapear', role: 'scout', wave: 1 },
      { id: 'build', title: 'Fazer', role: 'builder', wave: 2, dependsOn: ['map'] },
    ],
  })
  const out = execFileSync(process.execPath, [join(ROOT, 'bin', 'ultron.mjs'), 'plan', '--session', SID], { env, input: plan, encoding: 'utf8' })
  assert.match(out, /aguardando aprovação/)
  const r = await (await fetch(`${BASE}/api/runs/${SID}`)).json()
  assert.equal(r.run.steps.length, 2)
  assert.equal(r.isAlive, false)
  const list = await (await fetch(`${BASE}/api/runs`)).json()
  assert.equal(list.runs[0].sessionId, SID)
})

test('a post from another origin, or without JSON, is refused', async () => {
  assert.equal((await post({ type: 'approve' }, { origin: 'http://evil.example' })).status, 403)
  assert.equal((await post({ type: 'approve' }, { 'content-type': 'text/plain' })).status, 403)
  // fetch will not send another Host; a page reached by DNS rebinding would.
  const status = await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: PORT, path: '/api/runs', headers: { host: 'evil.example' } }, res => resolve(res.statusCode)).on('error', reject).end()
  })
  assert.equal(status, 403)
})

test('the dashboard may not mark steps or write plans', async () => {
  const r = await post({ type: 'step', stepId: 'map', status: 'done' })
  assert.equal(r.status, 400)
})

test('an edit from the dashboard lands, bumps the revision and asks again', async () => {
  cli('approve')
  const r = await post({ type: 'edit-step', stepId: 'build', patch: { model: 'opus', effort: 'high' } })
  const body = await r.json()
  assert.equal(body.ok, true)
  assert.equal(body.run.revision, 2)
  assert.equal(body.run.status, 'awaiting_approval')
  assert.equal(body.run.steps[1].model, 'opus')
  const bad = await (await post({ type: 'edit-step', stepId: 'build', patch: { effort: 'ultra' } })).json()
  assert.equal(bad.ok, false)
  assert.match(bad.error, /effort inválido/)
})

test('approval from the dashboard, then the CLI moves through the steps', async () => {
  const ok = await (await post({ type: 'approve', revision: 2 })).json()
  assert.equal(ok.run.approval.by, 'dashboard')
  assert.match(cli('step', 'map', 'running'), /map → running/)
  cli('step', 'map', 'done', '--note', 'mapeado')
  cli('step', 'build', 'done')
  assert.match(cli('finish', '--summary', 'feito'), /concluído/)
  const run = JSON.parse(readFileSync(join(HOME, 'runs', SID, 'run.json'), 'utf8'))
  assert.equal(run.status, 'done')
  assert.ok(run.events.some(e => e.by === 'dashboard'))
})

test('the stream sends the run as it stands', async () => {
  const ctrl = new AbortController()
  const r = await fetch(`${BASE}/api/runs/${SID}/stream`, { signal: ctrl.signal })
  const reader = r.body.getReader()
  const { value } = await reader.read()
  ctrl.abort()
  const text = new TextDecoder().decode(value)
  assert.match(text, /^event: run/)
  assert.match(text, /"status":"done"/)
})

test('a plan over the finished run starts with every step pending', () => {
  const plan = JSON.stringify({ goal: 'De novo', playbook: 'direct', steps: [{ id: 'map', title: 'Mapear', role: 'scout', wave: 1 }, { id: 'build', title: 'Fazer', role: 'builder', wave: 2 }] })
  execFileSync(process.execPath, [join(ROOT, 'bin', 'ultron.mjs'), 'plan', '--session', SID], { env, input: plan, encoding: 'utf8' })
  const run = JSON.parse(readFileSync(join(HOME, 'runs', SID, 'run.json'), 'utf8'))
  assert.equal(run.status, 'awaiting_approval')
  assert.deepEqual(run.steps.map(s => [s.id, s.status, s.note]), [['map', 'pending', undefined], ['build', 'pending', undefined]])
})

test('agent and agents: path, state, --init from the template, never over a file', () => {
  const agents = join(HOME, 'agents')
  assert.match(cli('agents'), /nenhum agente/)
  assert.throws(() => cli('agent', 'sem-barra'), /agent <owner\/repo>/)
  const file = join(agents, 'acme__meu-app.md')
  const look = cli('agent', 'acme/meu-app')
  assert.match(look, new RegExp(`AGENT_FILE: ${file.replace(/[\\.]/g, '\\$&')}`))
  assert.match(look, /AGENT_STATE: novo/)
  assert.equal(existsSync(file), false, 'without --init nothing is written')
  assert.match(cli('agent', 'acme/meu-app', '--init'), /AGENT_STATE: novo/)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /acme\/meu-app/)
  assert.match(text, /revisor-meu-app/)
  assert.doesNotMatch(text, /\{\{/)
  writeFileSync(file, '---\nname: revisor-ma\nrepo: acme/meu-app\ncriado: 2026-10-01\natualizado: 2026-10-20\nultima_revisao: 2026-10-20\nprs_revisadas:\n  - 101\n  - 102\n---\n\nnotas\n')
  assert.match(cli('agent', 'acme/meu-app', '--init'), /AGENT_STATE: existente/)
  assert.match(readFileSync(file, 'utf8'), /notas/, 'an existing file is left alone')
  writeFileSync(join(agents, 'acme__api.md'), '---\nname: revisor-api\nrepo: acme/api\nultima_revisao:\nprs_revisadas: [7]\n---\n')
  const list = cli('agents')
  assert.match(list, /revisor-api · acme\/api · última revisão — · 1 PR/)
  assert.match(list, /revisor-ma · acme\/meu-app · última revisão 2026-10-20 · 2 PR/)
})

test('status and the dashboard name the run’s repo agent', async () => {
  const sid = 'sess-agent'
  const plan = JSON.stringify({ goal: 'Revisar', playbook: 'audit', agent: 'acme/meu-app', steps: [{ id: 'ctx', title: 'Contexto', role: 'scout', wave: 1 }] })
  const run = args => execFileSync(process.execPath, [join(ROOT, 'bin', 'ultron.mjs'), ...args, '--session', sid], { env, input: plan, encoding: 'utf8' })
  assert.match(run(['plan']), /Agente: revisor-ma \(acme\/meu-app\)/)
  assert.match(run(['status']), /Agente: revisor-ma \(acme\/meu-app\)/)
  assert.equal(JSON.parse(readFileSync(join(HOME, 'runs', sid, 'run.json'), 'utf8')).agent, 'acme/meu-app')
  const snap = await (await fetch(`${BASE}/api/runs/${sid}`)).json()
  assert.deepEqual(snap.agent, { name: 'revisor-ma', repo: 'acme/meu-app' })
  const bad = JSON.stringify({ goal: 'x', playbook: 'audit', agent: 'meu-app', steps: [{ id: 'a', title: 'A', role: 'scout' }] })
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'bin', 'ultron.mjs'), 'plan', '--session', sid], { env, input: bad, encoding: 'utf8', stdio: 'pipe' }), /agent "meu-app" inválido/)
})

test('the page and its files are served', async () => {
  for (const path of ['/', '/app.js', '/styles.css', '/sprite.js', '/holo.js', '/quotes.js']) assert.equal((await fetch(`${BASE}${path}`)).status, 200, path)
})

test('meta carries no price without config, and the config prices with the strong tier when there are some', async () => {
  const none = await (await fetch(`${BASE}/api/meta`)).json()
  assert.equal(none.precos, null)
  assert.equal(none.strong, 'opus')
  const precos = { conferidoEm: '2026-11-05', modelos: { opus: { entrada: 4, saida: 20, leituraCache: 0.2, escritaCache: 8 } } }
  writeFileSync(join(HOME, 'config.json'), JSON.stringify({ precos, models: { strong: 'sonnet' } }))
  const meta = await (await fetch(`${BASE}/api/meta`)).json()
  assert.deepEqual(meta.precos, precos)
  assert.equal(meta.strong, 'sonnet')
})

test('the run snapshot carries its cost', async () => {
  const r = await (await fetch(`${BASE}/api/runs/${SID}`)).json()
  assert.equal(r.custo.steps.length, 0)
  assert.equal(r.custo.saving, null)
  // The label's date and the price flag come with the cost, read from the config at that moment.
  assert.equal(r.custo.hasPrices, true)
  assert.equal(r.custo.checkedAt, '2026-11-05')
})

test('health reports the plugin version, and versions compare as dotted numbers', async () => {
  const { VERSION, isOlder } = await import('../../bin/lib/store.mjs')
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(VERSION, plugin.version)
  const h = await (await fetch(`${BASE}/api/health`)).json()
  assert.equal(h.version, plugin.version)
  assert.equal(isOlder('0.1.0', '0.1.2'), true)
  assert.equal(isOlder('0.1.10', '0.1.2'), false)
  assert.equal(isOlder('0.2', '0.1.9'), false)
  assert.equal(isOlder('0.1.2', '0.1.2'), false)
  assert.equal(isOlder(undefined, '0.1.2'), true, 'a server too old to report a version gets replaced')
  assert.equal(isOlder('0.1.2', 'x'), false, 'an unreadable own version never kills a running server')
})