import { drawAllHolos } from './holo.js'
import { lineFor, momentOf } from './quotes.js'
import { draw, drawHead } from './sprite.js'

const $ = id => document.getElementById(id)

const S = {
  meta: null,
  /** Every session the mod saw (GET /api/sessions), kept live by its stream. */
  sessions: [],
  /** `sessions`, `finished` or `flow`; `sid` is the flow's session. */
  view: 'sessions',
  sid: '',
  run: null,
  /** The run's cost, pushed with every run snapshot; null until one arrives. */
  custo: null,
  isAlive: false,
  /** The repo agent's name, from its file, when the run carries one. */
  agent: null,
  isLive: false,
  isTableDirty: false,
  walker: { left: null, movingUntil: 0 },
}

const STATUS_PT = {
  awaiting_approval: 'aguardando aprovação',
  approved: 'aprovado',
  running: 'executando',
  paused: 'pausado',
  done: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
}
const STEP_PT = { pending: '○ pendente', running: '◉ rodando', done: '● feita', failed: '✖ falhou', skipped: '⊘ pulada' }
const TIER_VAR = { haiku: 'var(--haiku)', sonnet: 'var(--sonnet)', opus: 'var(--opus)' }
const AGENT_TYPES = ['general-purpose', 'Explore', 'Plan']

/** Builds an element; strings become text, never HTML. */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'style') node.style.cssText = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else if (k in node && typeof v !== 'string') node[k] = v
    else node.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c))
  return node
}

const isTerminal = s => s === 'done' || s === 'failed' || s === 'cancelled'
const isApproved = r => r.approval && r.approval.revision === r.revision
const time = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

let toastTimer
function toast(text, isError = false) {
  const t = $('toast')
  t.textContent = text
  t.className = `toast${isError ? ' error' : ''}`
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (t.hidden = true), 3200)
}

async function post(cmd) {
  try {
    const r = await fetch(`/api/runs/${encodeURIComponent(S.sid)}/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
    })
    const body = await r.json()
    if (!body.ok) {
      toast(body.error ?? 'Não deu certo', true)
      return false
    }
    if (body.run) apply({ run: body.run, isAlive: body.isAlive, custo: body.custo })
    return true
  } catch (err) {
    toast(`Sem conexão com o dashboard: ${err.message}`, true)
    return false
  }
}

// ------------------------------------------------------------ data

/** The sessions list, pushed by the server whenever a session opens, closes or moves. */
let liveSessions
function connectSessions() {
  liveSessions?.close()
  liveSessions = new EventSource('/api/sessions/stream')
  liveSessions.addEventListener('sessions', e => {
    S.isLive = true
    S.sessions = JSON.parse(e.data)
    renderLists()
    if (S.view === 'flow') renderSessionHead()
  })
  liveSessions.onopen = () => {
    S.isLive = true
    renderPills()
  }
  liveSessions.onerror = () => {
    S.isLive = false
    renderPills()
  }
}

let source
/** One session's run, while its flow is on screen. */
function connect() {
  source?.close()
  source = null
  if (S.view !== 'flow' || !S.sid) return
  source = new EventSource(`/api/runs/${encodeURIComponent(S.sid)}/stream`)
  source.addEventListener('run', e => apply(JSON.parse(e.data)))
}

// ------------------------------------------------------------ routing: #/sessoes, #/finalizadas, #/sessao/<id>

function route() {
  const legacy = new URLSearchParams(location.search).get('session')
  if (legacy && !location.hash) {
    history.replaceState(null, '', `${location.pathname}#/sessao/${encodeURIComponent(legacy)}`)
  }
  // Link antigo da torre (`#agente=<id>`) vira a rota da aba Agentes.
  const legacyAgent = /^#agente=(.+)$/.exec(location.hash)
  if (legacyAgent) history.replaceState(null, '', `${location.pathname}#/agente/${legacyAgent[1]}`)
  const m = /^#\/sessao\/([\w-]{1,80})$/.exec(location.hash)
  const ag = /^#\/agente\/(.+)$/.exec(location.hash)
  const view = m ? 'flow' : ag || location.hash === '#/agentes' ? 'agentes' : location.hash === '#/finalizadas' ? 'finished' : 'sessions'
  const sid = m ? m[1] : ''
  AG.sel = null
  if (ag) {
    try {
      AG.sel = decodeURIComponent(ag[1])
    } catch {
      AG.sel = null
    }
  }
  if (sid !== S.sid) {
    S.run = null
    S.custo = null
    S.agent = null
    S.isAlive = false
    S.walker = { left: null, movingUntil: 0 }
  }
  S.view = view
  S.sid = sid
  $('view-sessions').hidden = view !== 'sessions'
  $('view-finished').hidden = view !== 'finished'
  $('view-flow').hidden = view !== 'flow'
  $('view-agentes').hidden = view !== 'agentes'
  for (const [tab, v] of [['tab-sessions', 'sessions'], ['tab-finished', 'finished'], ['tab-agentes', 'agentes']]) {
    $(tab).classList.toggle('on', view === v)
    $(tab).setAttribute('aria-current', view === v ? 'page' : 'false')
  }
  connect()
  if (view === 'agentes') {
    if (!AG.source || AG.source.readyState === EventSource.CLOSED) connectAgentes()
    renderAgentes()
  } else if (AG.source || AG.poll) connectAgentes()
  renderLists()
  if (view === 'flow') {
    renderSessionHead()
    render()
  }
  window.scrollTo(0, 0)
}

const go = sid => (location.hash = `#/sessao/${encodeURIComponent(sid)}`)

// ------------------------------------------------------------ sessions: cards, tabs and the running rail

const sessionOf = sid => S.sessions.find(s => s.sessionId === sid) ?? null
const isRunning = s => s.isAlive && s.run && !isTerminal(s.run.status)
const nameOf = s => s.title || s.project || `sessão ${s.sessionId.slice(0, 8)}`

function ago(ms) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86_400) return `há ${Math.round(s / 3600)} h`
  return `há ${Math.round(s / 86_400)} d`
}

/** The tail of a path, enough to recognise the folder. */
function shortPath(p) {
  if (!p) return ''
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/')
}

function progressBar(run) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0
  return el('div', { class: 'bar', title: `${run.done}/${run.total} etapas` }, el('span', { style: `width:${pct}%` }))
}

/** Where the flow stands, in one line: the wave and the step in progress. */
function stepLine(run) {
  if (run.status === 'done') return `Concluído · ${run.done}/${run.total} etapas`
  if (run.status === 'awaiting_approval') return `Aguardando aprovação · ${run.total} etapas em ${run.waves} onda(s)`
  if (!run.step) return `${run.done}/${run.total} etapas`
  const who = run.step.mode === 'inline' ? 'Ultron' : `${run.step.model}/${run.step.effort}`
  const more = run.running > 1 ? ` (+${run.running - 1})` : ''
  return `Onda ${run.wave}/${run.waves} · ${run.step.title}${more} · ${who}`
}

function statusBadge(status) {
  return el('span', { class: `status-badge st-${status}` }, STATUS_PT[status] ?? status)
}

const NEUTRAL = '#8a93a6'

/** The hologram of the session's AI; a closed or repo-less session gets a faint neutral one. */
function holo(s, size) {
  const color = s.ai ? s.ai.color : NEUTRAL
  return el('canvas', { class: `holo holo-${size}`, 'data-holo': color, 'data-dim': s.ai ? '0' : '1', 'aria-hidden': 'true' })
}

/** One labelled line of a card: what it is, then the value. */
const info = (label, value, extra = {}) => (value ? el('div', { class: 'info-row' }, el('dt', {}, label), el('dd', extra, value)) : null)

function flowBlock(s, isCompact) {
  const run = s.run
  if (run) {
    return el(
      'div',
      { class: 'scard-flow' },
      el('div', { class: 'scard-status' }, statusBadge(run.status), isCompact ? null : el('span', { class: 'muted small' }, run.playbook)),
      isCompact ? null : el('p', { class: 'scard-goal' }, run.goal),
      progressBar(run),
      el('div', { class: 'scard-step' }, stepLine(run)),
    )
  }
  if (s.pendingTask) return el('p', { class: 'scard-todo' }, '⏳ Tarefa na fila: ', el('span', { class: 'muted' }, s.pendingTask.prompt))
  return el('p', { class: 'scard-todo' }, 'Sem fluxo do Ultron. ', el('strong', {}, 'Defina uma tarefa'), ' para montar o fluxo.')
}

function sessionCard(s, kind) {
  const run = s.run
  const isCompact = kind === 'rail'
  const title = nameOf(s)
  const headline = s.ai ? s.ai.label : title
  const footer = isCompact
    ? null
    : el(
        'footer',
        { class: 'scard-foot' },
        el('span', { class: 'mono muted small', title: s.sessionId }, s.sessionId.slice(0, 8)),
        el('span', { class: 'muted small' }, s.isAlive ? `aberta ${ago(s.startedAt)}` : `encerrada ${ago(s.lastSeen)}`),
        kind === 'finished' ? el('button', { class: 'btn btn-small', type: 'button', onclick: e => (e.stopPropagation(), go(s.sessionId), focusStart()) }, 'Continuar com nova tarefa') : null,
        kind === 'sessions' && (!run || isTerminal(run.status)) && !s.pendingTask
          ? el('button', { class: 'btn btn-small', type: 'button', onclick: e => (e.stopPropagation(), go(s.sessionId), focusStart()) }, run ? 'Nova tarefa' : 'Definir fluxo')
          : null,
      )
  return el(
    'article',
    {
      class: `scard ${isCompact ? 'compact' : kind} ${s.isAlive ? 'alive' : 'closed'} ${s.ai ? 'has-ai' : 'no-ai'} ${run ? `run-${run.status}` : 'no-run'} ${s.sessionId === S.sid && S.view === 'flow' ? 'selected' : ''}`,
      style: `--ai:${s.ai ? s.ai.color : NEUTRAL}`,
      tabindex: '0',
      role: 'link',
      'aria-label': `Abrir o fluxo de ${headline}`,
      onclick: () => go(s.sessionId),
      onkeydown: e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), go(s.sessionId)),
    },
    el(
      'header',
      { class: 'scard-head' },
      holo(s, isCompact ? 'xs' : 'sm'),
      el(
        'div',
        { class: 'scard-names' },
        el('h3', { class: 'scard-title', title: headline }, headline),
        s.ai ? el('div', { class: 'scard-sub', title }, title) : null,
      ),
      el('span', { class: 'dot', title: s.isAlive ? 'sessão aberta' : 'sessão encerrada' }),
    ),
    isCompact
      ? null
      : el(
          'dl',
          { class: 'scard-info' },
          info('Repositório', s.repo?.name, { class: 'mono' }),
          info('Branch', s.branch ? el('span', { class: 'chip branch' }, '⎇ ', s.branch) : null),
          info('Pasta', shortPath(s.cwd), { class: 'mono', title: s.cwd ?? '' }),
        ),
    flowBlock(s, isCompact),
    footer,
  )
}

/** Open sessions grouped by repository, each group under its AI's name and colour; repo-less ones last. */
function repoGroups(active) {
  const groups = new Map()
  for (const s of active) {
    const key = s.repo?.key ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }
  const keyed = [...groups.entries()].sort(([a, x], [b, y]) => (a === '') - (b === '') || Number(y.some(isRunning)) - Number(x.some(isRunning)) || (x[0].ai?.name ?? '').localeCompare(y[0].ai?.name ?? ''))
  return keyed.map(([key, list]) => {
    const lead = list[0]
    const ai = key ? lead.ai : null
    const running = list.filter(isRunning).length
    return el(
      'section',
      { class: `repo-group ${ai ? 'has-ai' : 'no-ai'}`, style: `--ai:${ai ? ai.color : NEUTRAL}` },
      el(
        'header',
        { class: 'repo-head' },
        holo(key ? lead : { ai: null }, 'md'),
        el(
          'div',
          { class: 'repo-names' },
          el('h2', { class: 'repo-ai' }, ai ? ai.name : 'Sem repositório'),
          el('div', { class: 'repo-name mono' }, key ? lead.repo.name : 'sessões fora de um repositório git'),
        ),
        el('div', { class: 'repo-count' }, el('strong', {}, String(list.length)), list.length === 1 ? ' sessão' : ' sessões', running ? el('span', { class: 'muted' }, ` · ${running} com fluxo`) : null),
      ),
      el('div', { class: 'session-grid' }, list.map(s => sessionCard(s, 'sessions'))),
    )
  })
}

function renderLists() {
  const active = S.sessions.filter(s => s.isAlive).sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || (a.startedAt ?? 0) - (b.startedAt ?? 0))
  const finished = S.sessions.filter(s => !s.isAlive && s.run).sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  const running = S.sessions.filter(isRunning).sort((a, b) => (b.run.updatedAt ?? 0) - (a.run.updatedAt ?? 0))
  $('count-alive').textContent = String(active.length)
  $('count-done').textContent = String(finished.length)
  $('count-running').textContent = String(running.length)
  if (S.view === 'sessions') {
    $('sessions-grid').replaceChildren(...repoGroups(active))
    $('sessions-empty').hidden = active.length > 0
    const repos = new Set(active.map(s => s.repo?.key).filter(Boolean)).size
    $('sessions-caption').textContent = active.length ? `${active.length} aberta(s) em ${repos} repositório(s) · ${running.length} com fluxo em andamento` : ''
  }
  if (S.view === 'finished') {
    $('finished-grid').replaceChildren(...finished.map(s => sessionCard(s, 'finished')))
    $('finished-empty').hidden = finished.length > 0
    $('finished-caption').textContent = finished.length ? `${finished.length} sessão(ões) encerrada(s) em que o Ultron trabalhou` : ''
  }
  $('rail-list').replaceChildren(...running.map(s => sessionCard(s, 'rail')))
  $('rail-empty').hidden = running.length > 0
}

/** The flow screen's header: which AI, which session, where, and whether it is open. */
function renderSessionHead() {
  const s = sessionOf(S.sid)
  const title = s ? nameOf(s) : `sessão ${S.sid.slice(0, 8)}`
  const head = $('view-flow').querySelector('.flow-head')
  head.style.setProperty('--ai', s?.ai ? s.ai.color : NEUTRAL)
  const h = $('flow-holo')
  h.dataset.holo = s?.ai ? s.ai.color : NEUTRAL
  h.dataset.dim = s?.ai ? '0' : '1'
  $('session-ai').textContent = s?.ai ? s.ai.label : ''
  $('session-ai').hidden = !s?.ai
  $('session-title').textContent = title
  const meta = []
  if (s?.repo) meta.push(el('span', { class: 'chip mono' }, s.repo.name))
  if (s?.branch) meta.push(el('span', { class: 'chip branch' }, '⎇ ', s.branch))
  if (s?.cwd) meta.push(el('span', { class: 'mono muted small', title: s.cwd }, shortPath(s.cwd)))
  meta.push(
    el(
      'button',
      {
        class: 'chip copy',
        type: 'button',
        title: 'Copiar o comando para retomar esta sessão',
        onclick: () => copy(`claude --resume ${S.sid}`),
      },
      el('span', { class: 'mono' }, S.sid.slice(0, 8)),
      ' ⧉',
    ),
  )
  if (s) meta.push(el('span', { class: 'muted small' }, s.isAlive ? `aberta ${ago(s.startedAt)}` : `encerrada ${ago(s.lastSeen)}`))
  $('session-meta').replaceChildren(...meta)
  S.isAlive = Boolean(s?.isAlive)
  renderPills()
  renderStart()
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast(`Copiado: ${text}`)
  } catch {
    toast(text)
  }
}

// ------------------------------------------------------------ starting a task from here

/** Shown while the session has no flow under way: a new task, sent to the session's terminal. */
function renderStart() {
  const s = sessionOf(S.sid)
  const run = S.run
  const isUnderWay = run && run.revision > 0 && !isTerminal(run.status)
  const panel = $('start')
  panel.hidden = S.view !== 'flow' || isUnderWay || (!s && !run)
  if (panel.hidden) return
  const isOpen = Boolean(s?.isAlive)
  $('start-title').textContent = isOpen ? (run ? 'Nova tarefa nesta sessão' : 'Iniciar uma tarefa nesta sessão') : 'Continuar esta sessão com uma nova tarefa'
  $('start-hint').textContent = isOpen
    ? 'A tarefa roda como /ultron <tarefa> no terminal desta sessão. O Ultron monta o fluxo e espera a sua aprovação aqui.'
    : 'Abre um terminal na pasta da sessão com claude --resume. A tarefa começa assim que a sessão voltar, e o plano espera a sua aprovação.'
  $('start-submit').textContent = isOpen ? 'Iniciar com o Ultron' : 'Abrir sessão e iniciar'
  const pending = s?.pendingTask
  $('start-pending').hidden = !pending
  $('start-form').hidden = Boolean(pending)
  if (pending) $('start-pending-text').textContent = `⏳ Na fila: “${pending.prompt}” (${ago(pending.at)})`
}

function focusStart() {
  setTimeout(() => $('start-prompt').focus(), 60)
}

async function sendTask(body) {
  try {
    const r = await fetch(`/api/sessions/${encodeURIComponent(S.sid)}/task`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const answer = await r.json()
    if (!answer.ok) {
      toast(answer.error ?? 'Não deu certo', true)
      return false
    }
    if (answer.warning) toast(answer.warning, true)
    else if (answer.mode === 'opened') toast('Abrindo a sessão num terminal; a tarefa começa quando ela voltar.')
    else if (answer.mode === 'sent') toast('Tarefa enviada: o Ultron vai montar o fluxo nesta sessão.')
    return true
  } catch (err) {
    toast(`Sem conexão com o dashboard: ${err.message}`, true)
    return false
  }
}

function apply({ run, isAlive, agent, custo }) {
  S.run = run
  S.custo = custo ?? null
  // The session's own heartbeat says whether it is open; the run's says whether the flow answers.
  S.isAlive = Boolean(sessionOf(S.sid)?.isAlive || isAlive)
  if (agent !== undefined) S.agent = agent
  render()
}

// ------------------------------------------------------------ render

function render() {
  renderPills()
  if (S.view !== 'flow') return
  renderStart()
  const run = S.run
  const hasRun = Boolean(run && run.revision > 0)
  $('empty').hidden = hasRun
  $('content').hidden = !hasRun
  if (!hasRun) return
  renderBanner(run)
  renderHero(run)
  renderJourney(run)
  if (document.activeElement?.closest('#flow-body')) S.isTableDirty = true
  else renderTable(run)
  renderProfiles(run)
  renderMix(run)
  renderLog(run)
}

function renderPills() {
  const live = $('live')
  live.textContent = S.isLive ? '● ao vivo' : '● offline'
  live.className = `pill ${S.isLive ? 'pill-ok' : 'pill-muted'}`
  const alive = $('alive')
  alive.textContent = S.isAlive ? 'sessão aberta' : 'sessão encerrada'
  alive.className = `pill ${S.isAlive ? 'pill-ok' : 'pill-warn'}`
  alive.title = S.isAlive ? 'O Claude Code está rodando esta sessão' : 'A sessão do Claude Code não está aberta; mudanças ficam gravadas para quando ela voltar'
}

function renderBanner(run) {
  const waiting = run.status === 'awaiting_approval'
  $('approval').hidden = !waiting
  if (!waiting) return
  const changed = run.events.filter(e => e.text.includes(`rev ${run.revision}`)).at(-1)
  $('approval-detail').textContent = `Revisão ${run.revision}${changed ? ` — última mudança: ${changed.text.split(' → ')[0]} (${changed.by})` : ''}. Aprove aqui ou responda "aprovar" no chat.`
}

function renderHero(run) {
  $('goal').textContent = run.goal
  $('rationale').textContent = run.rationale || ''
  const done = run.steps.filter(s => s.status === 'done').length
  const total = run.steps.filter(s => s.status !== 'skipped').length
  const meter = el('span', { class: 'meter', title: `complexidade ${run.complexity}/10` }, ...Array.from({ length: 10 }, (_, i) => el('i', { class: i < run.complexity ? 'on' : '' })))
  $('chips').replaceChildren(
    ...[
      el('span', { class: 'chip' }, '▶ ', run.playbook),
      el('span', { class: 'chip' }, 'perfil ', run.profile),
      el('span', { class: 'chip' }, 'complexidade', meter),
      run.agent && el('span', { class: 'chip', title: `agente do repo ${run.agent}` }, 'agente: ', S.agent?.name ?? `revisor-${run.agent.split('/')[1]}`),
      run.feedback && el('span', { class: 'chip', style: 'color:var(--accent)' }, 'mudanças pedidas: ', run.feedback),
    ].filter(Boolean),
  )
  const st = $('status')
  st.textContent = STATUS_PT[run.status] ?? run.status
  st.className = `status-badge st-${run.status}`
  $('progress').textContent = `${done}/${total}`
  $('revision').textContent = `rev ${run.revision}${isApproved(run) ? ` ✓ ${run.approval.by}` : ''}`
  const pause = $('pause')
  pause.textContent = run.status === 'paused' ? 'Retomar' : 'Pausar'
  pause.disabled = isTerminal(run.status)
  $('cancel').disabled = isTerminal(run.status)
}

/** The waves, in order, each with its steps. */
function stationsOf(run) {
  const waves = [...new Set(run.steps.map(s => s.wave))].sort((a, b) => a - b)
  return waves.map(w => ({ wave: w, steps: run.steps.filter(s => s.wave === w) }))
}

function currentStation(run, stations) {
  if (run.status === 'done') return stations.length
  const live = stations.findIndex(st => st.steps.some(s => s.status === 'running'))
  if (live >= 0) return live
  const open = stations.findIndex(st => st.steps.some(s => s.status === 'pending' || s.status === 'failed'))
  return open >= 0 ? open : stations.length
}

function renderJourney(run) {
  const stations = stationsOf(run)
  const at = currentStation(run, stations)
  const nodes = stations.map((st, i) => {
    const isDone = st.steps.every(s => s.status === 'done' || s.status === 'skipped')
    const hasFailed = st.steps.some(s => s.status === 'failed')
    const cls = ['station', isDone ? 'done' : '', i === at ? 'current' : '', hasFailed ? 'failed' : ''].join(' ')
    return el(
      'div',
      { class: cls, 'data-i': i },
      el('div', { class: 'node' }),
      el('div', { class: 'station-label' }, `ONDA ${st.wave}`),
      el(
        'div',
        { class: 'cards' },
        st.steps.map(s =>
          el(
            'div',
            { class: `card ${s.status}`, style: `--tier:${TIER_VAR[s.model]}`, title: `${s.title}\n${s.role} · ${s.mode === 'inline' ? 'inline' : s.agentType}` },
            el('div', { class: 'card-title' }, s.title),
            el('div', { class: 'card-meta' }, el('span', { class: 'mono' }, s.id), el('span', {}, s.mode === 'inline' ? 'Ultron' : `${s.model}/${s.effort}`)),
          ),
        ),
      ),
    )
  })
  nodes.push(
    el(
      'div',
      { class: `station finish ${run.status === 'done' ? 'current done' : ''}`, 'data-i': stations.length },
      el('div', { class: 'node' }),
      el('div', { class: 'station-label' }, 'FIM'),
      el('div', { class: 'flag' }, run.status === 'done' ? '🏁' : '⚑'),
    ),
  )
  $('stations').replaceChildren(...nodes)
  const { done, total } = { done: run.steps.filter(s => s.status === 'done').length, total: run.steps.length }
  $('journey-caption').textContent = `${done} de ${total} etapas · ${stations.length} onda(s)`

  placeWalker(at)
}

/** Half the walker's width (see .walker in styles.css). */
const WALKER_HALF = 80

/** Puts Ultron over the station in progress; the CSS transition makes him walk there. */
function placeWalker(at) {
  const target = $('stations').querySelector(`[data-i="${at}"] .node`)
  const journey = $('journey')
  if (!target || journey.offsetParent === null) return
  const center = target.getBoundingClientRect().left - journey.getBoundingClientRect().left + target.offsetWidth / 2
  const left = Math.round(center - WALKER_HALF)
  if (S.walker.left !== null && S.walker.left !== left) {
    S.walker.movingUntil = performance.now() + 900
    target.closest('.station')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }
  S.walker.left = left
  $('walker').style.left = `${left}px`
  $('road-lit').style.width = `${Math.max(0, center - 24)}px`
}

function pose(run, now) {
  if (S.walker.movingUntil > now) return 'walk'
  if (run.status === 'awaiting_approval') return 'wait'
  if (run.status === 'done') return 'win'
  if (run.status === 'failed' || run.status === 'cancelled') return 'fail'
  if (run.steps.some(s => s.status === 'failed')) return 'fail'
  if (run.steps.some(s => s.status === 'running')) return 'work'
  return 'idle'
}

/** Ultron's line for the moment: the same one the terminal pane shows at the same time. */
function sayFor(run, p) {
  return lineFor(run, momentOf(run, p === 'walk'), Date.now())
}

const opt = (value, label, current) => el('option', { value, selected: value === current }, label)

function renderTable(run) {
  S.isTableDirty = false
  const meta = S.meta
  const locked = s => isTerminal(run.status) || (s.status !== 'pending' && s.status !== 'failed')
  const send = (s, patch) => post({ type: 'edit-step', stepId: s.id, patch })
  const rows = run.steps.map((s, i) => {
    const isLocked = locked(s)
    const roles = Object.keys(meta.roles)
    if (!roles.includes(s.role)) roles.push(s.role)
    const types = AGENT_TYPES.includes(s.agentType) ? AGENT_TYPES : [...AGENT_TYPES, s.agentType]
    return el(
      'tr',
      { class: isLocked ? 'locked' : '' },
      el(
        'td',
        {},
        el(
          'div',
          { class: 'order' },
          el('button', { class: 'icon-btn', title: 'Subir', 'aria-label': `Subir ${s.id}`, disabled: isLocked || i === 0, onclick: () => post({ type: 'move-step', stepId: s.id, delta: -1 }) }, '▲'),
          el('button', { class: 'icon-btn', title: 'Descer', 'aria-label': `Descer ${s.id}`, disabled: isLocked || i === run.steps.length - 1, onclick: () => post({ type: 'move-step', stepId: s.id, delta: 1 }) }, '▼'),
        ),
      ),
      el(
        'td',
        {},
        el('div', { class: 'step-id' }, s.id),
        el('input', { class: 'title', value: s.title, disabled: isLocked, 'aria-label': `Título de ${s.id}`, onchange: e => send(s, { title: e.target.value }) }),
      ),
      el(
        'td',
        {},
        el('select', { disabled: isLocked, 'aria-label': `Papel de ${s.id}`, onchange: e => send(s, { role: e.target.value }) }, roles.map(r => opt(r, meta.roles[r]?.label ?? r, s.role))),
      ),
      el(
        'td',
        {},
        el('select', { disabled: isLocked, 'aria-label': `Execução de ${s.id}`, onchange: e => send(s, { mode: e.target.value }) }, opt('agent', 'Subagente', s.mode), opt('inline', 'Ultron (inline)', s.mode)),
        s.mode === 'agent'
          ? el('select', { disabled: isLocked, 'aria-label': `Tipo de agente de ${s.id}`, style: 'margin-top:4px', onchange: e => send(s, { agentType: e.target.value }) }, types.map(t => opt(t, t, s.agentType)))
          : null,
      ),
      el(
        'td',
        {},
        el('select', { class: 'model-select', style: `--tier:${TIER_VAR[s.model]}`, disabled: isLocked, 'aria-label': `Modelo de ${s.id}`, onchange: e => send(s, { model: e.target.value }) }, meta.models.map(m => opt(m, m, s.model))),
      ),
      el(
        'td',
        {},
        el('select', { disabled: isLocked, 'aria-label': `Effort de ${s.id}`, onchange: e => send(s, { effort: e.target.value }) }, meta.efforts.map(m => opt(m, m, s.effort))),
      ),
      el('td', {}, el('input', { class: 'wave', type: 'number', min: '1', value: String(s.wave), disabled: isLocked, 'aria-label': `Onda de ${s.id}`, onchange: e => send(s, { wave: Number(e.target.value) }) })),
      el(
        'td',
        {},
        el('input', {
          class: 'deps',
          value: s.dependsOn.join(', '),
          placeholder: '—',
          disabled: isLocked,
          'aria-label': `Dependências de ${s.id}`,
          onchange: e => send(s, { dependsOn: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }),
        }),
      ),
      el('td', {}, el('span', { class: `dot-status ds-${s.status}`, title: s.note ?? '' }, STEP_PT[s.status] ?? s.status)),
      el('td', {}, el('button', { class: 'icon-btn', title: 'Remover etapa', 'aria-label': `Remover ${s.id}`, disabled: isLocked, onclick: () => post({ type: 'remove-step', stepId: s.id }) }, '✕')),
    )
  })
  $('flow-body').replaceChildren(...rows)
  const lockAdd = isTerminal(run.status)
  for (const id of ['add-id', 'add-title', 'add-role', 'add-wave']) $(id).disabled = lockAdd
  $('add-form').querySelector('button').disabled = lockAdd
}

function renderProfiles(run) {
  $('profiles').replaceChildren(
    ...S.meta.profiles.map(p =>
      el(
        'button',
        {
          role: 'radio',
          'aria-checked': String(p === run.profile),
          class: p === run.profile ? 'on' : '',
          disabled: isTerminal(run.status),
          onclick: () => p !== run.profile && post({ type: 'set-profile', profile: p }),
        },
        p,
      ),
    ),
  )
}

/** US$ with 2 decimals, 4 under one cent. */
const usd = n => `US$ ${n.toLocaleString('pt-BR', Math.abs(n) > 0 && Math.abs(n) < 0.01 ? { minimumFractionDigits: 4, maximumFractionDigits: 4 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function renderMix(run) {
  const steps = run.steps.filter(s => s.status !== 'skipped' && s.mode === 'agent')
  const weight = S.meta.tierWeight
  const custo = S.custo
  const real = custo && custo.total > 0 ? custo : null
  // By real cost when there is one; otherwise the relative tier weight, as before.
  const by = Object.fromEntries(S.meta.models.map(m => [m, steps.filter(s => s.model === m)]))
  const share = m => (real ? real.steps.filter(c => c.model === m).reduce((n, c) => n + (c.cost ?? 0), 0) : by[m].reduce((n, s) => n + weight[s.model], 0))
  const total = S.meta.models.reduce((n, m) => n + share(m), 0) || 1
  $('mix').replaceChildren(...S.meta.models.filter(m => share(m) > 0).map(m => el('span', { style: `width:${(share(m) / total) * 100}%;background:${TIER_VAR[m]}`, title: m })))
  $('mix-legend').replaceChildren(...S.meta.models.map(m => el('span', {}, el('i', { style: `background:${TIER_VAR[m]}` }), `${m} × ${by[m].length}`)))

  const inline = custo ? custo.inline : run.steps.filter(s => s.mode === 'inline').length
  const lines = []
  if (custo && custo.steps.length) {
    const priced = custo.steps.length - custo.unpriced
    lines.push(
      el('div', { class: 'cost-row' }, el('span', { class: 'cost-big' }, priced ? usd(custo.total) : 'sem preço'), el('span', { class: 'cost-tag' }, 'equivalente à API')),
      custo.saving === null || !priced
        ? el('div', { class: 'cost-row' }, el('span', {}, `Economia contra tudo em ${custo.strong}: ${priced ? `sem preço do ${custo.strong}` : 'sem preço nas etapas'}`))
        : el('div', { class: 'cost-row' }, el('span', {}, `Economia contra tudo em ${custo.strong}: ${usd(custo.saving)}`), el('span', { class: 'cost-tag' }, 'estimativa')),
    )
    if (custo.unpriced) lines.push(el('div', { class: 'cost-note' }, `${custo.unpriced} etapa(s) sem preço, fora do total.`))
    lines.push(
      el(
        'ul',
        { class: 'cost-steps' },
        custo.steps.map(c => el('li', {}, el('i', { style: `background:${TIER_VAR[c.model]}` }), el('span', { class: 'cost-id' }, c.id), el('span', { class: 'cost-val' }, c.cost === null ? 'sem preço' : usd(c.cost)), el('span', { class: 'cost-tok' }, `${Math.round(c.tokens / 1000)}k tok`))),
      ),
    )
  } else {
    lines.push(el('div', { class: 'cost-note' }, 'Sem tokens de subagentes ainda: o custo aparece conforme as etapas terminam.'))
  }
  if (inline) lines.push(el('div', { class: 'cost-note' }, `${inline} etapa(s) inline no modelo da sessão, fora da conta.`))
  // The date travels with the cost (fresh on every push); meta is read once at load.
  const hasPrices = custo ? custo.hasPrices : Boolean(S.meta.precos)
  const when = custo ? custo.checkedAt : S.meta.precos?.conferidoEm
  lines.push(
    el(
      'div',
      { class: 'cost-note' },
      !hasPrices
        ? 'Sem tabela de preços na config (chave precos): só tokens.'
        : `${when ? `Preços conferidos em ${when}.` : 'Preços sem data de conferência (precos.conferidoEm).'} Num plano por assento a fatura é fixa: o valor serve para comparar.`,
    ),
  )
  $('tokens').replaceChildren(...lines)
}

function renderLog(run) {
  $('log').replaceChildren(
    ...[...run.events]
      .reverse()
      .slice(0, 80)
      .map(e => el('li', {}, el('time', {}, time(e.at)), el('span', {}, el('span', { class: `by by-${e.by}` }, e.by), ' ', e.text))),
  )
}

// ------------------------------------------------------------ torre: aba Agentes (lista estilo WhatsApp + perfil)

const AG = { agentes: null, geradoEm: null, lastAt: 0, live: false, warn: '', source: null, poll: null, sel: null }
const ESTADO_PT = { aguardando: 'aguardando você', executando: 'executando', pausado: 'pausado', ocioso: 'ocioso', sem_sinal: 'sem sinal' }
const AVATAR_RE = /^\/api\/torre\/avatar\/[A-Za-z0-9._-]+\.png$/
const AV_CACHE = new Map()

const initials = nome =>
  String(nome ?? '')
    .split(/[\s\-_./]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => Array.from(w)[0].toUpperCase())
    .join('') || '?'

/** Cor fixa por id: o mesmo agente tem sempre o mesmo círculo. */
function hueOf(id) {
  let n = 0
  for (const c of String(id)) n = (n * 31 + c.codePointAt(0)) >>> 0
  return n % 360
}

const estadoOf = a => (ESTADO_PT[a.estado] ? a.estado : 'ocioso')

/** Foto (só a servida pela própria torre) ou iniciais num círculo colorido. */
function avatarEl(a, size) {
  const cls = `av av-${size}`
  const fallback = () => el('span', { class: `${cls} av-initials`, style: `background:hsl(${hueOf(a.id)} 45% 36%)`, 'aria-hidden': 'true' }, initials(a.nome))
  if (typeof a.avatar !== 'string' || !AVATAR_RE.test(a.avatar)) return fallback()
  // A lista é refeita a cada mudança e o avatar sai com `no-store`: reaproveita o mesmo <img>
  // para a foto não piscar nem ser baixada de novo a cada quadro.
  const key = `${a.id}|${size}|${a.avatar}`
  let node = AV_CACHE.get(key)
  if (!node) {
    node = el('img', {
      class: cls,
      src: a.avatar,
      alt: '',
      onerror: e => {
        const f = fallback()
        e.target.replaceWith(f)
        AV_CACHE.set(key, f)
      },
    })
    AV_CACHE.set(key, node)
  }
  return node
}

/** HH:MM se for hoje, DD/MM antes. */
function stamp(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function agoAtualizado(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'sem registro'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `atualizado há ${s}s`
  if (s < 3600) return `atualizado há ${Math.floor(s / 60)} min`
  return `atualizado há ${Math.floor(s / 3600)} h`
}

const isHttp = u => typeof u === 'string' && /^https?:\/\//i.test(u)

function agentRow(a) {
  const estado = estadoOf(a)
  const open = AG.sel === a.id
  const preview = a.fazendo || a.papel || ESTADO_PT[estado]
  return el(
    'button',
    {
      type: 'button',
      class: `lr ag-${estado}${open ? ' open' : ''}`,
      'data-id': a.id,
      title: `${a.nome} · ${ESTADO_PT[estado]}`,
      'aria-label': `${a.nome}, ${ESTADO_PT[estado]}`,
      'aria-current': open ? 'true' : null,
      onclick: () => openAgent(a),
    },
    el('span', { class: 'lr-pic' }, avatarEl(a, 'm'), el('i', { class: 'ag-dot', 'aria-hidden': 'true' })),
    el(
      'span',
      { class: 'lr-body' },
      el('span', { class: 'lr-top' }, el('span', { class: 'lr-name' }, a.nome), el('time', { class: 'lr-time' }, stamp(a.atualizadoEm))),
      el('span', { class: 'lr-bottom' }, el('span', { class: 'lr-preview' }, preview), estado === 'aguardando' && el('span', { class: 'lr-badge' }, 'aguardando')),
    ),
  )
}

function renderAgentes() {
  const list = AG.agentes
  if (list) $('count-agentes').textContent = String(list.length)
  if (S.view !== 'agentes') return
  $('agentes-empty').hidden = !(list && list.length === 0)
  const keep = document.activeElement?.closest?.('.lr')?.dataset.id
  $('agentes-list').replaceChildren(...(list ?? []).map(agentRow))
  if (keep) [...$('agentes-list').children].find(n => n.dataset.id === keep)?.focus({ preventScroll: true })
  const live = $('agentes-live')
  live.textContent = AG.live ? '● ao vivo' : '● offline'
  live.className = `pill ${AG.live ? 'pill-ok' : 'pill-muted'}`
  const warn = $('agentes-warn')
  warn.hidden = !AG.warn
  warn.textContent = AG.warn
  renderPerfil()
}

function field(label, value) {
  return el('div', { class: 'pf-field' }, el('span', { class: 'pf-label' }, label), el('span', { class: 'pf-value' }, value))
}

function renderPerfil() {
  const box = $('perfil')
  if (AG.sel === null) {
    return box.replaceChildren(el('div', { class: 'pf-vazio' }, el('h2', {}, 'Agentes'), el('p', { class: 'muted' }, 'Escolha um agente na lista para ver o que ele está fazendo.')))
  }
  const a = AG.agentes?.find(x => x.id === AG.sel)
  if (!AG.agentes) return box.replaceChildren(el('p', { class: 'muted' }, 'Carregando…'))
  if (!a) {
    return box.replaceChildren(
      el('h2', {}, 'Agente'),
      el('p', { class: 'pf-missing', role: 'status' }, 'agente não encontrado'),
      el('p', { class: 'muted small' }, 'Ele não está mais na lista (o arquivo de presença sumiu ou a sessão fechou).'),
      el('a', { class: 'btn', href: '#/agentes' }, 'Voltar à lista'),
    )
  }
  const estado = estadoOf(a)
  box.replaceChildren(
    ...[
      el(
        'div',
        { class: `pf-head ag-${estado}` },
        avatarEl(a, 'l'),
        el(
          'div',
          { class: 'pf-id' },
          el('h1', {}, a.nome),
          a.papel && el('div', { class: 'muted' }, a.papel),
          el('span', { class: 'ag-state' }, el('i', { class: 'ag-dot', 'aria-hidden': 'true' }), ESTADO_PT[estado]),
        ),
      ),
      a.erro && el('div', { class: 'ag-error', role: 'alert' }, '⚠ ', a.erro),
      el(
        'div',
        { class: 'pf-fields' },
        field('Fazendo', a.fazendo ?? '—'),
        field('Fila', a.fila === null || a.fila === undefined ? '—' : String(a.fila)),
        field('Sessão', a.sessao ? el('span', { class: 'mono', title: a.sessao }, a.sessao.slice(0, 8)) : '—'),
        field('Atualizado', el('span', { id: 'pf-age' }, agoAtualizado(a.atualizadoEm))),
      ),
      a.tipo === 'ultron' && a.sessao && el('button', { class: 'btn', type: 'button', onclick: () => go(a.sessao) }, 'Abrir a jornada'),
      el('h2', { class: 'pf-sub' }, 'Projetos'),
      a.projetos?.length
        ? el(
            'ul',
            { class: 'pf-projects' },
            a.projetos.map(p =>
              el(
                'li',
                {},
                el('span', { class: 'pf-repo mono' }, p.repo),
                p.item && el('span', { class: 'pf-item mono' }, p.item),
                p.titulo && el('span', { class: 'pf-title' }, p.titulo),
                p.estado && el('span', { class: 'ag-badge' }, p.estado),
                isHttp(p.link) && el('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer' }, 'abrir ↗'),
              ),
            ),
          )
        : el('p', { class: 'muted small' }, 'Nenhum projeto informado.'),
      el('p', { class: 'muted small pf-note' }, 'Passos, linha do tempo e custo ao vivo chegam na próxima etapa da torre.'),
    ].filter(Boolean),
  )
}

function renderAge() {
  const a = AG.sel !== null ? AG.agentes?.find(x => x.id === AG.sel) : null
  const n = $('pf-age')
  if (a && n) n.textContent = agoAtualizado(a.atualizadoEm)
}

function applyAgentes(body) {
  if (!body || !Array.isArray(body.agentes)) return
  AG.agentes = body.agentes
  AG.geradoEm = typeof body.geradoEm === 'number' ? body.geradoEm : null
  AG.lastAt = Date.now()
  renderAgentes()
}

async function pollAgentes() {
  try {
    const r = await fetch('/api/torre/agentes')
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const body = await r.json()
    AG.warn = AG.source?.readyState === 1 ? '' : 'Conexão ao vivo indisponível. Atualizando a cada 5 s.'
    applyAgentes(body)
  } catch (err) {
    AG.warn = `Sem conexão com a torre (${err.message}). Tentando de novo a cada 5 s.`
    renderAgentes()
  }
}

function startPolling() {
  if (AG.poll) return
  pollAgentes()
  AG.poll = setInterval(pollAgentes, 5000)
}

function stopPolling() {
  clearInterval(AG.poll)
  AG.poll = null
}

/** A torre ao vivo só enquanto a aba Agentes está na tela: fora dela, uma conexão a menos. */
function connectAgentes() {
  AG.source?.close()
  AG.source = null
  stopPolling()
  if (S.view !== 'agentes') {
    AG.live = false
    return
  }
  AG.source = new EventSource('/api/torre/stream')
  AG.source.onopen = () => {
    AG.live = true
    AG.warn = ''
    renderAgentes()
  }
  AG.source.onmessage = e => {
    AG.live = true
    AG.warn = ''
    stopPolling()
    try {
      applyAgentes(JSON.parse(e.data))
    } catch {
      /* a broken frame is replaced by the next one */
    }
  }
  AG.source.onerror = () => {
    AG.live = false
    AG.warn = 'Conexão ao vivo caiu. Atualizando a cada 5 s até voltar.'
    renderAgentes()
    startPolling()
  }
}

function openAgent(a) {
  if (a.tipo === 'ultron' && a.sessao) go(a.sessao)
  else location.hash = `#/agente/${encodeURIComponent(a.id)}`
}

setInterval(renderAge, 1000)

// ------------------------------------------------------------ aba escondida solta as conexões ao vivo

// O navegador abre no máximo 6 conexões por endereço, e cada aba do dashboard segura até duas ao vivo
// (sessões e jornada, ou sessões e torre). Com várias abas abertas, a seguinte ficava na fila e não
// carregava. Aba escondida solta todas e reconecta quando volta para a frente.
function pauseLive() {
  source?.close()
  source = null
  liveSessions?.close()
  liveSessions = null
  AG.source?.close()
  AG.source = null
  stopPolling()
}

function resumeLive() {
  if (!liveSessions || liveSessions.readyState === EventSource.CLOSED) connectSessions()
  if (!source || source.readyState === EventSource.CLOSED) connect()
  if (!AG.source || AG.source.readyState === EventSource.CLOSED) connectAgentes()
}

document.addEventListener('visibilitychange', () => (document.hidden ? pauseLive() : resumeLive()))
addEventListener('pagehide', pauseLive)
addEventListener('pageshow', e => {
  if (e.persisted && !document.hidden) resumeLive()
})

// ------------------------------------------------------------ actions

$('approve').onclick = () => post({ type: 'approve', revision: S.run?.revision })
$('ask-changes').onclick = () => {
  $('reject-form').hidden = false
  $('reject-reason').focus()
}
$('reject-cancel').onclick = () => ($('reject-form').hidden = true)
$('reject-form').onsubmit = async e => {
  e.preventDefault()
  const reason = $('reject-reason').value.trim()
  if (!reason) return $('reject-reason').focus()
  if (await post({ type: 'reject', reason })) {
    $('reject-reason').value = ''
    $('reject-form').hidden = true
    toast('Pedido enviado ao Ultron')
  }
}
$('pause').onclick = () => post({ type: S.run?.status === 'paused' ? 'resume' : 'pause' })

let armTimer
$('cancel').onclick = e => {
  const b = e.currentTarget
  if (!b.classList.contains('armed')) {
    b.classList.add('armed')
    b.textContent = 'Confirmar?'
    armTimer = setTimeout(() => {
      b.classList.remove('armed')
      b.textContent = 'Cancelar'
    }, 3000)
    return
  }
  clearTimeout(armTimer)
  b.classList.remove('armed')
  b.textContent = 'Cancelar'
  post({ type: 'cancel' })
}

$('add-form').onsubmit = async e => {
  e.preventDefault()
  const step = { id: $('add-id').value.trim(), title: $('add-title').value.trim(), role: $('add-role').value, wave: Number($('add-wave').value) || 1 }
  if (await post({ type: 'add-step', step })) {
    $('add-id').value = ''
    $('add-title').value = ''
  }
}

$('start-form').onsubmit = async e => {
  e.preventDefault()
  const prompt = $('start-prompt').value.trim()
  if (!prompt) return $('start-prompt').focus()
  const isOpen = Boolean(sessionOf(S.sid)?.isAlive)
  $('start-submit').disabled = true
  const ok = await sendTask({ prompt, open: !isOpen })
  $('start-submit').disabled = false
  if (ok) $('start-prompt').value = ''
}
$('start-prompt').onkeydown = e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('start-form').requestSubmit()
}
$('start-pending-cancel').onclick = () => sendTask({ cancel: true })

window.addEventListener('hashchange', route)

window.addEventListener('resize', () => S.run && renderJourney(S.run))

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (S.isTableDirty && S.run && !document.activeElement?.closest('#flow-body')) renderTable(S.run)
  }, 50)
})

// ------------------------------------------------------------ animation

function frame(now) {
  const run = S.run
  drawHead($('logo'), now)
  draw($('rail-sprite'), S.sessions.some(s => isRunning(s) && s.run.running > 0) ? 'work' : 'idle', now)
  drawAllHolos(now)
  if (S.view === 'sessions' && !$('sessions-empty').hidden) draw($('empty-sessions-sprite'), 'idle', now)
  if (S.view === 'flow' && !$('start').hidden) draw($('start-sprite'), 'wait', now)
  if (S.view === 'flow' && !$('empty').hidden) draw($('empty-sprite'), 'wait', now)
  if (S.view === 'flow' && run && !$('content').hidden) {
    const p = pose(run, now)
    draw($('ultron'), p, now)
    const say = sayFor(run, p)
    if ($('walker-say').textContent !== say) $('walker-say').textContent = say
    $('walker').classList.toggle('triumph', p === 'win')
  }
  requestAnimationFrame(frame)
}

// ------------------------------------------------------------ start

async function start() {
  S.meta = await (await fetch('/api/meta')).json()
  $('add-role').replaceChildren(...Object.entries(S.meta.roles).map(([k, r]) => opt(k, r.label, 'builder')))
  connectSessions()
  route()
  if (S.view !== 'agentes') pollAgentes() // só o número da aba Agentes
  if (document.hidden) pauseLive() // aberta em segundo plano: conecta só quando for vista
  // Relative times ("há 5 min") age even when nothing changes.
  setInterval(() => {
    if (document.hidden) return
    renderLists()
    if (S.view === 'flow') renderSessionHead()
    if (S.view !== 'agentes') pollAgentes()
  }, 30_000)
  requestAnimationFrame(frame)
}

start()
