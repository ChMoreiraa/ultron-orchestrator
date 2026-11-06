import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { AGENT_REPO, TAG, agentBlock, agentSlug, applyInbox, apply, currentIndex, gate, inboxLines, isApproved, isTerminal, newRun, progress, statusText } from '../core/run-core'
import type { Command, Identity, Model, Run, Step } from '../types'
import { lineFor, momentOf } from '../core/quotes'
import { cells, spark } from './sprite'
import type { Pose } from './sprite'

const PANE = 'ultron'
const TITLE = '🤖 Ultron'
const DEFAULT_PORT = 4477

// Every session registers itself for the dashboard (presence, below), but the
// flow stays out of the way until /ultron runs in this session: every flow hook
// checks `isActive` first and passes straight through without it.
const activeAtom = atom({ plugin: 'ultron', key: 'isActive' } as const, false)
const runAtom = atom({ plugin: 'ultron', key: 'run' } as const, null, { shape: 'run-1' })
const frameAtom = atom({ plugin: 'ultron', key: 'frame' } as const, 0)
const posAtom = atom({ plugin: 'ultron', key: 'pos' } as const, 0)
const sessionAtom = atom({ plugin: 'ultron', key: 'sessionId' } as const, '')
/** The last task from the dashboard this session ran, so a reload never runs it twice. */
const lastTaskAtom = atom({ plugin: 'ultron', key: 'lastTaskId' } as const, '')
/** This session's repo and the Marvel AI the dashboard named it after; null outside a repo. */
const identityAtom = atom({ plugin: 'ultron', key: 'identity' } as const, null, { shape: 'identity-1' })
const NO_REPO_COLOR = '#8a93a6'

const TIER_COLOR: Record<Model, string> = { haiku: '#5fd0c5', sonnet: '#8f9bff', opus: '#d58cff' }
const RED = '#e1263b'
const STEP_MARK: Record<Step['status'], string> = { pending: '○', running: '◉', done: '●', failed: '✖', skipped: '⊘' }

type Paths = { home: string; dir: string; run: string; inbox: string; heartbeat: string; config: string }

// Per load; a reload rebuilds them from disk.
let paths: Paths | null = null
let port = DEFAULT_PORT
let timers: { cancel: () => void }[] = []
let queue: Promise<unknown> = Promise.resolve()
let inboxStamp = ''

const slash = (p: string) => p.replace(/\\/g, '/')

async function pathsFor($: EngineInterface, sessionId: string): Promise<Paths> {
  const home = slash((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.')
  const root = `${home}/.claude/ultron`
  const dir = `${root}/runs/${sessionId}`
  return { home: root, dir, run: `${dir}/run.json`, inbox: `${dir}/inbox.jsonl`, heartbeat: `${dir}/mod.json`, config: `${root}/config.json` }
}

async function readJson<T>($: EngineInterface, path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await $.fs.read(path)) as T
  } catch {
    return fallback
  }
}

const isActive = ($: EngineInterface) => read($, activeAtom)

/** Reads the run, changes it, writes it back; one change at a time. */
function mutate($: EngineInterface, fn: (run: Run, now: number) => string[] | void): Promise<Run | null> {
  const job = queue.then(async () => {
    if (!paths) return null
    const now = await $.clock.now()
    const run = await readJson<Run | null>($, paths.run, null) ?? newRun(await read($, sessionAtom), now)
    const notes = fn(run, now) ?? []
    await $.fs.write(paths.run, JSON.stringify(run, null, 1))
    await update($, runAtom, () => run)
    for (const text of notes) void $.prompt.submit({ text })
    return run
  })
  queue = job.catch(() => null)
  return job
}

const raise = ($: EngineInterface, cmd: Command) =>
  mutate($, (run, now) => {
    apply(run, { ...cmd, by: cmd.by ?? 'ultron' }, now)
  })

/** The step's prompt behind the repo's agent file, read now so the newest version goes; a fault leaves the prompt as it was. */
async function withRepoAgent($: EngineInterface, repo: string, stepId: string, prompt: string): Promise<string> {
  // run.json is only trusted so far: the repo becomes a file name, so it is checked here too.
  if (!paths || !AGENT_REPO.test(repo)) return prompt
  const file = `${paths.home}/agents/${agentSlug(repo)}.md`
  let content: string | null
  try {
    content = (await $.fs.exists(file)) ? await $.fs.read(file) : null
  } catch (err) {
    $.ui.log(`ultron: agente do repo ${repo}: ${String(err)}`, { to: 'debug' })
    return prompt
  }
  await raise($, { type: 'repo-agent', stepId, repo, isNew: content === null }).catch(() => null)
  return agentBlock(repo, file, content) + prompt
}

/** Applies what the CLI or the dashboard left in the inbox. */
async function drainInbox($: EngineInterface) {
  if (!paths) return
  const stat = (await $.fs.exists(paths.inbox)) ? await $.fs.stat(paths.inbox).catch(() => null) : null
  const stamp = stat ? `${stat.size}:${stat.mtimeMs}` : ''
  if (stamp === inboxStamp) return
  const text = stat ? await $.fs.read(paths.inbox).catch(() => '') : ''
  const lines = inboxLines(text)
  await mutate($, (run, now) => (lines.length > run.consumed ? applyInbox(run, lines, now) : []))
  inboxStamp = stamp
}

async function heartbeat($: EngineInterface) {
  if (!paths) return
  await $.fs.write(paths.heartbeat, JSON.stringify({ at: await $.clock.now() }))
}

/** Walks the sprite toward the step in progress; ticks the animation. */
async function animate($: EngineInterface) {
  await update($, frameAtom, f => (f + 1) % 1_000_000)
  const run = await read($, runAtom)
  const target = run ? targetColumn(run, 40) : 0
  await update($, posAtom, p => (p === target ? p : p + Math.sign(target - p) * Math.min(2, Math.abs(target - p))))
}

function startTimers($: EngineInterface) {
  stopTimers()
  timers = [
    $.clock.every(1000, () => void drainInbox($).catch(err => $.ui.log(`ultron: inbox: ${String(err)}`, { to: 'debug' }))),
    $.clock.every(2000, () => void heartbeat($).catch(() => {})),
    $.clock.every(500, () => void animate($).catch(() => {})),
  ]
}

function stopTimers() {
  for (const t of timers) t.cancel()
  timers = []
}

function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE, columns: 44 })
}

/** Turns the mod on for this session: state, pane, timers. */
async function activate($: EngineInterface) {
  const sessionId = await $.session.id()
  paths = await pathsFor($, sessionId)
  const cfg = await readJson<{ port?: number }>($, paths.config, {})
  port = Number(cfg.port) || DEFAULT_PORT
  await update($, sessionAtom, () => sessionId)
  await update($, activeAtom, () => true)
  // What the skill's CLI calls read: which session, and where the CLI is.
  await $.env.set('ULTRON_SESSION', sessionId)
  await $.env.set('ULTRON_CLI', `${slash($.plugin.root)}/bin/ultron.mjs`)
  const run = await readJson<Run | null>($, paths.run, null)
  if (run) await update($, runAtom, () => run)
  await heartbeat($)
  startTimers($)
  void openPane($)
  // The pane links to the dashboard: have it answer, also in a resumed session where the skill does not run.
  void $.process
    .run(['node', `${slash($.plugin.root)}/bin/ultron.mjs`, 'dashboard', '--no-open', '--session', sessionId], { timeoutMs: 15_000 })
    .catch(err => $.ui.log(`ultron: dashboard não subiu: ${String(err)}`, { to: 'debug' }))
}

const dashboardUrl = (sessionId: string) => `http://127.0.0.1:${port}/?session=${encodeURIComponent(sessionId)}`

const SPRITE_W = 12

/** Where the sprite should stand on a trail `width` columns wide. */
function targetColumn(run: Run, width: number): number {
  const waves = [...new Set(run.steps.map(s => s.wave))].sort((a, b) => a - b)
  const at = currentWave(run, waves)
  const x = stationX(at, waves.length, width)
  return Math.max(0, Math.min(width - SPRITE_W, x - SPRITE_W / 2))
}

function currentWave(run: Run, waves: number[]): number {
  if (run.status === 'done' || run.steps.length === 0) return waves.length
  const i = currentIndex(run)
  const step = run.steps[i]
  return step ? waves.indexOf(step.wave) : waves.length
}

const stationX = (i: number, count: number, width: number) => (count === 0 ? 0 : Math.round((i * (width - 2)) / count))

function poseOf(run: Run | null, isMoving: boolean): Pose {
  if (!run || run.revision === 0) return 'idle'
  if (isMoving) return 'walk'
  if (run.status === 'awaiting_approval') return 'wait'
  if (run.status === 'done') return 'win'
  if (run.status === 'failed' || run.status === 'cancelled' || run.steps.some(s => s.status === 'failed')) return 'fail'
  if (run.steps.some(s => s.status === 'running')) return 'work'
  return 'idle'
}

const trunc = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)

function speech(run: Run | null): string {
  if (!run || run.revision === 0) return 'Sem fluxo nesta sessão. Use /ultron <tarefa> ou inicie pelo dashboard.'
  const running = run.steps.filter(s => s.status === 'running')
  switch (run.status) {
    case 'awaiting_approval':
      return run.feedback ? `Refazendo: ${run.feedback}` : 'Aprova o fluxo? Responda "aprovar" ou use o dashboard.'
    case 'approved':
      return 'Aprovado! Partindo…'
    case 'paused':
      return 'Pausado pelo usuário.'
    case 'done':
      return 'Missão cumprida! 🏁'
    case 'failed':
      return 'A jornada falhou.'
    case 'cancelled':
      return 'Jornada cancelada.'
    default:
      return running.length > 1 ? `${running.length} agentes em ação` : running[0] ? `Em ${running[0].id}: ${running[0].title}` : 'Entre ondas…'
  }
}

const isUltronSkill = (skill: string) => skill === 'ultron' || skill.endsWith(':ultron')

async function onCli($: EngineInterface, command: string) {
  if (!/ultron\.mjs/.test(command)) return
  await followSession($).catch(() => {})
  if (!(await isActive($))) await activate($)
}

// ---------------------------------------------------------------- presence: every session, flow or not

/** The repository a session runs in: `key` names it for the AI names (owner/repo from origin, else the folder). */
type RepoInfo = { key: string; name: string; root: string }
type SessionInfo = { sessionId: string; cwd: string; branch: string | null; repo: RepoInfo | null; startedAt: number; at: number; endedAt?: number }
type Task = { id: string; prompt: string; at: number; takenAt?: number; error?: string }

// Per load, like `paths`; a reload starts presence again from session.start.
let presenceTimers: { cancel: () => void }[] = []
let presence: { file: string; task: string; names: string; info: SessionInfo } | null = null
let taskStamp = ''

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 }).catch(() => null)
  return r && r.exitCode === 0 ? r.stdout.trim() : ''
}

/** Branch and repository of the folder, or nulls outside a git repository. */
async function gitInfo($: EngineInterface, cwd: string): Promise<{ branch: string | null; repo: RepoInfo | null }> {
  const root = await git($, cwd, ['rev-parse', '--show-toplevel'])
  if (!root) return { branch: null, repo: null }
  const head = await git($, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const origin = await git($, cwd, ['remote', 'get-url', 'origin'])
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(origin)
  const name = m ? `${m[1]}/${m[2]}` : (slash(root).split('/').filter(Boolean).pop() ?? root)
  return { branch: head && head !== 'HEAD' ? head : null, repo: { key: name.toLowerCase(), name, root: slash(root) } }
}

/** The AI name and colour the dashboard gave this session's repo, for the pane. */
async function readIdentity($: EngineInterface) {
  if (!presence) return
  const repo = presence.info.repo
  const names = repo && (await $.fs.exists(presence.names)) ? await readJson<{ repos?: Record<string, { name: string; color: string }> }>($, presence.names, {}) : {}
  const ai = repo ? names.repos?.[repo.key] : undefined
  const next: Identity | null = repo ? { name: ai?.name ?? '', color: ai?.color ?? NO_REPO_COLOR, repo: repo.name } : null
  const held = await read($, identityAtom)
  if (JSON.stringify(held) !== JSON.stringify(next)) await update($, identityAtom, () => next)
}

const writePresence = ($: EngineInterface) => (presence ? $.fs.write(presence.file, JSON.stringify(presence.info, null, 1)) : Promise.resolve())

/** Registers this session for the dashboard's Sessions tab and keeps the dashboard up. Draws nothing. */
async function startPresence($: EngineInterface, cwd: string) {
  for (const t of presenceTimers) t.cancel()
  const sessionId = await $.session.id()
  const p = await pathsFor($, sessionId)
  const file = `${p.home}/sessions/${sessionId}.json`
  const held = (await $.fs.exists(file)) ? await readJson<SessionInfo | null>($, file, null) : null
  const now = await $.clock.now()
  presence = {
    file,
    task: `${p.home}/sessions/${sessionId}.task.json`,
    names: `${p.home}/names.json`,
    info: { sessionId, cwd: slash(cwd), ...(await gitInfo($, cwd)), startedAt: held?.startedAt ?? now, at: now },
  }
  await writePresence($)
  await readIdentity($).catch(() => {})
  // The pane shows in every session: Ultron waiting, with no flow until /ultron or a task from the dashboard.
  const cfg = await readJson<{ port?: number }>($, p.config, {})
  port = Number(cfg.port) || DEFAULT_PORT
  await update($, sessionAtom, () => sessionId)
  if (!(await read($, runAtom))) {
    const run = await readJson<Run | null>($, p.run, null)
    if (run) await update($, runAtom, () => run)
  }
  void openPane($)
  presenceTimers = [
    $.clock.every(3000, () => {
      if (!presence) return
      void followSession($)
        .then(() => $.clock.now())
        .then(at => {
          if (!presence) return
          presence.info = { ...presence.info, at }
          return writePresence($).then(() => readIdentity($))
        })
        .catch(() => {})
    }),
    $.clock.every(30_000, () => {
      if (!presence) return
      void gitInfo($, presence.info.cwd).then(found => {
        presence!.info = { ...presence!.info, ...found }
      }).catch(() => {})
    }),
    $.clock.every(2000, () => void takeTask($).catch(err => $.ui.log(`ultron: tarefa do dashboard: ${String(err)}`, { to: 'debug' }))),
  ]
  // The dashboard lists every open session, so it is kept up from any of them.
  void $.process
    .run(['node', `${slash($.plugin.root)}/bin/ultron.mjs`, 'dashboard', '--no-open', '--session', sessionId], { timeoutMs: 15_000 })
    .catch(err => $.ui.log(`ultron: dashboard não subiu: ${String(err)}`, { to: 'debug' }))
}

/** A task left by the dashboard runs here as `/ultron <task>`; the plan still waits for the person's approval. */
async function takeTask($: EngineInterface) {
  if (!presence || !(await $.fs.exists(presence.task))) return
  const stat = await $.fs.stat(presence.task).catch(() => null)
  const stamp = stat ? `${stat.size}:${stat.mtimeMs}` : ''
  if (stamp === taskStamp) return
  taskStamp = stamp
  const task = await readJson<Task | null>($, presence.task, null)
  if (!task || task.takenAt || task.id === (await read($, lastTaskAtom))) return
  await update($, lastTaskAtom, () => task.id)
  const takenAt = await $.clock.now()
  await $.fs.write(presence.task, JSON.stringify({ ...task, takenAt }, null, 1))
  const command = (await $.command.list()).find(c => isUltronSkill(c.name))?.name ?? 'ultron'
  try {
    await $.command.run({ command, args: task.prompt })
  } catch (err) {
    await $.fs.write(presence.task, JSON.stringify({ ...task, takenAt, error: String(err) }, null, 1))
  }
}

/** Writes this session's end for the dashboard. */
async function markEnded($: EngineInterface) {
  if (!presence) return
  const now = await $.clock.now()
  presence.info = { ...presence.info, at: now, endedAt: now }
  await writePresence($)
}

async function endPresence($: EngineInterface) {
  for (const t of presenceTimers) t.cancel()
  presenceTimers = []
  await markEnded($)
}

/** A resumed session, or one reloaded mid-flow, picks its unfinished journey up again. */
async function pickUpFlow($: EngineInterface) {
  const p = await pathsFor($, await $.session.id())
  const run = await readJson<Run | null>($, p.run, null)
  if ((await isActive($)) || (run && run.revision > 0 && !isTerminal(run.status))) await activate($)
}

let following: Promise<void> | null = null

/**
 * `/resume` and `/clear` end the session and carry on in the same process under
 * another id, with no `session.start` for it: presence and the flow move over
 * to the new id here, at the next heartbeat, prompt or CLI call.
 */
function followSession($: EngineInterface): Promise<void> {
  following ??= (async () => {
    if (!presence) return
    const sessionId = await $.session.id()
    if (sessionId === presence.info.sessionId) return
    if (!presence.info.endedAt) await markEnded($)
    // The flow belonged to the old session: let it go before looking at the new one's.
    stopTimers()
    paths = null
    await update($, activeAtom, () => false)
    await update($, runAtom, () => null)
    await startPresence($, await $.session.cwd())
    await pickUpFlow($)
  })().finally(() => {
    following = null
  })
  return following
}

export const register: Register = on => {
  // ------------------------------------------------------------ activation

  // Typing /ultron turns the mod on before the model reads the skill.
  on('prompt.submit', async ($, e, next) => {
    await followSession($).catch(() => {})
    if (e.command && isUltronSkill(e.command.name) && !(await isActive($))) await activate($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The skill's first CLI call turns it on too, wherever the submit hook did not run.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await onCli($, e.command)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    await onCli($, e.command)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A task started from the dashboard arrives as a command, not a typed prompt.
  on('command.run', async ($, e, next) => {
    await followSession($).catch(() => {})
    if (isUltronSkill(e.command) && !(await isActive($))) await activate($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // Every open session shows in the dashboard (not `claude -p` or an SDK run); the flow itself still waits for /ultron.
    if (e.isInteractive) await startPresence($, e.cwd).catch(err => $.ui.log(`ultron: presença: ${String(err)}`, { to: 'debug' }))
    // A reload, or a resumed session that already had a journey: pick it up again.
    await pickUpFlow($)
    return r
  })

  on('session.end', async ($, e, next) => {
    stopTimers()
    // After /resume or /clear the process goes on under another id: the heartbeat stays to follow it there.
    const goesOn = e.reason === 'resume' || e.reason === 'clear'
    await (goesOn ? markEnded($) : endPresence($)).catch(() => {})
    return next(e)
  })

  // ------------------------------------------------------------ the flow's agents

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const tag = TAG.exec(e.description ?? '')
    if (!tag || !(await isActive($)) || !paths) return next(e)
    const run = await readJson<Run | null>($, paths.run, null)
    const g = gate(run, tag[1]!)
    if (!g.ok) return { deny: `Ultron: ${g.reason}` }
    const step = g.step
    await raise($, { type: 'agent-start', stepId: step.id, toolUseId: e.tool_use_id })
    const repo = run?.agent
    const prompt = repo && step.mode === 'agent' ? await withRepoAgent($, repo, step.id, e.prompt ?? '') : e.prompt
    // The plan decides, so a change made in the dashboard holds even if the call forgot it.
    const ran = await next({ ...e, prompt, model: step.model, effort: step.effort, subagent_type: step.agentType })
    if (ran.deny !== undefined || ran.isError === true) {
      await raise($, { type: 'step', stepId: step.id, status: 'failed', note: 'o agente não iniciou' })
    }
    return ran
  }).catch(($, e, next) => next(e)) // a fault here never blocks the call

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId && (await isActive($))) {
      const run = await read($, runAtom)
      if (run?.steps.some(s => s.toolUseId === e.tool_use_id)) await raise($, { type: 'agent-bind', toolUseId: e.tool_use_id, agentId: r.agentId })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId && (await isActive($))) {
      const run = await read($, runAtom)
      if (run?.steps.some(s => s.agentId === e.agentId)) {
        const u = e.usage
        await raise($, {
          type: 'agent-end',
          agentId: e.agentId,
          isOk: e.reason === 'answer',
          usage: u ? { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : undefined,
        })
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  // ------------------------------------------------------------ the pane

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const width = Math.max(24, e.props.bodyColumns - 2)
    const run = await read($, runAtom)
    const frame = await read($, frameAtom)
    const pos = await read($, posAtom)
    const sessionId = await read($, sessionAtom)
    const identity = await read($, identityAtom)
    const now = await $.clock.now()

    // `pos` walks on a 40-column trail (see animate); scale it to this width.
    const isMoving = run !== null && pos !== targetColumn(run, 40)
    const left = Math.max(0, Math.min(width - SPRITE_W - 2, Math.round((pos / (40 - SPRITE_W)) * (width - SPRITE_W - 2))))
    const pose = poseOf(run, isMoving)
    const sprite = cells(pose, frame)

    const waves = run ? [...new Set(run.steps.map(s => s.wave))].sort((a, b) => a - b) : []
    const at = run ? currentWave(run, waves) : 0
    const marks: { x: number; ch: string; color: string }[] = []
    waves.forEach((w, i) => {
      const steps = run!.steps.filter(s => s.wave === w)
      const isDone = steps.every(s => s.status === 'done' || s.status === 'skipped')
      const hasFailed = steps.some(s => s.status === 'failed')
      marks.push({ x: stationX(i, waves.length, width), ch: hasFailed ? '✖' : isDone ? '●' : i === at ? '◉' : '○', color: hasFailed || i === at ? RED : isDone ? 'success' : 'subtle' })
    })
    marks.push({ x: Math.min(width - 2, stationX(waves.length, waves.length, width)), ch: run?.status === 'done' ? '🏁' : '⚑', color: run?.status === 'done' ? 'success' : 'subtle' })
    const litUntil = marks[Math.min(at, marks.length - 1)]?.x ?? 0

    const segments: { text: string; color: string }[] = []
    let buf = ''
    let bufColor = ''
    for (let x = 0; x < width; x++) {
      const mark = marks.find(m => m.x === x)
      if (mark) {
        if (buf) segments.push({ text: buf, color: bufColor })
        buf = ''
        segments.push({ text: mark.ch, color: mark.color })
        if (mark.ch === '🏁') x += 1
        continue
      }
      const color = x < litUntil ? RED : 'subtle'
      if (color !== bufColor && buf) {
        segments.push({ text: buf, color: bufColor })
        buf = ''
      }
      bufColor = color
      buf += '━'
    }
    if (buf) segments.push({ text: buf, color: bufColor })

    const { done, total } = run ? progress(run) : { done: 0, total: 0 }
    const rows = Math.max(4, (e.viewport?.rows ?? 30) - 16)
    const steps = run ? run.steps.slice(0, rows) : []
    const pad = ' '.repeat(left)

    return (
      <Box flexDirection="column" paddingX={1}>
        {identity ? (
          <Text wrap="truncate">
            <Text color={identity.color} bold>
              ◉ {identity.name || '…'}
            </Text>
            <Text dimColor> · {trunc(identity.repo, width - (identity.name.length || 1) - 6)}</Text>
          </Text>
        ) : (
          <Text dimColor>○ sessão sem repositório</Text>
        )}
        {sprite.map((row, i) => (
          <Text key={`s${i}`}>
            {pad}
            {row.map((c, j) => (
              <Text key={`c${j}`} color={c.fg} backgroundColor={c.bg}>
                {c.ch}
              </Text>
            ))}
            {i === 1 ? <Text color="#ffe08a">{spark(pose, frame)}</Text> : ''}
          </Text>
        ))}
        <Text>
          {segments.map((s, i) => (
            <Text key={`t${i}`} color={s.color}>
              {s.text}
            </Text>
          ))}
        </Text>
        <Box borderStyle="round" borderColor={RED} paddingX={1} marginTop={1}>
          <Box flexDirection="column">
            <Text wrap="wrap" bold>
              {lineFor(run, momentOf(run, isMoving), now)}
            </Text>
            <Text wrap="wrap" dimColor>
              {speech(run)}
            </Text>
          </Box>
        </Box>
        {run && run.revision > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold wrap="truncate">
              {trunc(run.goal, width)}
            </Text>
            <Text dimColor wrap="truncate">
              {run.playbook} · {run.profile} · rev {run.revision}
              {isApproved(run) ? ' ✓' : ''} · {done}/{total}
            </Text>
            <Text color={run.status === 'awaiting_approval' ? RED : run.status === 'done' ? 'success' : 'text'}>
              ▸ {statusText(run.status)}
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {steps.map(s => (
                <Text key={s.id} wrap="truncate" dimColor={s.status === 'done' || s.status === 'skipped'}>
                  <Text color={s.status === 'running' || s.status === 'failed' ? RED : s.status === 'done' ? 'success' : 'subtle'}>{STEP_MARK[s.status]}</Text> {s.wave}·{' '}
                  {trunc(s.id, 12)}{' '}
                  {s.mode === 'inline' ? <Text color={RED}>ultron</Text> : <Text color={TIER_COLOR[s.model]}>{s.model}</Text>}
                  <Text dimColor>/{s.mode === 'inline' ? 'inline' : s.effort}</Text>
                </Text>
              ))}
              {run.steps.length > steps.length && <Text dimColor>+{run.steps.length - steps.length} etapas</Text>}
            </Box>
          </Box>
        )}
        {sessionId && (
          <Box marginTop={1}>
            <Link href={dashboardUrl(sessionId)} label="Abrir dashboard ↗" />
          </Box>
        )}
      </Box>
    )
  })
}
