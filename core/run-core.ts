// The run's rules, shared by the mod, the CLI and the dashboard server.
// Pure functions over plain data: no fs, no Node, no engine. Node 24 runs this
// file as is (type stripping), so only erasable TypeScript goes here.
import type { Applied, Command, Effort, Model, PlanInput, PlanStepInput, Profile, Run, RunStatus, Step, StepPatch, StepStatus, Usage } from '../types'

export const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const PROFILES: readonly Profile[] = ['economia', 'equilibrado', 'qualidade']
export const STEP_STATUSES: readonly StepStatus[] = ['pending', 'running', 'done', 'failed', 'skipped']
export const PLAYBOOKS = ['direct', 'scout-then-build', 'plan-build-check', 'research', 'audit', 'rescue'] as const

/** A rough relative weight per tier, for the dashboard's cost bar: not prices. */
export const TIER_WEIGHT: Record<Model, number> = { haiku: 1, sonnet: 3, opus: 5 }

export type RoleDefault = { label: string; agentType: string; model: Model; effort: Effort; isStrong?: boolean }

/** Papel → agente, modelo e effort de partida (perfil equilibrado). */
export const ROLES: Record<string, RoleDefault> = {
  scout: { label: 'Scout (mapear/buscar)', agentType: 'Explore', model: 'haiku', effort: 'low' },
  researcher: { label: 'Pesquisa (docs/web)', agentType: 'general-purpose', model: 'sonnet', effort: 'medium' },
  planner: { label: 'Planejador/arquiteto', agentType: 'Plan', model: 'opus', effort: 'high', isStrong: true },
  'builder-simple': { label: 'Builder mecânico', agentType: 'general-purpose', model: 'haiku', effort: 'medium' },
  builder: { label: 'Builder padrão', agentType: 'general-purpose', model: 'sonnet', effort: 'medium' },
  'builder-complex': { label: 'Builder complexo', agentType: 'general-purpose', model: 'opus', effort: 'high', isStrong: true },
  checker: { label: 'Checker/revisor', agentType: 'general-purpose', model: 'sonnet', effort: 'high' },
  'checker-critical': { label: 'Revisor crítico', agentType: 'general-purpose', model: 'opus', effort: 'high', isStrong: true },
  fixer: { label: 'Fixer', agentType: 'general-purpose', model: 'sonnet', effort: 'medium' },
  writer: { label: 'Writer/docs', agentType: 'general-purpose', model: 'haiku', effort: 'low' },
}

/** The tag an Agent call's description starts with to belong to a step. */
export const TAG = /^ultron:([a-z0-9][a-z0-9-]{0,31})(?=\s|$)/

/** A plan's `agent`: the repo whose reviewer agent the steps carry. Owner as GitHub allows it (no `_`, so `owner__repo` splits one way only); the repo is never `.` or `..`. */
export const AGENT_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.{1,2}$)[A-Za-z0-9_.-]+$/

/** `owner/repo` → `owner__repo`, the agent file's name under ~/.claude/ultron/agents/. */
export const agentSlug = (repo: string) => repo.replace('/', '__')

/** The name a repo's agent gets until its file says otherwise. */
export const agentName = (repo: string) => `revisor-${repo.split('/')[1] ?? repo}`

/** What goes before a step's prompt: the agent file as it is now, or a note that there is none yet. */
export function agentBlock(repo: string, file: string, content: string | null): string {
  if (content === null) {
    return `<agente-do-repo repo="${repo}" arquivo="${file}" estado="novo">Este repo ainda não tem agente. Se esta etapa é a de contexto, crie o arquivo a partir do template antes de terminar.</agente-do-repo>\n\n`
  }
  // A closing tag inside the file would end the block early.
  const body = content.replace(/\s+$/, '').replace(/<\/(agente-do-repo)/gi, '<\\/$1')
  return `<agente-do-repo repo="${repo}" arquivo="${file}">\n${body}\n</agente-do-repo>\n\n`
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/
const MAX_STEPS = 40
const MAX_EVENTS = 200
const MAX_ACKS = 100

export const isTerminal = (s: RunStatus) => s === 'done' || s === 'failed' || s === 'cancelled'

const shift = <T>(list: readonly T[], value: T, delta: number, max = list.length - 1): T =>
  list[Math.max(0, Math.min(max, list.indexOf(value) + delta))] as T

/** A role's model and effort under a profile: economia steps down, qualidade up. */
export function defaultsFor(role: string, profile: Profile): RoleDefault {
  const base = ROLES[role] ?? ROLES.builder!
  if (profile === 'economia') {
    return { ...base, effort: shift(EFFORTS, base.effort, -1), model: base.model === 'opus' && role !== 'planner' ? 'sonnet' : base.model }
  }
  if (profile === 'qualidade') {
    return { ...base, effort: shift(EFFORTS, base.effort, 1, EFFORTS.indexOf('xhigh')), model: base.model === 'haiku' && role !== 'scout' ? 'sonnet' : base.model }
  }
  return base
}

/** One step up the ladder for a retry: a low effort first, then the tier, then effort up to xhigh. */
export function escalate(step: Pick<Step, 'model' | 'effort'>): Pick<Step, 'model' | 'effort'> {
  if (step.effort === 'low') return { model: step.model, effort: 'medium' }
  if (step.model !== 'opus') return { model: shift(MODELS, step.model, 1), effort: step.effort }
  return { model: 'opus', effort: shift(EFFORTS, step.effort, 1, EFFORTS.indexOf('xhigh')) }
}

export function newRun(sessionId: string, now: number): Run {
  return {
    version: 1,
    sessionId,
    goal: '',
    playbook: '',
    profile: 'equilibrado',
    rationale: '',
    complexity: 0,
    status: 'awaiting_approval',
    revision: 0,
    approval: null,
    steps: [],
    events: [],
    consumed: 0,
    acks: {},
    createdAt: now,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------- validation

function stepFrom(input: PlanStepInput, profile: Profile, errors: string[], at: string): Step {
  const id = String(input.id ?? '').trim()
  if (!ID.test(id)) errors.push(`${at}: id "${id}" inválido (use a-z, 0-9 e hífen, até 32)`)
  const title = String(input.title ?? '').trim()
  if (!title) errors.push(`${at}: falta title`)
  const role = String(input.role ?? 'builder').trim() || 'builder'
  const base = defaultsFor(role, profile)
  const model = input.model ?? base.model
  if (!MODELS.includes(model)) errors.push(`${at}: model "${model}" inválido (${MODELS.join('|')})`)
  const effort = input.effort ?? base.effort
  if (!EFFORTS.includes(effort)) errors.push(`${at}: effort "${effort}" inválido (${EFFORTS.join('|')})`)
  const mode = input.mode ?? 'agent'
  if (mode !== 'agent' && mode !== 'inline') errors.push(`${at}: mode "${mode}" inválido (agent|inline)`)
  const wave = input.wave ?? 1
  if (!Number.isInteger(wave) || wave < 1) errors.push(`${at}: wave deve ser inteiro ≥ 1`)
  const dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.map(String) : []
  return {
    id,
    title: title.slice(0, 120),
    role,
    mode,
    agentType: AGENT_TYPE.test(String(input.agentType ?? '')) ? String(input.agentType) : base.agentType,
    model,
    effort,
    wave,
    dependsOn,
    status: 'pending',
    isPinned: input.model !== undefined && input.model !== base.model ? true : undefined,
  }
}

function checkGraph(steps: Step[], errors: string[]) {
  const ids = new Set<string>()
  for (const s of steps) {
    if (ids.has(s.id)) errors.push(`id repetido: ${s.id}`)
    ids.add(s.id)
  }
  const byId = new Map(steps.map(s => [s.id, s]))
  for (const s of steps) {
    for (const d of s.dependsOn) {
      const dep = byId.get(d)
      if (!dep) errors.push(`${s.id}: depende de "${d}", que não existe`)
      else if (dep.wave >= s.wave) errors.push(`${s.id}: depende de "${d}", que precisa estar numa onda anterior`)
    }
  }
}

export function validatePlan(input: PlanInput): { steps: Step[]; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return { steps: [], errors: ['plano vazio'] }
  if (!String(input.goal ?? '').trim()) errors.push('falta goal')
  if (!String(input.playbook ?? '').trim()) errors.push('falta playbook')
  const profile = input.profile ?? 'equilibrado'
  if (!PROFILES.includes(profile)) errors.push(`profile "${profile}" inválido (${PROFILES.join('|')})`)
  if (input.agent != null && (typeof input.agent !== 'string' || !AGENT_REPO.test(input.agent.trim()))) {
    errors.push(`agent "${String(input.agent)}" inválido (use owner/repo, ex.: acme/meu-app)`)
  }
  const list = Array.isArray(input.steps) ? input.steps : []
  if (list.length === 0) errors.push('o plano precisa de ao menos uma etapa')
  if (list.length > MAX_STEPS) errors.push(`no máximo ${MAX_STEPS} etapas`)
  const steps = list.slice(0, MAX_STEPS).map((s, i) => stepFrom(s, profile, errors, `etapa ${i + 1}`))
  checkGraph(steps, errors)
  return { steps, errors }
}

// ---------------------------------------------------------------- queries

export const sortSteps = (steps: Step[]) => [...steps].sort((a, b) => a.wave - b.wave)

export function progress(run: Run) {
  const total = run.steps.filter(s => s.status !== 'skipped').length
  const done = run.steps.filter(s => s.status === 'done').length
  return { done, total }
}

/** The step the sprite stands on: the first running one, else the next to do, else the last. */
export function currentIndex(run: Run): number {
  const steps = run.steps
  const running = steps.findIndex(s => s.status === 'running')
  if (running >= 0) return running
  const failed = steps.findIndex(s => s.status === 'failed')
  if (failed >= 0) return failed
  const pending = steps.findIndex(s => s.status === 'pending')
  if (pending >= 0) return pending
  return steps.length
}

export const isApproved = (run: Run) => run.approval !== null && run.approval.revision === run.revision

/** Whether an Agent call tagged for `stepId` may start now, and the step it runs. */
export function gate(run: Run | null, stepId: string): { ok: true; step: Step } | { ok: false; reason: string } {
  if (!run || run.revision === 0) return { ok: false, reason: 'não há plano nesta sessão; rode o setup do /ultron primeiro' }
  const step = run.steps.find(s => s.id === stepId)
  if (!step) return { ok: false, reason: `a etapa "${stepId}" não está no plano (rev ${run.revision}); rode \`status\` e use um id do plano` }
  if (isTerminal(run.status)) return { ok: false, reason: `a run está ${run.status}` }
  if (run.status === 'paused') return { ok: false, reason: 'pausado pelo usuário; espere ele retomar' }
  if (!isApproved(run)) return { ok: false, reason: `o plano (rev ${run.revision}) ainda não foi aprovado; peça a aprovação no chat ou no dashboard` }
  if (step.mode === 'inline') return { ok: false, reason: `a etapa "${stepId}" é inline: o Ultron a faz sem subagente` }
  if (step.status === 'running' || step.status === 'done') return { ok: false, reason: `a etapa "${stepId}" já está ${step.status}` }
  const blocked = step.dependsOn.filter(d => run.steps.find(s => s.id === d)?.status !== 'done')
  if (blocked.length) return { ok: false, reason: `a etapa "${stepId}" espera ${blocked.join(', ')} terminar` }
  return { ok: true, step }
}

// ---------------------------------------------------------------- changes

const fail = (error: string): Applied => ({ ok: false, error })

/** A plan change: a new revision, which needs approval again. */
function revise(run: Run, by: string, text: string) {
  run.revision += 1
  if (!isTerminal(run.status)) run.status = 'awaiting_approval'
  log(run, by, `${text} → rev ${run.revision}, aguardando aprovação`)
}

function log(run: Run, by: string, text: string, now = run.updatedAt) {
  run.events.push({ at: now, by, text })
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
}

function editable(run: Run, stepId: string): Step | string {
  if (isTerminal(run.status)) return `a run está ${run.status}`
  const step = run.steps.find(s => s.id === stepId)
  if (!step) return `etapa "${stepId}" não existe`
  if (step.status !== 'pending' && step.status !== 'failed') return `a etapa "${stepId}" está ${step.status} e não pode mais mudar`
  return step
}

/** What a person may change on a step; status, agent ids and usage stay the session's. */
const PATCH_KEYS = ['title', 'role', 'mode', 'agentType', 'model', 'effort', 'wave', 'dependsOn'] as const
/** An agent type is a plain name (`Explore`, `general-purpose`, `plugin:agent`). */
const AGENT_TYPE = /^[A-Za-z0-9][\w:.-]{0,63}$/

function applyPatch(run: Run, step: Step, raw: StepPatch): string | null {
  const patch: StepPatch = {}
  for (const k of PATCH_KEYS) if (raw?.[k] !== undefined) Object.assign(patch, { [k]: raw[k] })
  if (patch.role !== undefined && (typeof patch.role !== 'string' || !patch.role.trim())) return 'role inválido'
  if (patch.agentType !== undefined && (typeof patch.agentType !== 'string' || !AGENT_TYPE.test(patch.agentType))) return `agentType inválido: ${String(patch.agentType)}`
  if (patch.dependsOn !== undefined && (!Array.isArray(patch.dependsOn) || patch.dependsOn.some(d => typeof d !== 'string'))) return 'dependsOn deve ser uma lista de ids'
  if (patch.model !== undefined && !MODELS.includes(patch.model)) return `model inválido: ${patch.model}`
  if (patch.effort !== undefined && !EFFORTS.includes(patch.effort)) return `effort inválido: ${patch.effort}`
  if (patch.mode !== undefined && patch.mode !== 'agent' && patch.mode !== 'inline') return `mode inválido: ${patch.mode}`
  if (patch.wave !== undefined && (!Number.isInteger(patch.wave) || patch.wave < 1)) return 'wave deve ser inteiro ≥ 1'
  if (patch.title !== undefined && !String(patch.title).trim()) return 'title vazio'
  const next: Step = { ...step, ...patch, title: patch.title !== undefined ? String(patch.title).trim().slice(0, 120) : step.title }
  if (patch.role !== undefined && patch.role !== step.role && patch.model === undefined && patch.effort === undefined && !step.isPinned) {
    const d = defaultsFor(patch.role, run.profile)
    Object.assign(next, { model: d.model, effort: d.effort, agentType: patch.agentType ?? d.agentType })
  }
  if (patch.model !== undefined || patch.effort !== undefined) next.isPinned = true
  const errors: string[] = []
  checkGraph(run.steps.map(s => (s.id === step.id ? next : s)), errors)
  if (errors.length) return errors.join('; ')
  Object.assign(step, next)
  return null
}

const describe = (p: StepPatch) =>
  Object.entries(p ?? {})
    .filter(([k]) => (PATCH_KEYS as readonly string[]).includes(k))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
    .join(' ')

/**
 * Applies one command to the run, in place. Returns whether it held and, for
 * a person's decision made outside the chat, the line the session is told.
 */
export function apply(run: Run, cmd: Command, now: number): Applied {
  const by = cmd.by ?? 'ultron'
  run.updatedAt = now
  const outside = by === 'dashboard'
  switch (cmd.type) {
    case 'plan': {
      const { steps, errors } = validatePlan(cmd.plan)
      if (errors.length) return fail(errors.join('; '))
      // A replan keeps what already ran under the same id; a plan over a finished run starts a new journey.
      const isNewJourney = isTerminal(run.status)
      const old = new Map(isNewJourney ? [] : run.steps.map(s => [s.id, s]))
      run.steps = steps.map(s => {
        const was = old.get(s.id)
        return was && (was.status === 'done' || was.status === 'running') ? { ...s, ...pick(was) } : s
      })
      if (isNewJourney) {
        run.approval = null
        run.summary = undefined
        if (run.revision > 0) log(run, by, `nova jornada (a anterior terminou ${STATUS_PT[run.status]})`)
      }
      run.agent = cmd.plan.agent?.trim() || undefined
      run.goal = cmd.plan.goal.trim()
      run.playbook = cmd.plan.playbook.trim()
      run.profile = cmd.plan.profile ?? run.profile
      run.rationale = String(cmd.plan.rationale ?? '').trim()
      run.complexity = Math.max(0, Math.min(10, Number(cmd.plan.complexity ?? 0) || 0))
      run.feedback = undefined
      if (isTerminal(run.status)) run.status = 'awaiting_approval'
      revise(run, by, `plano ${run.revision === 0 ? 'criado' : 'refeito'} (${run.playbook}, ${steps.length} etapas)`)
      return { ok: true }
    }
    case 'approve': {
      if (isTerminal(run.status)) return fail(`a run está ${run.status}`)
      if (run.revision === 0) return fail('não há plano para aprovar')
      if (cmd.revision !== undefined && cmd.revision !== run.revision) return fail(`o plano mudou (rev ${run.revision}); revise antes de aprovar`)
      run.approval = { by, at: now, revision: run.revision }
      run.feedback = undefined
      run.status = run.steps.some(s => s.status !== 'pending') ? 'running' : 'approved'
      log(run, by, `aprovou a rev ${run.revision}`)
      return { ok: true, notify: outside ? `[ultron] O usuário APROVOU o plano no dashboard (rev ${run.revision}). Rode \`status\` para ver o fluxo atual e siga com a execução.` : undefined }
    }
    case 'reject': {
      if (isTerminal(run.status)) return fail(`a run está ${run.status}`)
      run.approval = null
      run.status = 'awaiting_approval'
      run.feedback = String(cmd.reason ?? '').trim() || 'mudanças pedidas'
      log(run, by, `pediu mudanças: ${run.feedback}`)
      return { ok: true, notify: outside ? `[ultron] O usuário pediu mudanças no plano pelo dashboard: "${run.feedback}". Refaça o plano (\`plan\`) e peça aprovação de novo.` : undefined }
    }
    case 'pause': {
      if (isTerminal(run.status) || run.status === 'paused') return fail(`a run está ${run.status}`)
      run.status = 'paused'
      log(run, by, 'pausou')
      return { ok: true, notify: outside ? '[ultron] O usuário PAUSOU a run no dashboard. Não lance novas etapas até ele retomar; deixe as que já rodam terminarem.' : undefined }
    }
    case 'resume': {
      if (run.status !== 'paused') return fail('a run não está pausada')
      run.status = isApproved(run) ? (run.steps.some(s => s.status !== 'pending') ? 'running' : 'approved') : 'awaiting_approval'
      log(run, by, 'retomou')
      return { ok: true, notify: outside ? `[ultron] O usuário RETOMOU a run no dashboard. Rode \`status\` e siga${isApproved(run) ? '' : ' (o plano ainda precisa de aprovação)'}.` : undefined }
    }
    case 'cancel': {
      if (isTerminal(run.status)) return fail(`a run já está ${run.status}`)
      run.status = 'cancelled'
      log(run, by, 'cancelou a run')
      return { ok: true, notify: outside ? '[ultron] O usuário CANCELOU a run no dashboard. Pare: não lance mais etapas e resuma o que já foi feito.' : undefined }
    }
    case 'set-profile': {
      if (!PROFILES.includes(cmd.profile)) return fail(`perfil inválido: ${cmd.profile}`)
      if (isTerminal(run.status)) return fail(`a run está ${run.status}`)
      if (cmd.profile === run.profile) return { ok: true }
      run.profile = cmd.profile
      for (const s of run.steps) {
        if (s.status !== 'pending' || s.isPinned) continue
        const d = defaultsFor(s.role, cmd.profile)
        s.model = d.model
        s.effort = d.effort
      }
      revise(run, by, `perfil → ${cmd.profile}`)
      return { ok: true }
    }
    case 'edit-step': {
      const step = editable(run, cmd.stepId)
      if (typeof step === 'string') return fail(step)
      const error = applyPatch(run, step, cmd.patch ?? {})
      if (error) return fail(error)
      revise(run, by, `${step.id}: ${describe(cmd.patch)}`)
      return { ok: true }
    }
    case 'add-step': {
      if (isTerminal(run.status)) return fail(`a run está ${run.status}`)
      const errors: string[] = []
      const step = stepFrom(cmd.step, run.profile, errors, 'nova etapa')
      if (errors.length) return fail(errors.join('; '))
      const at = cmd.after ? run.steps.findIndex(s => s.id === cmd.after) + 1 : run.steps.length
      const steps = [...run.steps]
      steps.splice(at <= 0 ? steps.length : at, 0, step)
      checkGraph(steps, errors)
      if (errors.length) return fail(errors.join('; '))
      run.steps = steps
      revise(run, by, `adicionou ${step.id} (${step.model}/${step.effort})`)
      return { ok: true }
    }
    case 'remove-step': {
      const step = editable(run, cmd.stepId)
      if (typeof step === 'string') return fail(step)
      const users = run.steps.filter(s => s.dependsOn.includes(step.id)).map(s => s.id)
      if (users.length) return fail(`${users.join(', ')} depende(m) de ${step.id}`)
      run.steps = run.steps.filter(s => s.id !== step.id)
      revise(run, by, `removeu ${step.id}`)
      return { ok: true }
    }
    case 'move-step': {
      const step = editable(run, cmd.stepId)
      if (typeof step === 'string') return fail(step)
      const from = run.steps.indexOf(step)
      const to = Math.max(0, Math.min(run.steps.length - 1, from + Math.sign(cmd.delta)))
      if (to === from) return { ok: true }
      run.steps.splice(from, 1)
      run.steps.splice(to, 0, step)
      revise(run, by, `moveu ${step.id}`)
      return { ok: true }
    }
    case 'step': {
      const step = run.steps.find(s => s.id === cmd.stepId)
      if (!step) return fail(`etapa "${cmd.stepId}" não existe`)
      if (!STEP_STATUSES.includes(cmd.status)) return fail(`status inválido: ${cmd.status}`)
      if (cmd.status === 'running' && !isApproved(run)) return fail('o plano ainda não foi aprovado')
      if (cmd.status === 'running' && run.status === 'paused') return fail('a run está pausada')
      setStatus(run, step, cmd.status, now)
      if (cmd.note) step.note = String(cmd.note).slice(0, 300)
      log(run, by, `${step.id} → ${cmd.status}${cmd.note ? `: ${String(cmd.note).slice(0, 120)}` : ''}`)
      return { ok: true }
    }
    case 'agent-start': {
      const step = run.steps.find(s => s.id === cmd.stepId)
      if (!step) return fail(`etapa "${cmd.stepId}" não existe`)
      step.toolUseId = cmd.toolUseId
      step.agentId = undefined
      step.usage = undefined
      setStatus(run, step, 'running', now)
      log(run, by, `${step.id} → agente ${step.agentType} em ${step.model}/${step.effort}`)
      return { ok: true }
    }
    case 'repo-agent': {
      const step = run.steps.find(s => s.id === cmd.stepId)
      if (!step) return fail(`etapa "${cmd.stepId}" não existe`)
      log(run, by, `${step.id} → agente do repo ${cmd.repo}${cmd.isNew ? ' (ainda sem arquivo)' : ''}`)
      return { ok: true }
    }
    case 'agent-bind': {
      const step = run.steps.find(s => s.toolUseId === cmd.toolUseId)
      if (!step) return { ok: true }
      step.agentId = cmd.agentId
      return { ok: true }
    }
    case 'agent-end': {
      const step = run.steps.find(s => s.agentId === cmd.agentId)
      if (!step) return { ok: true }
      step.usage = cmd.usage
      if (step.status === 'running') setStatus(run, step, cmd.isOk ? 'done' : 'failed', now)
      log(run, by, `${step.id} terminou${cmd.isOk ? '' : ' com erro'}`)
      return { ok: true }
    }
    case 'finish': {
      if (isTerminal(run.status)) return fail(`a run já está ${run.status}`)
      run.status = cmd.status === 'failed' ? 'failed' : 'done'
      run.summary = String(cmd.summary ?? '').trim().slice(0, 2000) || undefined
      for (const s of run.steps) if (s.status === 'pending') s.status = 'skipped'
      log(run, by, run.status === 'done' ? 'jornada concluída 🏁' : 'jornada encerrada com falha')
      return { ok: true }
    }
    default:
      return fail(`comando desconhecido: ${(cmd as { type?: string }).type}`)
  }
}

function pick(s: Step): Partial<Step> {
  return { status: s.status, agentId: s.agentId, toolUseId: s.toolUseId, startedAt: s.startedAt, endedAt: s.endedAt, usage: s.usage, note: s.note }
}

function setStatus(run: Run, step: Step, status: StepStatus, now: number) {
  step.status = status
  if (status === 'running') {
    step.startedAt = now
    step.endedAt = undefined
    if (run.status === 'approved') run.status = 'running'
  } else if (status !== 'pending') step.endedAt = now
}

/** Applies inbox lines past `run.consumed`; a bad line is acked as an error, never retried. */
export function applyInbox(run: Run, lines: string[], now: number): string[] {
  const notes: string[] = []
  for (let i = run.consumed; i < lines.length; i++) {
    const line = lines[i]!.trim()
    run.consumed = i + 1
    if (!line) continue
    let cmd: Command
    try {
      cmd = JSON.parse(line) as Command
    } catch {
      continue
    }
    let result: Applied
    try {
      result = apply(run, cmd, now)
    } catch (err) {
      result = fail(String(err instanceof Error ? err.message : err))
    }
    if (cmd.id) ack(run, cmd.id, result, now)
    if (result.notify) notes.push(result.notify)
  }
  return notes
}

export function ack(run: Run, id: string, result: Applied, now: number) {
  run.acks[id] = { ok: result.ok, error: result.error, at: now }
  const keys = Object.keys(run.acks)
  if (keys.length > MAX_ACKS) for (const k of keys.slice(0, keys.length - MAX_ACKS)) delete run.acks[k]
}

/** Splits a file's text into lines, dropping a trailing partial line still being written. */
export function inboxLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length && !text.endsWith('\n')) lines.pop()
  else if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// ---------------------------------------------------------------- cost

/** US$ per million tokens, as the user's config holds them (`precos.modelos[model]`). */
export type Price = { entrada: number; saida: number; leituraCache: number; escritaCache: number }
export type StepCost = { id: string; model: Model; tokens: number; cost: number | null }
export type RunCost = {
  /** Sum of the steps that have a price; 0 when none. */
  total: number
  steps: StepCost[]
  /** Steps with usage but no usable price (counted in tokens, left out of the total). */
  unpriced: number
  /** Inline steps: they run in the session's model and carry no usage. */
  inline: number
  /** Money saved against running every priced step on the strong tier; null when that tier has no price. */
  saving: number | null
  strong: Model
  /** Tokens of every step with usage (priced or not). */
  tokens: number
}

const PRICE_KEYS = ['entrada', 'saida', 'leituraCache', 'escritaCache'] as const
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

/** The usable price of a model, or null when the config lacks it or any field is not a number. */
export function priceOf(precos: unknown, model: string): Price | null {
  const p = (precos as { modelos?: Record<string, Record<string, unknown>> } | null | undefined)?.modelos?.[model]
  if (!p || typeof p !== 'object') return null
  return PRICE_KEYS.every(k => isNum(p[k])) ? (p as unknown as Price) : null
}

/** A usage field as a count: the session may omit one (the API leaves cache counters out), and NaN would poison every total. */
const count = (n: unknown): number => (isNum(n) ? n : 0)

export function usageTokens(u: Usage): number {
  return count(u.input) + count(u.output) + count(u.cacheRead) + count(u.cacheWrite)
}

/** US$ of one usage at one price. */
export function usageCost(u: Usage, p: Price): number {
  return (count(u.input) * p.entrada + count(u.output) * p.saida + count(u.cacheRead) * p.leituraCache + count(u.cacheWrite) * p.escritaCache) / 1e6
}

/** Real cost of the run and the saving against running it all on `strong`. Pure: prices come from the caller. */
export function runCost(run: Pick<Run, 'steps'>, precos: unknown, strong: Model = 'opus'): RunCost {
  const strongPrice = priceOf(precos, strong)
  const out: RunCost = { total: 0, steps: [], unpriced: 0, inline: 0, saving: strongPrice ? 0 : null, strong, tokens: 0 }
  for (const s of run.steps) {
    if (s.status === 'skipped') continue
    if (s.mode === 'inline') {
      out.inline++
      continue
    }
    if (!s.usage || typeof s.usage !== 'object') continue
    const p = priceOf(precos, s.model)
    const cost = p ? usageCost(s.usage, p) : null
    out.tokens += usageTokens(s.usage)
    out.steps.push({ id: s.id, model: s.model, tokens: usageTokens(s.usage), cost })
    if (cost === null) {
      out.unpriced++
      continue
    }
    out.total += cost
    if (strongPrice && out.saving !== null) out.saving += usageCost(s.usage, strongPrice) - cost
  }
  return out
}

// ---------------------------------------------------------------- text

const STATUS_PT: Record<RunStatus, string> = {
  awaiting_approval: 'aguardando aprovação',
  approved: 'aprovado',
  running: 'executando',
  paused: 'pausado',
  done: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
}

export const statusText = (s: RunStatus) => STATUS_PT[s]

const tokens = (u?: { input: number; output: number; cacheRead: number; cacheWrite: number }) =>
  u ? `${Math.round((u.input + u.output + u.cacheRead + u.cacheWrite) / 1000)}k tok` : ''

/** The run as the CLI prints it for the model; `agent` is what the repo's agent file says, if it exists. */
export function summarize(run: Run, agent?: { name?: string } | null): string {
  if (run.revision === 0) return 'Nenhum plano ainda nesta sessão.'
  const { done, total } = progress(run)
  const head = [
    `Objetivo: ${run.goal}`,
    `Playbook: ${run.playbook} · perfil ${run.profile} · complexidade ${run.complexity}/10`,
    `Status: ${STATUS_PT[run.status]} · rev ${run.revision} · ${isApproved(run) ? `aprovada por ${run.approval!.by}` : 'NÃO aprovada'} · ${done}/${total} etapas`,
  ]
  if (run.agent) head.push(`Agente: ${agent?.name || agentName(run.agent)} (${run.agent}${agent ? '' : ', ainda sem arquivo'})`)
  if (run.feedback) head.push(`Mudanças pedidas: ${run.feedback}`)
  const rows = sortSteps(run.steps).map(
    s =>
      `  [${s.status}] onda ${s.wave} · ${s.id} · ${s.title} · ${s.role} · ${s.mode === 'inline' ? 'inline (Ultron)' : `${s.agentType} ${s.model}/${s.effort}`}${s.dependsOn.length ? ` · após ${s.dependsOn.join(',')}` : ''}${s.usage ? ` · ${tokens(s.usage)}` : ''}${s.note ? ` · ${s.note}` : ''}`,
  )
  const last = run.events.slice(-5).map(e => `  · ${e.by}: ${e.text}`)
  return [...head, 'Etapas:', ...rows, 'Últimos eventos:', ...last].join('\n')
}
