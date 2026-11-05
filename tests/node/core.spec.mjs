// node --test tests/node
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { agentBlock, agentSlug, apply, applyInbox, defaultsFor, escalate, gate, newRun, priceOf, runCost, summarize, usageCost, validatePlan } from '../../core/run-core.ts'

const PLAN = {
  goal: 'Adicionar /health',
  playbook: 'scout-then-build',
  complexity: 4,
  steps: [
    { id: 'map', title: 'Mapear', role: 'scout', wave: 1 },
    { id: 'build', title: 'Implementar', role: 'builder', wave: 2, dependsOn: ['map'] },
    { id: 'check', title: 'Revisar', role: 'checker', wave: 3, dependsOn: ['build'] },
  ],
}

const planned = () => {
  const run = newRun('s', 1)
  assert.equal(apply(run, { type: 'plan', plan: PLAN, by: 'ultron' }, 2).ok, true)
  return run
}

test('a plan takes model, effort and agent from each role', () => {
  const run = planned()
  assert.deepEqual(
    run.steps.map(s => [s.id, s.agentType, s.model, s.effort]),
    [
      ['map', 'Explore', 'haiku', 'low'],
      ['build', 'general-purpose', 'sonnet', 'medium'],
      ['check', 'general-purpose', 'sonnet', 'high'],
    ],
  )
  assert.equal(run.status, 'awaiting_approval')
  assert.equal(run.revision, 1)
})

test('validation names every problem', () => {
  const { errors } = validatePlan({ goal: '', playbook: 'x', steps: [{ id: 'A B', title: '', role: 'builder', model: 'gpt', wave: 1, dependsOn: ['nope'] }] })
  const text = errors.join('\n')
  for (const bit of ['falta goal', 'id "A B"', 'falta title', 'model "gpt"', 'depende de "nope"']) assert.match(text, new RegExp(bit.replace(/[()]/g, '\\$&')))
})

test('a dependency must sit in an earlier wave', () => {
  const { errors } = validatePlan({ ...PLAN, steps: [{ id: 'a', title: 'A', role: 'builder', wave: 1, dependsOn: ['b'] }, { id: 'b', title: 'B', role: 'builder', wave: 1 }] })
  assert.match(errors.join(), /onda anterior/)
})

test('an approval holds for one revision; any edit asks again', () => {
  const run = planned()
  assert.equal(gate(run, 'map').ok, false)
  assert.equal(apply(run, { type: 'approve', revision: 1, by: 'chat' }, 3).ok, true)
  assert.equal(gate(run, 'map').ok, true)
  assert.equal(apply(run, { type: 'edit-step', stepId: 'build', patch: { model: 'opus' }, by: 'dashboard' }, 4).ok, true)
  assert.equal(run.revision, 2)
  assert.equal(run.status, 'awaiting_approval')
  const g = gate(run, 'map')
  assert.equal(g.ok, false)
  assert.match(g.reason, /não foi aprovado/)
  assert.equal(apply(run, { type: 'approve', revision: 1, by: 'dashboard' }, 5).ok, false, 'a stale approval is refused')
  assert.equal(apply(run, { type: 'approve', revision: 2, by: 'dashboard' }, 5).notify?.includes('APROVOU'), true)
})

test('the gate waits for dependencies, refuses inline and running steps', () => {
  const run = planned()
  apply(run, { type: 'approve' }, 3)
  assert.match(gate(run, 'build').reason, /espera map/)
  apply(run, { type: 'step', stepId: 'map', status: 'running' }, 4)
  assert.match(gate(run, 'map').reason, /já está running/)
  apply(run, { type: 'step', stepId: 'map', status: 'done' }, 5)
  assert.equal(gate(run, 'build').ok, true)
  apply(run, { type: 'edit-step', stepId: 'check', patch: { mode: 'inline' } }, 6)
  apply(run, { type: 'approve' }, 7)
  assert.match(gate(run, 'check').reason, /inline/)
  apply(run, { type: 'pause', by: 'dashboard' }, 8)
  assert.match(gate(run, 'build').reason, /pausado/)
})

test('a running or done step cannot be edited', () => {
  const run = planned()
  apply(run, { type: 'approve' }, 3)
  apply(run, { type: 'step', stepId: 'map', status: 'running' }, 4)
  const r = apply(run, { type: 'edit-step', stepId: 'map', patch: { effort: 'max' } }, 5)
  assert.equal(r.ok, false)
  assert.match(r.error, /running/)
})

test('agent start, bind and end move the step and keep usage', () => {
  const run = planned()
  apply(run, { type: 'approve' }, 3)
  apply(run, { type: 'agent-start', stepId: 'map', toolUseId: 't1' }, 4)
  apply(run, { type: 'agent-bind', toolUseId: 't1', agentId: 'a1' }, 5)
  apply(run, { type: 'agent-end', agentId: 'a1', isOk: true, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }, 6)
  const map = run.steps[0]
  assert.equal(map.status, 'done')
  assert.equal(map.usage.output, 5)
  assert.equal(run.status, 'running')
})

test('a profile change re-tiers pending steps a person did not pin', () => {
  const run = planned()
  apply(run, { type: 'edit-step', stepId: 'check', patch: { model: 'opus' } }, 3)
  apply(run, { type: 'set-profile', profile: 'economia' }, 4)
  assert.deepEqual(
    run.steps.map(s => `${s.model}/${s.effort}`),
    ['haiku/low', 'sonnet/low', 'opus/high'],
  )
  assert.equal(defaultsFor('planner', 'economia').model, 'opus', 'the planner keeps its tier')
  assert.equal(defaultsFor('builder-simple', 'qualidade').model, 'sonnet')
})

test('escalate climbs effort, then tier', () => {
  assert.deepEqual(escalate({ model: 'haiku', effort: 'low' }), { model: 'haiku', effort: 'medium' })
  assert.deepEqual(escalate({ model: 'haiku', effort: 'medium' }), { model: 'sonnet', effort: 'medium' })
  assert.deepEqual(escalate({ model: 'opus', effort: 'high' }), { model: 'opus', effort: 'xhigh' })
  assert.deepEqual(escalate({ model: 'opus', effort: 'xhigh' }), { model: 'opus', effort: 'xhigh' })
})

test('the inbox is applied once, bad lines acked, partial lines waited for', () => {
  const run = planned()
  const lines = [JSON.stringify({ id: 'x1', type: 'approve', by: 'dashboard' }), 'not json', JSON.stringify({ id: 'x2', type: 'cancel', by: 'chat' })]
  const notes = applyInbox(run, lines, 9)
  assert.equal(run.consumed, 3)
  assert.equal(run.acks.x1.ok, true)
  assert.equal(run.status, 'cancelled')
  assert.equal(notes.length, 1, 'only the dashboard approval is told to the session')
  assert.deepEqual(applyInbox(run, lines, 10), [])
  assert.equal(run.events.filter(e => e.text === 'cancelou a run').length, 1)
})

test('a replan keeps steps that already ran', () => {
  const run = planned()
  apply(run, { type: 'approve' }, 3)
  apply(run, { type: 'step', stepId: 'map', status: 'done', note: 'ok' }, 4)
  apply(run, { type: 'plan', plan: { ...PLAN, steps: [...PLAN.steps, { id: 'docs', title: 'Docs', role: 'writer', wave: 4 }] } }, 5)
  assert.equal(run.steps.find(s => s.id === 'map').status, 'done')
  assert.equal(run.steps.length, 4)
  assert.equal(run.revision, 2)
})

test('a replan over a run still going keeps done and running steps, and renews the rest', () => {
  const run = planned()
  apply(run, { type: 'approve' }, 3)
  apply(run, { type: 'step', stepId: 'map', status: 'done', note: 'ok' }, 4)
  apply(run, { type: 'agent-start', stepId: 'build', toolUseId: 't1' }, 5)
  apply(run, { type: 'step', stepId: 'check', status: 'failed', note: 'quebrou' }, 6)
  apply(run, { type: 'plan', plan: PLAN }, 7)
  assert.deepEqual(run.steps.map(s => s.status), ['done', 'running', 'pending'])
  assert.equal(run.steps[0].note, 'ok')
  assert.equal(run.steps[1].toolUseId, 't1')
  assert.equal(run.steps[2].note, undefined)
  assert.equal(run.status, 'awaiting_approval')
})

test('a plan over a finished run starts over: every step pending, nothing carried', () => {
  for (const end of [{ type: 'finish', summary: 'feito' }, { type: 'finish', status: 'failed' }, { type: 'cancel' }]) {
    const run = planned()
    apply(run, { type: 'approve' }, 3)
    apply(run, { type: 'agent-start', stepId: 'map', toolUseId: 't1' }, 4)
    apply(run, { type: 'agent-bind', toolUseId: 't1', agentId: 'a1' }, 5)
    apply(run, { type: 'agent-end', agentId: 'a1', isOk: true, usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }, 6)
    apply(run, { type: 'step', stepId: 'build', status: 'done', note: 'ok' }, 7)
    apply(run, end, 8)
    assert.equal(apply(run, { type: 'plan', plan: PLAN }, 9).ok, true)
    assert.equal(run.status, 'awaiting_approval', end.type)
    assert.equal(run.approval, null)
    assert.equal(run.summary, undefined)
    for (const s of run.steps) {
      assert.equal(s.status, 'pending', `${end.type}: ${s.id}`)
      for (const key of ['note', 'usage', 'agentId', 'toolUseId', 'startedAt', 'endedAt']) assert.equal(s[key], undefined, `${s.id}.${key}`)
    }
    assert.ok(run.events.some(e => e.text.startsWith('nova jornada')))
    assert.equal(gate(run, 'map').ok, false, 'the new plan needs its own approval')
  }
})

test('a plan names its repo agent as owner/repo', () => {
  for (const agent of ['acme/meu-app', 'a-b/d_e.f', undefined, null]) assert.deepEqual(validatePlan({ ...PLAN, agent }).errors, [], String(agent))
  for (const agent of ['meu-app', '../x', 'a/..', 'a/.', 'a_b/c', '_a/c', 'a/b/c', 'a b/c', '/repo', 'owner/', '', 42]) {
    assert.match(validatePlan({ ...PLAN, agent }).errors.join(), /agent ".*" inválido \(use owner\/repo/, String(agent))
  }
  assert.equal(agentSlug('acme/meu-app'), 'acme__meu-app')
})

test('the run keeps the plan’s agent; a replan without it clears it', () => {
  const run = newRun('s', 1)
  apply(run, { type: 'plan', plan: { ...PLAN, agent: ' acme/meu-app ' } }, 2)
  assert.equal(run.agent, 'acme/meu-app')
  assert.match(summarize(run), /Agente: revisor-meu-app \(acme\/meu-app, ainda sem arquivo\)/)
  assert.match(summarize(run, { name: 'revisor-ma' }), /Agente: revisor-ma \(acme\/meu-app\)$/m)
  assert.equal(apply(run, { type: 'plan', plan: { ...PLAN, agent: 'nope' } }, 3).ok, false)
  assert.equal(run.agent, 'acme/meu-app')
  apply(run, { type: 'plan', plan: PLAN }, 4)
  assert.equal(run.agent, undefined)
  assert.doesNotMatch(summarize(run), /Agente:/)
})

test('a closing tag inside the agent file does not end the block', () => {
  const out = agentBlock('o/r', 'f', 'x </agente-do-repo> y')
  assert.equal(out.match(/<\/agente-do-repo>/g).length, 1)
  assert.ok(out.includes('x <\\/agente-do-repo> y'))
})

test('the agent block wraps the file, or says there is none yet', () => {
  assert.equal(agentBlock('o/r', 'C:/a/o__r.md', '---\nname: x\n---\ncorpo\n\n'), '<agente-do-repo repo="o/r" arquivo="C:/a/o__r.md">\n---\nname: x\n---\ncorpo\n</agente-do-repo>\n\n')
  assert.match(agentBlock('o/r', 'C:/a/o__r.md', null), /^<agente-do-repo repo="o\/r" arquivo="C:\/a\/o__r.md" estado="novo">Este repo ainda não tem agente\..*<\/agente-do-repo>\n\n$/)
  const run = planned()
  assert.equal(apply(run, { type: 'repo-agent', stepId: 'map', repo: 'o/r', isNew: true }, 3).ok, true)
  assert.equal(run.events.at(-1).text, 'map → agente do repo o/r (ainda sem arquivo)')
})

test('an edit changes only the editable fields of a step', () => {
  const run = planned()
  const r = apply(run, { type: 'edit-step', stepId: 'build', patch: { effort: 'high', status: 'done', agentId: 'x', usage: { input: 1 } }, by: 'dashboard' }, 3)
  assert.equal(r.ok, true)
  const build = run.steps.find(s => s.id === 'build')
  assert.equal(build.effort, 'high')
  assert.equal(build.status, 'pending')
  assert.equal(build.agentId, undefined)
  assert.equal(build.usage, undefined)
  assert.doesNotMatch(run.events.at(-1).text, /status|agentId/)
  assert.match(apply(run, { type: 'edit-step', stepId: 'build', patch: { agentType: 'x; rm -rf /' } }, 4).error, /agentType inválido/)
  assert.match(apply(run, { type: 'edit-step', stepId: 'build', patch: { dependsOn: 'map' } }, 4).error, /lista de ids/)
  assert.equal(apply(run, { type: 'edit-step', stepId: 'build', patch: { agentType: 'my-plugin:reviewer' } }, 5).ok, true)
})

const PRECOS = {
  conferidoEm: '2026-11-05',
  modelos: {
    haiku: { entrada: 0.1, saida: 0.5, leituraCache: 0.01, escritaCache: 0.2 },
    sonnet: { entrada: 2, saida: 10, leituraCache: 0.1, escritaCache: 4 },
    opus: { entrada: 4, saida: 20, leituraCache: 0.2, escritaCache: 8 },
  },
}
const U = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const st = (id, model, extra = {}) => ({ id, model, status: 'done', mode: 'agent', ...extra })

test('a usage costs tokens times price per million', () => {
  near(usageCost(U, PRECOS.modelos.sonnet), 2 + 10 + 0.1 + 4)
  near(usageCost({ input: 500, output: 0, cacheRead: 0, cacheWrite: 0 }, PRECOS.modelos.opus), 0.002)
})

test('run cost sums the steps and saves against the strong tier', () => {
  const c = runCost({ steps: [st('a', 'haiku', { usage: U }), st('b', 'sonnet', { usage: U }), st('c', 'opus', { usage: U })] }, PRECOS)
  near(c.total, 0.81 + 16.1 + 32.2)
  near(c.saving, 32.2 * 3 - (0.81 + 16.1 + 32.2))
  assert.equal(c.unpriced, 0)
  assert.equal(c.strong, 'opus')
})

test('run cost leaves out inline, skipped and usage-less steps, and says how many are inline', () => {
  const c = runCost(
    { steps: [st('a', 'sonnet', { usage: U }), st('b', 'sonnet', { mode: 'inline' }), st('c', 'sonnet', { status: 'skipped', usage: U }), st('d', 'sonnet', { status: 'pending' })] },
    PRECOS,
  )
  assert.equal(c.steps.length, 1)
  assert.equal(c.inline, 1)
  near(c.total, 16.1)
})

test('a model without a complete price counts tokens but not money', () => {
  const precos = { modelos: { ...PRECOS.modelos, sonnet: { entrada: 2, saida: 'x', leituraCache: 0.1, escritaCache: 4 }, haiku: undefined } }
  assert.equal(priceOf(precos, 'sonnet'), null)
  assert.equal(priceOf(precos, 'haiku'), null)
  const c = runCost({ steps: [st('a', 'sonnet', { usage: U }), st('b', 'haiku', { usage: U }), st('c', 'opus', { usage: U })] }, precos)
  assert.equal(c.unpriced, 2)
  assert.equal(c.steps[0].cost, null)
  assert.equal(c.tokens, 12_000_000)
  near(c.total, 32.2)
  near(c.saving, 0)
})

test('without precos every step is unpriced and the saving unavailable', () => {
  for (const precos of [undefined, null, {}]) {
    const c = runCost({ steps: [st('a', 'opus', { usage: U })] }, precos)
    assert.equal(c.unpriced, 1)
    assert.equal(c.total, 0)
    assert.equal(c.saving, null)
    assert.equal(c.tokens, 4_000_000)
  }
})

test('a usage missing a counter or carrying a bad one never makes the total NaN', () => {
  const partial = { input: 1_000_000, output: 1_000_000 } // the API may leave the cache counters out
  const bad = { input: Number.NaN, output: -5, cacheRead: 'x', cacheWrite: 1_000_000 }
  near(usageCost(partial, PRECOS.modelos.sonnet), 12)
  const c = runCost({ steps: [st('a', 'sonnet', { usage: partial }), st('b', 'sonnet', { usage: bad })] }, PRECOS)
  assert.ok(Number.isFinite(c.total) && Number.isFinite(c.saving) && Number.isFinite(c.tokens))
  near(c.total, 12 + 4)
  assert.equal(c.tokens, 3_000_000)
})

test('the strong tier comes from the caller and, unpriced, makes the saving null', () => {
  const steps = [st('a', 'haiku', { usage: U })]
  near(runCost({ steps }, PRECOS, 'sonnet').saving, 16.1 - 0.81)
  const semOpus = { modelos: { haiku: PRECOS.modelos.haiku } }
  const c = runCost({ steps }, semOpus)
  assert.equal(c.saving, null)
  near(c.total, 0.81)
})
