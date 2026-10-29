import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = 'C:/Users/tester'
const SID = 'sess-1'
const RUN = `${HOME}/.claude/ultron/runs/${SID}/run.json`

const PANE = {
  plugin: 'ultron',
  component: 'Pane',
  requestId: 'ultron',
  props: {
    title: '🤖 Ultron',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const step = (id: string, wave: number, extra = {}) => ({
  id,
  title: `Etapa ${id}`,
  role: 'builder',
  mode: 'agent',
  agentType: 'general-purpose',
  model: 'sonnet',
  effort: 'medium',
  wave,
  dependsOn: [],
  status: 'pending',
  ...extra,
})

function run(extra = {}) {
  return {
    version: 1,
    sessionId: SID,
    goal: 'Adicionar endpoint /health',
    playbook: 'scout-then-build',
    profile: 'equilibrado',
    rationale: '',
    complexity: 4,
    status: 'approved',
    revision: 2,
    approval: { by: 'chat', at: 1, revision: 2 },
    steps: [step('map', 1, { role: 'scout', agentType: 'Explore', model: 'haiku', effort: 'low' }), step('build', 2, { model: 'opus', effort: 'high' })],
    events: [],
    consumed: 0,
    acks: {},
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

/** The world beneath the mod: a file system in memory, the session, the pane. */
function world(on: On, seed: Record<string, string>, opts: { unreadable?: string } = {}) {
  // The engine hands the mod's paths over in the platform's spelling.
  const key = (p: string) => p.replace(/\\/g, '/')
  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(seed)) files[key(k)] = v
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: HOME })
  on('session.id', () => ({ value: SID }))
  on('env.set', () => ({ value: {} }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.exists', (_, e) => ({ value: key(e.path) in files }))
  on('fs.read', (_, e) => (key(e.path) === opts.unreadable ? { deny: 'EACCES' } : { value: files[key(e.path)] ?? '' }))
  on('fs.write', (_, e) => {
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  const told: string[] = []
  on('prompt.submit', (_, e) => {
    told.push(e.text)
    return { text: e.text }
  })
  const agents: { model?: string; effort?: string; subagent_type?: string }[] = []
  const prompts: string[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'Agent') {
      agents.push({ model: e.model, effort: e.effort, subagent_type: e.subagent_type })
      prompts.push(e.prompt)
    }
    return { result: {} }
  })
  return { agents, prompts, files, clock, told }
}

const denial = (r: { deny?: string; text?: string }) => String(r.deny ?? r.text ?? '')

const activate = ($: Engine) => $.tool.call({ tool: 'Bash', command: 'node "C:/x/ultron/bin/ultron.mjs" --session sess-1 session' })

test('before /ultron, an Agent call tagged for a step passes untouched', async ($, on) => {
  const { agents } = world(on, { [RUN]: JSON.stringify(run()) })
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Fazer', prompt: 'x', model: 'haiku', effort: 'low' })
  expect(agents).toEqual([{ model: 'haiku', effort: 'low', subagent_type: undefined }])
})

test('once active, a tagged Agent runs on the plan’s model, effort and agent', async ($, on) => {
  const { agents, files } = world(on, { [RUN]: JSON.stringify(run({ steps: [step('build', 1, { model: 'opus', effort: 'high' })] })) })
  await activate($)
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Fazer', prompt: 'x', model: 'haiku', effort: 'low', subagent_type: 'Explore' })
  expect(agents).toEqual([{ model: 'opus', effort: 'high', subagent_type: 'general-purpose' }])
  const saved = JSON.parse(files[RUN]!)
  expect(saved.steps[0].status).toBe('running')
  expect(saved.status).toBe('running')
})

test('a plan not yet approved denies the tagged Agent', async ($, on) => {
  const { agents } = world(on, { [RUN]: JSON.stringify(run({ status: 'awaiting_approval', revision: 3 })) })
  await activate($)
  const r = await $.tool.call({ tool: 'Agent', description: 'ultron:map Mapear', prompt: 'x' })
  expect(agents).toEqual([])
  expect(denial(r)).toMatch(/não foi aprovado/)
})

test('a step waiting on another is denied until it is done', async ($, on) => {
  const { agents } = world(on, { [RUN]: JSON.stringify(run({ steps: [step('map', 1), step('build', 2, { dependsOn: ['map'] })] })) })
  await activate($)
  const r = await $.tool.call({ tool: 'Agent', description: 'ultron:build Fazer', prompt: 'x' })
  expect(agents).toEqual([])
  expect(denial(r)).toMatch(/espera map/)
})

test('an Agent without the tag passes untouched while active', async ($, on) => {
  const { agents } = world(on, { [RUN]: JSON.stringify(run({ status: 'awaiting_approval', revision: 3 })) })
  await activate($)
  await $.tool.call({ tool: 'Agent', description: 'explorar o repo', prompt: 'x', model: 'haiku' })
  expect(agents).toEqual([{ model: 'haiku', effort: undefined, subagent_type: undefined }])
})

test('the pane draws Ultron, the trail and the flow', async ($, on) => {
  world(on, { [RUN]: JSON.stringify(run({ status: 'awaiting_approval', revision: 3 })) })
  await activate($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Aprova o fluxo/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /aguardando aprovação/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /▀/ })).toBeTruthy()
    expect(await ui.find({ type: 'Text', text: /⚑/ })).toBeTruthy()
    await ui.unmount()
  }
})

test('an approval sent from the dashboard is applied and told to the session', async ($, on) => {
  const inbox = `${HOME}/.claude/ultron/runs/${SID}/inbox.jsonl`
  const line = JSON.stringify({ id: 'c1', by: 'dashboard', type: 'approve', revision: 3 })
  const { files, clock, told } = world(on, { [RUN]: JSON.stringify(run({ status: 'awaiting_approval', revision: 3 })), [inbox]: `${line}\n` })
  on('fs.stat', () => ({ value: { kind: 'file', size: line.length + 1, mtimeMs: 5, isLink: false } }))
  await activate($)
  await clock.advance(1100)
  const saved = JSON.parse(files[RUN]!)
  expect(saved.status).toBe('approved')
  expect(saved.approval.by).toBe('dashboard')
  expect(saved.acks.c1.ok).toBe(true)
  expect(told.join(' ')).toMatch(/APROVOU o plano no dashboard/)
})

const AGENT_FILE = `${HOME}/.claude/ultron/agents/acme__meu-app.md`

test('a run with a repo agent puts the agent file, read at the call, before the step’s prompt', async ($, on) => {
  const { prompts, files } = world(on, {
    [RUN]: JSON.stringify(run({ agent: 'acme/meu-app', steps: [step('build', 1)] })),
    [AGENT_FILE]: '---\nname: revisor-meu-app\n---\nOlhe o módulo de pagamentos.\n',
  })
  await activate($)
  files[AGENT_FILE] = '---\nname: revisor-meu-app\n---\nOlhe o módulo de pagamentos e o de webhooks.\n'
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Revisar', prompt: 'Revise a PR 42.' })
  expect(prompts).toEqual([
    `<agente-do-repo repo="acme/meu-app" arquivo="${AGENT_FILE}">\n---\nname: revisor-meu-app\n---\nOlhe o módulo de pagamentos e o de webhooks.\n</agente-do-repo>\n\nRevise a PR 42.`,
  ])
  const saved = JSON.parse(files[RUN]!)
  expect(saved.events.some((e: { text: string }) => e.text === 'build → agente do repo acme/meu-app')).toBe(true)
})

test('a repo with no agent file yet gets the short block', async ($, on) => {
  const { prompts } = world(on, { [RUN]: JSON.stringify(run({ agent: 'acme/meu-app', steps: [step('build', 1)] })) })
  await activate($)
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Contexto', prompt: 'Monte o contexto.' })
  expect(prompts[0]).toMatch(/^<agente-do-repo repo="acme\/meu-app" arquivo="[^"]+acme__meu-app\.md" estado="novo">Este repo ainda não tem agente\./)
  expect(prompts[0]!.endsWith('</agente-do-repo>\n\nMonte o contexto.')).toBe(true)
})

test('an agent file that cannot be read never blocks the call', async ($, on) => {
  const { agents, prompts } = world(on, { [RUN]: JSON.stringify(run({ agent: 'acme/meu-app', steps: [step('build', 1)] })), [AGENT_FILE]: 'x' }, { unreadable: AGENT_FILE })
  await activate($)
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Revisar', prompt: 'Revise a PR 42.' })
  expect(agents).toEqual([{ model: 'sonnet', effort: 'medium', subagent_type: 'general-purpose' }])
  expect(prompts).toEqual(['Revise a PR 42.'])
})

test('a run without a repo agent leaves the prompt alone', async ($, on) => {
  const { prompts } = world(on, { [RUN]: JSON.stringify(run({ steps: [step('build', 1)] })), [AGENT_FILE]: 'x' })
  await activate($)
  await $.tool.call({ tool: 'Agent', description: 'ultron:build Fazer', prompt: 'Faça.' })
  expect(prompts).toEqual(['Faça.'])
})
