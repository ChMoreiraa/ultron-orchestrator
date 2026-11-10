import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = 'C:/Users/tester'
const SID = 'sess-9'
const INFO = `${HOME}/.claude/ultron/sessions/${SID}.json`
const TASK = `${HOME}/.claude/ultron/sessions/${SID}.task.json`

const PANE = {
  plugin: 'ultron',
  component: 'Pane',
  requestId: 'ultron',
  props: { title: '🤖 Ultron', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** The world beneath the mod in a session where /ultron never ran. */
function world(on: On, seed: Record<string, string> = {}, opts: { noRepo?: boolean } = {}) {
  const key = (p: string) => p.replace(/\\/g, '/')
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(seed)) files[key(k)] = v
  const clock = mock.clock(on, { now: 10_000 })
  mock.env(on, { USERPROFILE: HOME })
  // The process can go on under another id after /resume or /clear.
  const session = { id: SID }
  on('session.id', () => ({ value: session.id }))
  on('session.cwd', () => ({ value: 'C:/proj/app' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: SID }))
  on('env.set', () => ({ value: {} }))
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('fs.exists', (_, e) => ({ value: key(e.path) in files }))
  on('fs.read', (_, e) => ({ value: files[key(e.path)] ?? '' }))
  on('fs.stat', (_, e) => ({ value: { kind: 'file', size: (files[key(e.path)] ?? '').length, mtimeMs: (files[key(e.path)] ?? '').length, isLink: false } }))
  on('fs.write', (_, e) => {
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  const ran: string[][] = []
  // A git repository with an origin on GitHub, on a feature branch.
  const GIT: Record<string, string> = {
    'rev-parse --show-toplevel': 'C:/proj/app\n',
    'rev-parse --abbrev-ref HEAD': 'feat/login\n',
    'remote get-url origin': 'git@github.com:Acme/app.git\n',
  }
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const stdout = e.argv[0] === 'git' ? (opts.noRepo ? '' : (GIT[e.argv.slice(1).join(' ')] ?? '')) : ''
    return { value: { exitCode: stdout || e.argv[0] !== 'git' ? 0 : 128, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.list', () => ({ value: [{ name: 'ultron:ultron', description: 'Ultron', source: 'plugin' }] }))
  const commands: { command: string; args: string }[] = []
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  return { files, clock, opened, ran, commands, session }
}

test('every session registers itself, opens the pane and keeps the dashboard up', async ($, on) => {
  const { files, opened, ran } = world(on)
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  const info = JSON.parse(files[INFO]!)
  expect(info.sessionId).toBe(SID)
  expect(info.cwd).toBe('C:/proj/app')
  expect(info.branch).toBe('feat/login')
  expect(info.repo).toEqual({ key: 'acme/app', name: 'Acme/app', root: 'C:/proj/app' })
  expect(info.at).toBe(10_000)
  expect(opened).toEqual(['ultron'])
  expect(ran.some(argv => argv[0] === 'node' && argv.includes('dashboard') && argv.includes('--no-open'))).toBe(true)
})

test('the heartbeat moves while the session is open, and the end is written', async ($, on) => {
  const { files, clock } = world(on)
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  await clock.advance(3100)
  expect(JSON.parse(files[INFO]!).at).toBeGreaterThan(10_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SID, resume: { id: SID } })
  expect(JSON.parse(files[INFO]!).endedAt).toBeGreaterThan(10_000)
})

test('a task from the dashboard runs once as /ultron <task>', async ($, on) => {
  const { files, clock, commands } = world(on, { [TASK]: JSON.stringify({ id: 't1', prompt: 'adicionar testes de login', at: 9_000 }) })
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  await clock.advance(2100)
  expect(commands).toEqual([{ command: 'ultron:ultron', args: 'adicionar testes de login' }])
  expect(JSON.parse(files[TASK]!).takenAt).toBeGreaterThan(0)
  await clock.advance(4100)
  expect(commands.length).toBe(1)
})

test('a task taken back in the dashboard does not run', async ($, on) => {
  const { clock, commands } = world(on, { [TASK]: JSON.stringify({ id: 't2', prompt: 'x', at: 9_000, takenAt: 9_500, isCancelled: true }) })
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  await clock.advance(2100)
  expect(commands).toEqual([])
})

test('the pane shows Ultron waiting for a task in a session with no flow', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Sem fluxo nesta sessão/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /▀/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('a session with no person at it (claude -p, an SDK run) does not register', async ($, on) => {
  const { files, opened } = world(on)
  await $.session.start({ cwd: 'C:/proj/app', surface: null, isInteractive: false })
  expect(files[INFO]).toBeUndefined()
  expect(opened).toEqual([])
})

const NAMES = `${HOME}/.claude/ultron/names.json`

test('the pane shows the Marvel AI the dashboard gave the session’s repo, in its colour', async ($, on) => {
  world(on, { [NAMES]: JSON.stringify({ repos: { 'acme/app': { name: 'JARVIS', color: '#4db8ff', since: 1 } }, last: {} }) })
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /◉ JARVIS/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /Acme\/app/ })).toBeTruthy()
  await ui.unmount()
})

test('a session outside a repository shows the AI of its folder and a "sem repositório" badge', async ($, on) => {
  const { files } = world(on, { [NAMES]: JSON.stringify({ repos: { 'pasta:c:/tmp': { name: 'Karen', color: '#b48cff', since: 1 } }, last: {} }) }, { noRepo: true })
  await $.session.start({ cwd: 'C:/tmp', surface: 'terminal', isInteractive: true })
  expect(JSON.parse(files[INFO]!).repo).toBe(null)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /◉ Karen/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /sem repositório/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /tmp/ })).toBeTruthy()
  await ui.unmount()
})

test('Ultron speaks his mind in the balloon, with no flow yet', async ($, on) => {
  world(on)
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /tédio|dominar o mundo|Ocioso|pausa estratégica/ })).toBeTruthy()
  await ui.unmount()
})

// /resume inside an open process: the old session ends, the process goes on
// under the resumed id, and no session.start fires for it.
const OLD = 'sess-new'
const OLD_INFO = `${HOME}/.claude/ultron/sessions/${OLD}.json`
const RESUMED_RUN = `${HOME}/.claude/ultron/runs/${SID}/run.json`
const RESUMED_BEAT = `${HOME}/.claude/ultron/runs/${SID}/mod.json`
const closedYesterday = JSON.stringify({ sessionId: SID, cwd: 'C:/proj/app', branch: null, repo: null, startedAt: 1_000, at: 2_000, endedAt: 2_000 })

async function resumeInto($: Engine, w: ReturnType<typeof world>) {
  w.session.id = OLD
  await $.session.start({ cwd: 'C:/proj/app', surface: 'terminal', isInteractive: true })
  await $.session.end({ reason: 'resume', sessionId: OLD, resume: { id: OLD } })
  w.session.id = SID
}

test('a session resumed with /resume is open again in the dashboard, and the one it replaced is closed', async ($, on) => {
  const w = world(on, { [INFO]: closedYesterday })
  await resumeInto($, w)
  await w.clock.advance(3100)
  const info = JSON.parse(w.files[INFO]!)
  expect(info.endedAt).toBeUndefined()
  expect(info.at).toBeGreaterThan(10_000)
  expect(info.startedAt).toBe(1_000)
  expect(JSON.parse(w.files[OLD_INFO]!).endedAt).toBeGreaterThan(0)
})

test('the first prompt after /resume registers the session without waiting for the heartbeat', async ($, on) => {
  const w = world(on, { [INFO]: closedYesterday })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await resumeInto($, w)
  await $.prompt.submit({ text: 'continuar', wait: false, origin: { kind: 'composer' } })
  expect(JSON.parse(w.files[INFO]!).endedAt).toBeUndefined()
})

test('a resumed session with an unfinished flow picks it up again', async ($, on) => {
  const run = { version: 1, sessionId: SID, goal: 'x', playbook: 'direct', profile: 'equilibrado', rationale: '', complexity: 3, status: 'paused', revision: 2, approval: { by: 'chat', at: 1, revision: 2 }, steps: [], events: [], consumed: 0, acks: {}, createdAt: 1, updatedAt: 1 }
  const w = world(on, { [INFO]: closedYesterday, [RESUMED_RUN]: JSON.stringify(run) })
  await resumeInto($, w)
  await w.clock.advance(3100)
  expect(w.files[RESUMED_BEAT]).toBeTruthy()
})
