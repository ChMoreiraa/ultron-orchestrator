// Dashboard local do Ultron: http://127.0.0.1:<porta>. Sem dependências.
// Lê run.json e só escreve na inbox (comandos), nunca no run.json direto.
import { createServer } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { EFFORTS, MODELS, PLAYBOOKS, PROFILES, ROLES, TIER_WEIGHT, defaultsFor, runCost } from '../core/run-core.ts'
import { HOME, listRuns, modAlive, paths, readAgent, readConfig, readRun, submit, writeJsonAtomic } from '../bin/lib/store.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.ULTRON_PORT) || Number(readConfig().port) || 4477
const IDLE_MS = 30 * 60_000
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/sprite.js': 'sprite.js' }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }
/** What the dashboard may send; the rest (step, agent-*, plan, finish) is the session's. */
const ALLOWED = new Set(['approve', 'reject', 'pause', 'resume', 'cancel', 'set-profile', 'edit-step', 'add-step', 'remove-step', 'move-step'])
const SESSION = /^[\w-]{1,80}$/

let lastSeen = Date.now()
const streams = new Set()

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Only this page may post: same origin, JSON body (a form from another site can do neither). */
function isTrusted(req) {
  const allowed = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]
  const host = `http://${req.headers.host ?? ''}`
  const origin = req.headers.origin
  return allowed.includes(host) && origin !== undefined && allowed.includes(origin) && /^application\/json\b/.test(req.headers['content-type'] ?? '')
}

function body(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', c => {
      size += c.length
      if (size > 256_000) reject(new Error('corpo grande demais'))
      else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Prices come only from the user's config (checked against the official page); null when absent or malformed. */
function precos() {
  const p = readConfig().precos
  return p && typeof p === 'object' && !Array.isArray(p) ? p : null
}

const strongTier = () => {
  const m = readConfig().models?.strong
  return MODELS.includes(m) ? m : 'opus'
}

/** The run's cost plus the date its prices were checked, read with it so a config edit never leaves the label stale. */
const custo = run => {
  if (!run) return null
  const p = precos()
  const when = p?.conferidoEm
  return { ...runCost(run, p, strongTier()), hasPrices: p !== null, checkedAt: typeof when === 'string' ? when : null }
}

/** Changes whenever the config does, so the stream resends the cost when the prices are edited. */
function configStamp() {
  try {
    return statSync(join(HOME, 'config.json')).mtimeMs
  } catch {
    return 'none'
  }
}

function meta() {
  const roles = Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, { ...r, byProfile: Object.fromEntries(PROFILES.map(p => [p, defaultsFor(k, p)])) }]))
  return { models: MODELS, efforts: EFFORTS, profiles: PROFILES, playbooks: PLAYBOOKS, roles, tierWeight: TIER_WEIGHT, precos: precos(), strong: strongTier() }
}

function snapshot(sid) {
  const run = readRun(sid)
  const agent = run?.agent ? readAgent(run.agent) : null
  return { run, isAlive: modAlive(sid), agent: agent && { name: agent.name, repo: agent.repo }, custo: custo(run) }
}

function stream(req, res, sid) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
  let last = ''
  const send = () => {
    let stamp = ''
    try {
      stamp = `${statSync(paths(sid).run).mtimeMs}:${modAlive(sid)}:${configStamp()}`
    } catch {
      stamp = `none:${modAlive(sid)}:${configStamp()}`
    }
    if (stamp === last) return
    last = stamp
    res.write(`event: run\ndata: ${JSON.stringify(snapshot(sid))}\n\n`)
  }
  send()
  const tick = setInterval(send, 400)
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000)
  const client = { res }
  streams.add(client)
  req.on('close', () => {
    clearInterval(tick)
    clearInterval(ping)
    streams.delete(client)
    lastSeen = Date.now()
  })
}

const server = createServer(async (req, res) => {
  lastSeen = Date.now()
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  // A page on another name that resolves here (DNS rebinding) reads nothing.
  if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host ?? '')) return json(res, 403, { error: 'host não permitido' })
  try {
    if (req.method === 'GET' && STATIC[path]) {
      const file = join(DIR, STATIC[path])
      res.writeHead(200, { 'content-type': TYPES[extname(file)], 'cache-control': 'no-store' })
      return res.end(readFileSync(file))
    }
    if (req.method === 'GET' && path === '/api/health') return json(res, 200, { app: 'ultron', pid: process.pid, port: PORT })
    if (req.method === 'GET' && path === '/api/meta') return json(res, 200, meta())
    if (req.method === 'GET' && path === '/api/runs') return json(res, 200, { runs: listRuns() })
    const m = path.match(/^\/api\/runs\/([^/]+)(\/stream|\/commands)?$/)
    if (m) {
      const sid = decodeURIComponent(m[1])
      if (!SESSION.test(sid)) return json(res, 400, { error: 'sessão inválida' })
      if (req.method === 'GET' && !m[2]) return json(res, 200, snapshot(sid))
      if (req.method === 'GET' && m[2] === '/stream') return stream(req, res, sid)
      if (req.method === 'POST' && m[2] === '/commands') {
        if (!isTrusted(req)) return json(res, 403, { error: 'origem não permitida' })
        let cmd
        try {
          cmd = JSON.parse(await body(req))
        } catch {
          return json(res, 400, { error: 'JSON inválido' })
        }
        if (!cmd || !ALLOWED.has(cmd.type)) return json(res, 400, { error: `comando não permitido: ${cmd?.type}` })
        if (!readRun(sid)) return json(res, 404, { error: 'run não encontrada' })
        const { id: _id, by: _by, at: _at, ...clean } = cmd
        const r = await submit(sid, clean, { by: 'dashboard', waitMs: 4000 })
        return json(res, r.ok ? 200 : 409, { ok: r.ok, error: r.error, run: r.run, isAlive: modAlive(sid), custo: custo(r.run) })
      }
    }
    json(res, 404, { error: 'não encontrado' })
  } catch (err) {
    json(res, 500, { error: String(err?.message ?? err) })
  }
})

server.on('error', err => {
  console.error(`ultron dashboard: ${err.message}`)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  try {
    writeJsonAtomic(join(HOME, 'server.json'), { pid: process.pid, port: PORT, startedAt: Date.now() })
  } catch {}
  console.log(`ultron dashboard em http://127.0.0.1:${PORT}`)
})

// A browser may try `localhost` on IPv6 first: answer on ::1 too, where the machine has it.
const server6 = createServer((req, res) => server.emit('request', req, res))
server6.on('error', () => {})
server6.listen(PORT, '::1')

// Goes away by itself once nobody has looked for a while and no session runs /ultron.
setInterval(() => {
  const isQuiet = streams.size === 0 && Date.now() - lastSeen > IDLE_MS
  if (isQuiet && !listRuns().some(r => r.isAlive)) process.exit(0)
}, 60_000).unref()
