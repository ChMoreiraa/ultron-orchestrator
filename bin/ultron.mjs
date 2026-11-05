#!/usr/bin/env node
// CLI do Ultron: o que a skill /ultron chama via Bash para gravar e consultar a run.
//   node ultron.mjs <comando> [args] --session <id>
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENT_REPO, EFFORTS, MODELS, PROFILES, ROLES, agentName, defaultsFor, escalate, summarize, validatePlan } from '../core/run-core.ts'
import { AGENTS_DIR, HOME, VERSION, agentFile, ensureConfig, isOlder, listAgents, modAlive, readAgent, readConfig, readRun, submit } from './lib/store.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const AGENT_TEMPLATE = join(ROOT, 'skills', 'ultron', 'references', 'agent-template.md')

const HELP = `ultron — orquestração de modelos por etapa

Uso: node ultron.mjs <comando> [args] --session <id>

  session                       primeiro comando: sessão, FIRST_RUN, dashboard e run atual
  init [--profile p]            cria ~/.claude/ultron/config.json na primeira vez
  roles [--profile p]           tabela papel → agente/modelo/effort
  plan [--file plan.json]       grava o plano (JSON no stdin ou em --file); volta a pedir aprovação
                                campo opcional "agent": "owner/repo" leva o agente do repo a cada etapa agent
  status [--json]               a run como está agora (inclui edições feitas no dashboard)
  approve                       aprovação dada pelo usuário no chat
  reject --reason "..."         o usuário pediu mudanças
  edit <etapa> [--model m] [--effort e] [--title t] [--role r] [--mode agent|inline] [--wave n] [--agent-type t] [--depends a,b]
  add --id x --title t --role r [--wave n] [--model m] [--effort e] [--mode m] [--after etapa]
  remove <etapa>
  profile <economia|equilibrado|qualidade>
  step <etapa> <running|done|failed|skipped> [--note "..."]
  escalate <etapa>              sobe um nível (effort/tier) de uma etapa que falhou; pede nova aprovação
  pause | resume | cancel
  finish [--failed] [--summary "..."]
  dashboard [--no-open]         sobe o dashboard local e abre o navegador
  agents                        lista os agentes de repo em ~/.claude/ultron/agents/ (não pede --session)
  agent <owner/repo> [--init]   caminho e estado do agente do repo; --init cria do template se não existir
`

function parse(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else {
        flags[key] = next
        i++
      }
    } else pos.push(a)
  }
  return { pos, flags }
}

const { pos, flags } = parse(process.argv.slice(2))
const [command, ...args] = pos

function die(message) {
  console.error(`ultron: ${message}`)
  process.exit(1)
}

function session() {
  const id = flags.session || process.env.ULTRON_SESSION
  if (!id || id === true) die('falta --session <id> (está no bloco <ultron-session> da skill)')
  if (!/^[\w-]{1,80}$/.test(id)) die(`session inválida: ${id}`)
  return id
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

// Approvals and requested changes come from the person, in the chat; the rest is the orchestrator's.
const BY_PERSON = new Set(['approve', 'reject'])

async function send(cmd, { quiet = false } = {}) {
  const sid = session()
  const r = await submit(sid, cmd, { by: BY_PERSON.has(cmd.type) ? 'chat' : 'ultron' })
  if (!r.ok) die(r.error ?? 'falhou')
  if (!quiet) console.log(describeRun(r.run))
  return r
}

const describeRun = run => summarize(run, run.agent ? readAgent(run.agent) : null)

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A new agent file's text: the skill's template, or a bare frontmatter when it is missing. */
function agentDraft(repo) {
  const vars = { repo, name: agentName(repo), date: today() }
  let template
  try {
    template = readFileSync(AGENT_TEMPLATE, 'utf8')
  } catch {
    template = ['---', 'name: {{name}}', 'repo: {{repo}}', 'criado: {{date}}', 'atualizado: {{date}}', 'ultima_revisao:', 'prs_revisadas: []', '---', '', '# {{name}}', '', 'Revisor das PRs de {{repo}}.', ''].join('\n')
  }
  return template.replace(/\{\{(repo|name|date)\}\}/g, (_, k) => vars[k])
}

function table(profile) {
  const rows = Object.entries(ROLES).map(([role, r]) => {
    const d = defaultsFor(role, profile)
    return `  ${role.padEnd(17)} ${d.agentType.padEnd(16)} ${d.model.padEnd(7)} ${d.effort.padEnd(7)} ${r.label}`
  })
  return [`Perfil ${profile}:`, `  ${'papel'.padEnd(17)} ${'agentType'.padEnd(16)} ${'modelo'.padEnd(7)} ${'effort'.padEnd(7)}`, ...rows].join('\n')
}

const port = () => Number(process.env.ULTRON_PORT) || Number(readConfig().port) || 4477
const dashboardUrl = sid => `http://127.0.0.1:${port()}/?session=${encodeURIComponent(sid)}`

/** The running dashboard's health ({ app, pid, version }), or null when none answers. */
async function health() {
  try {
    const r = await fetch(`http://127.0.0.1:${port()}/api/health`, { signal: AbortSignal.timeout(800) })
    const h = r.ok ? await r.json() : null
    return h?.app === 'ultron' ? h : null
  } catch {
    return null
  }
}

const isServerUp = async () => (await health()) !== null

async function ensureServer() {
  const h = await health()
  // A server left running by an older copy of the plugin keeps serving the old dashboard: replace it.
  if (h && !isOlder(h.version, VERSION)) return true
  if (h && Number.isInteger(h.pid)) {
    try {
      process.kill(h.pid)
    } catch {}
    for (let i = 0; i < 25 && (await isServerUp()); i++) await new Promise(r => setTimeout(r, 200))
  }
  const child = spawn(process.execPath, [join(ROOT, 'dashboard', 'server.mjs')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env })
  child.unref()
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200))
    if (await isServerUp()) return true
  }
  return false
}

function openBrowser(url) {
  const [cmd, argv] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, argv, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

const patchFrom = f => {
  const patch = {}
  if (typeof f.model === 'string') patch.model = f.model
  if (typeof f.effort === 'string') patch.effort = f.effort
  if (typeof f.title === 'string') patch.title = f.title
  if (typeof f.role === 'string') patch.role = f.role
  if (typeof f.mode === 'string') patch.mode = f.mode
  if (typeof f['agent-type'] === 'string') patch.agentType = f['agent-type']
  if (f.wave !== undefined) patch.wave = Number(f.wave)
  if (typeof f.depends === 'string') patch.dependsOn = f.depends.split(',').map(s => s.trim()).filter(Boolean)
  return patch
}

switch (command) {
  case undefined:
  case 'help':
  case '--help':
    console.log(HELP)
    break
  case 'session': {
    const sid = session()
    const run = readRun(sid)
    // Every URL the session shows must answer: bring the server up now, not only on `dashboard`.
    const isUp = await ensureServer()
    // What only the person knows (their org, where their clones live, their review style) stays local.
    const cfg = readConfig()
    const localComment = join(HOME, 'review-comment.md')
    console.log(
      [
        `SESSION_ID: ${sid}`,
        `FIRST_RUN: ${existsSync(join(HOME, 'config.json')) ? 'no' : 'yes'}`,
        `DASHBOARD: ${dashboardUrl(sid)}${isUp ? '' : ` (não subiu na porta ${port()}; rode \`dashboard\` para ver o erro)`}`,
        `PAINEL: ${modAlive(sid) ? 'ativo' : 'o mod ainda não respondeu (o painel abre quando ele ativar)'}`,
        `CURRENT_RUN: ${run && run.revision > 0 ? `${run.status} · rev ${run.revision} · ${run.goal}` : 'none'}`,
        `DEFAULT_OWNER: ${typeof cfg.defaultOwner === 'string' && cfg.defaultOwner ? cfg.defaultOwner : 'none'}`,
        `REPOS_DIR: ${typeof cfg.reposDir === 'string' && cfg.reposDir ? cfg.reposDir : 'none'}`,
        `REVIEW_COMMENT: ${existsSync(localComment) ? localComment : join(ROOT, 'skills', 'ultron', 'references', 'review-comment.md')}`,
      ].join('\n'),
    )
    break
  }
  case 'init': {
    const profile = typeof flags.profile === 'string' ? flags.profile : undefined
    if (profile && !PROFILES.includes(profile)) die(`perfil inválido (${PROFILES.join('|')})`)
    const { config, isNew } = ensureConfig(profile)
    console.log(`${isNew ? 'Configuração criada' : 'Configuração existente'} em ${join(HOME, 'config.json')}`)
    console.log(`Perfil padrão: ${config.profile} · dashboard na porta ${config.port} · tiers: barato=${config.models.cheap} padrão=${config.models.standard} forte=${config.models.strong}`)
    console.log(table(config.profile))
    break
  }
  case 'roles': {
    const profile = typeof flags.profile === 'string' ? flags.profile : readConfig().profile
    console.log(table(profile))
    console.log(`\nModelos: ${MODELS.join(', ')} · efforts: ${EFFORTS.join(', ')}`)
    break
  }
  case 'plan': {
    const text = typeof flags.file === 'string' ? readFileSync(flags.file, 'utf8') : readStdin()
    let plan
    try {
      plan = JSON.parse(text)
    } catch (err) {
      die(`JSON inválido: ${err.message}`)
    }
    plan.profile ??= readConfig().profile
    const { errors } = validatePlan(plan)
    if (errors.length) die(`plano inválido:\n  - ${errors.join('\n  - ')}`)
    await send({ type: 'plan', plan })
    const isUp = await ensureServer()
    console.log(`\nDashboard: ${dashboardUrl(session())}${isUp ? '' : ' (o servidor não subiu; rode `dashboard`)'}`)
    break
  }
  case 'status': {
    const run = readRun(session())
    if (!run) {
      console.log('Nenhum plano ainda nesta sessão.')
      break
    }
    console.log(flags.json ? JSON.stringify(run, null, 1) : describeRun(run))
    break
  }
  case 'approve': {
    const run = readRun(session())
    await send({ type: 'approve', revision: run?.revision })
    break
  }
  case 'reject':
    await send({ type: 'reject', reason: typeof flags.reason === 'string' ? flags.reason : '' })
    break
  case 'pause':
  case 'resume':
  case 'cancel':
    await send({ type: command })
    break
  case 'profile':
    if (!PROFILES.includes(args[0])) die(`perfil inválido (${PROFILES.join('|')})`)
    await send({ type: 'set-profile', profile: args[0] })
    break
  case 'edit': {
    if (!args[0]) die('edit <etapa> [--model ...]')
    const patch = patchFrom(flags)
    if (Object.keys(patch).length === 0) die('nada para mudar')
    await send({ type: 'edit-step', stepId: args[0], patch })
    break
  }
  case 'add': {
    const step = { id: flags.id, title: flags.title, role: flags.role ?? 'builder', ...patchFrom(flags) }
    await send({ type: 'add-step', step, after: typeof flags.after === 'string' ? flags.after : undefined })
    break
  }
  case 'remove':
    if (!args[0]) die('remove <etapa>')
    await send({ type: 'remove-step', stepId: args[0] })
    break
  case 'step': {
    const [stepId, status] = args
    if (!stepId || !status) die('step <etapa> <running|done|failed|skipped> [--note "..."]')
    const r = await send({ type: 'step', stepId, status, note: typeof flags.note === 'string' ? flags.note : undefined }, { quiet: true })
    console.log(`${stepId} → ${status}`)
    const left = r.run.steps.filter(s => s.status === 'pending' || s.status === 'running').length
    console.log(left ? `${left} etapa(s) por terminar.` : 'Todas as etapas terminaram: rode `finish`.')
    break
  }
  case 'escalate': {
    const run = readRun(session())
    const step = run?.steps.find(s => s.id === args[0])
    if (!step) die(`etapa "${args[0]}" não existe`)
    const up = escalate(step)
    await send({ type: 'edit-step', stepId: step.id, patch: up })
    console.log(`\n${step.id}: ${step.model}/${step.effort} → ${up.model}/${up.effort}. Peça a aprovação da nova revisão antes de relançar.`)
    break
  }
  case 'finish':
    await send({ type: 'finish', status: flags.failed ? 'failed' : 'done', summary: typeof flags.summary === 'string' ? flags.summary : '' })
    break
  case 'dashboard': {
    const sid = session()
    if (!(await ensureServer())) die(`o dashboard não subiu na porta ${port()}`)
    const url = dashboardUrl(sid)
    if (!flags['no-open']) openBrowser(url)
    console.log(`Dashboard: ${url}`)
    break
  }
  case 'agents': {
    const agents = listAgents()
    if (!agents.length) {
      console.log(`nenhum agente em ${AGENTS_DIR}`)
      break
    }
    for (const a of agents) {
      console.log(`${a.name} · ${a.repo} · última revisão ${a.ultimaRevisao || '—'} · ${a.prs.length} PR(s) revisada(s) · ${a.file}`)
    }
    break
  }
  case 'agent': {
    const repo = String(args[0] ?? '').trim()
    if (!AGENT_REPO.test(repo)) die('agent <owner/repo> [--init]')
    const file = agentFile(repo)
    const exists = existsSync(file)
    if (!exists && flags.init) {
      mkdirSync(AGENTS_DIR, { recursive: true })
      // `wx`: never over a file someone else wrote meanwhile.
      writeFileSync(file, agentDraft(repo), { flag: 'wx' })
    }
    console.log(`AGENT_FILE: ${file}`)
    console.log(`AGENT_STATE: ${exists ? 'existente' : 'novo'}`)
    if (!exists) console.log(flags.init ? `Criado ${existsSync(AGENT_TEMPLATE) ? 'a partir do template' : 'com o mínimo (template não encontrado)'}.` : 'O arquivo ainda não existe; rode com --init para criar.')
    break
  }
  default:
    die(`comando desconhecido: ${command}\n\n${HELP}`)
}
