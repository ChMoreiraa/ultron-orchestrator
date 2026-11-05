import { draw } from './sprite.js'

const $ = id => document.getElementById(id)

const S = {
  meta: null,
  runs: [],
  sid: new URLSearchParams(location.search).get('session') ?? '',
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

async function loadRuns() {
  try {
    const r = await fetch('/api/runs')
    S.runs = (await r.json()).runs ?? []
  } catch {
    return
  }
  if (!S.sid && S.runs[0]) {
    S.sid = S.runs[0].sessionId
    history.replaceState(null, '', `?session=${encodeURIComponent(S.sid)}${location.hash}`)
    connect()
  }
  renderSessions()
  if (!S.sid) render()
}

let source
function connect() {
  source?.close()
  if (!S.sid) return
  source = new EventSource(`/api/runs/${encodeURIComponent(S.sid)}/stream`)
  source.addEventListener('run', e => {
    S.isLive = true
    apply(JSON.parse(e.data))
  })
  source.onopen = () => {
    S.isLive = true
    renderPills()
  }
  source.onerror = () => {
    S.isLive = false
    renderPills()
  }
}

function apply({ run, isAlive, agent, custo }) {
  S.run = run
  S.custo = custo ?? null
  S.isAlive = isAlive
  if (agent !== undefined) S.agent = agent
  render()
}

// ------------------------------------------------------------ render

function render() {
  renderPills()
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
  alive.textContent = S.isAlive ? 'sessão ativa' : 'sessão encerrada'
  alive.className = `pill ${S.isAlive ? 'pill-ok' : 'pill-warn'}`
  alive.title = S.isAlive ? 'O Claude Code está rodando esta sessão' : 'A sessão do Claude Code não está respondendo; mudanças ficam gravadas para quando ela voltar'
}

function renderSessions() {
  const sel = $('session')
  sel.replaceChildren(
    ...(S.runs.length ? [] : [el('option', { value: '' }, 'nenhuma sessão')]),
    ...S.runs.map(r =>
      el('option', { value: r.sessionId, selected: r.sessionId === S.sid }, `${r.isAlive ? '● ' : ''}${r.goal.slice(0, 48) || r.sessionId.slice(0, 8)} — ${STATUS_PT[r.status] ?? r.status}`),
    ),
  )
  if (S.sid && !S.runs.some(r => r.sessionId === S.sid)) sel.prepend(el('option', { value: S.sid, selected: true }, `sessão ${S.sid.slice(0, 8)}`))
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

/** Puts Ultron over the station in progress; the CSS transition makes him walk there. */
function placeWalker(at) {
  const target = $('stations').querySelector(`[data-i="${at}"] .node`)
  const journey = $('journey')
  if (!target || journey.offsetParent === null) return
  const center = target.getBoundingClientRect().left - journey.getBoundingClientRect().left + target.offsetWidth / 2
  const left = Math.round(center - 36)
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

function sayFor(run, p) {
  const running = run.steps.filter(s => s.status === 'running')
  switch (p) {
    case 'wait':
      return 'Aprova o fluxo?'
    case 'walk':
      return 'a caminho…'
    case 'work':
      return running.length > 1 ? `${running.length} agentes em ação` : `trabalhando: ${running[0]?.id}`
    case 'win':
      return 'Missão cumprida!'
    case 'fail':
      return run.status === 'cancelled' ? 'Cancelado.' : 'Algo falhou…'
    default:
      return run.status === 'paused' ? 'Pausado.' : run.status === 'approved' ? 'Pronto para partir!' : ''
  }
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

// ------------------------------------------------------------ torre: lista de agentes + perfil

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
  let h = 0
  for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0
  return h % 360
}

const estadoOf = a => (ESTADO_PT[a.estado] ? a.estado : 'ocioso')

/** Foto (só a servida pela própria torre) ou iniciais num círculo colorido. */
function avatarEl(a, size) {
  const cls = `av av-${size}`
  const fallback = () => el('span', { class: `${cls} av-initials`, style: `background:hsl(${hueOf(a.id)} 45% 36%)`, 'aria-hidden': 'true' }, initials(a.nome))
  if (typeof a.avatar !== 'string' || !AVATAR_RE.test(a.avatar)) return fallback()
  // A lista é refeita a cada mudança (o Higuruma avisa a cada 10 s) e o avatar sai com `no-store`: reaproveita o
  // mesmo <img> para a foto não piscar nem ser baixada de novo a cada quadro.
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

function ago(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'sem registro'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `atualizado há ${s}s`
  if (s < 3600) return `atualizado há ${Math.floor(s / 60)} min`
  return `atualizado há ${Math.floor(s / 3600)} h`
}

const isHttp = u => typeof u === 'string' && /^https?:\/\//i.test(u)

function agentRow(a) {
  const estado = estadoOf(a)
  const isUltron = a.tipo === 'ultron' && Boolean(a.sessao)
  const open = AG.sel !== null ? AG.sel === a.id : isUltron && a.sessao === S.sid
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
  if (AG.sel === null) return
  const a = AG.agentes?.find(x => x.id === AG.sel)
  if (!AG.agentes) return box.replaceChildren(el('p', { class: 'muted' }, 'Carregando…'))
  if (!a) {
    return box.replaceChildren(
      el('h2', {}, 'Agente'),
      el('p', { class: 'pf-missing', role: 'status' }, 'agente não encontrado'),
      el('p', { class: 'muted small' }, 'Ele não está mais na lista (o arquivo de presença sumiu ou a sessão fechou).'),
      el('button', { class: 'btn', type: 'button', onclick: () => goRoute(null) }, 'Voltar à jornada'),
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
      field('Atualizado', el('span', { id: 'pf-age' }, ago(a.atualizadoEm))),
    ),
    a.tipo === 'ultron' && a.sessao && el('button', { class: 'btn', type: 'button', onclick: () => goRoute(null, a.sessao) }, 'Abrir a jornada'),
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
  if (a && n) n.textContent = ago(a.atualizadoEm)
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

function connectAgentes() {
  AG.source?.close()
  stopPolling()
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

setInterval(renderAge, 1000)

// ---- rota: `#agente=<id>` abre o perfil; sem hash, a jornada

function routeId() {
  const m = location.hash.match(/^#agente=(.+)$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return null
  }
}

/** Mostra o que a URL pede; idempotente. */
function applyRoute() {
  AG.sel = routeId()
  const isProfile = AG.sel !== null
  $('perfil').hidden = !isProfile
  $('view-jornada').hidden = isProfile
  if (isProfile) renderPerfil()
  else {
    S.walker = { left: null, movingUntil: 0 }
    if (S.run) renderJourney(S.run)
  }
  renderAgentes()
}

/** Navega (com entrada no histórico): id abre o perfil, null abre a jornada, de `sid` se vier. */
function goRoute(id, sid) {
  if (sid && sid !== S.sid) {
    S.sid = sid
    S.run = null
    S.walker = { left: null, movingUntil: 0 }
    renderSessions()
    connect()
    render()
  }
  const url = `${location.pathname}${S.sid ? `?session=${encodeURIComponent(S.sid)}` : ''}${id === null ? '' : `#agente=${encodeURIComponent(id)}`}`
  if (url !== `${location.pathname}${location.search}${location.hash}`) history.pushState(null, '', url)
  applyRoute()
}

function openAgent(a) {
  if (a.tipo === 'ultron' && a.sessao) goRoute(null, a.sessao)
  else goRoute(a.id)
}

window.addEventListener('popstate', () => {
  const sid = new URLSearchParams(location.search).get('session')
  if (sid && sid !== S.sid) {
    S.sid = sid
    S.run = null
    renderSessions()
    connect()
    render()
  }
  applyRoute()
})
window.addEventListener('hashchange', applyRoute)

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

$('session').onchange = e => goRoute(null, e.target.value || S.sid)

window.addEventListener('resize', () => S.run && renderJourney(S.run))

document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (S.isTableDirty && S.run && !document.activeElement?.closest('#flow-body')) renderTable(S.run)
  }, 50)
})

// ------------------------------------------------------------ animation

function frame(now) {
  const run = S.run
  draw($('logo'), 'idle', now)
  if (!$('empty').hidden) draw($('empty-sprite'), 'wait', now)
  if (run && !$('content').hidden) {
    const p = pose(run, now)
    draw($('ultron'), p, now)
    const say = sayFor(run, p)
    if ($('walker-say').textContent !== say) $('walker-say').textContent = say
  }
  requestAnimationFrame(frame)
}

// ------------------------------------------------------------ start

async function start() {
  S.meta = await (await fetch('/api/meta')).json()
  $('add-role').replaceChildren(...Object.entries(S.meta.roles).map(([k, r]) => opt(k, r.label, 'builder')))
  await loadRuns()
  connect()
  render()
  applyRoute()
  connectAgentes()
  setInterval(loadRuns, 10_000)
  requestAnimationFrame(frame)
}

start()
