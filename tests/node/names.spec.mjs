// node --test tests/node — Marvel AI names per repository, and Ultron's lines.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const HOME = mkdtempSync(join(tmpdir(), 'ultron-names-'))
process.env.ULTRON_HOME = HOME
const { AIS, NO_REPO_COLOR, assign, folderKey, nameSessions } = await import('../../bin/lib/names.mjs')
const { LINES, lineFor, momentOf } = await import('../../core/quotes.ts')

after(() => rmSync(HOME, { recursive: true, force: true }))

const file = name => join(HOME, `${name}.json`)
const first = () => 0 // always the first free name, so tests are exact

test('each open repo gets its own AI, kept while it stays open', () => {
  const f = file('a')
  const one = assign(['acme/api', 'acme/web'], { file: f, random: first })
  assert.equal(one['acme/api'].name, AIS[0].name)
  assert.equal(one['acme/web'].name, AIS[1].name)
  assert.equal(one['acme/web'].color, AIS[1].color)
  const two = assign(['acme/api', 'acme/web'], { file: f, random: () => 0.99 })
  assert.equal(two['acme/api'].name, AIS[0].name, 'an open repo keeps its name')
})

test('a repo whose last session closed frees its name, and comes back with another', () => {
  const f = file('b')
  assign(['acme/api'], { file: f, random: first })
  assert.deepEqual(assign([], { file: f, random: first }), {})
  const saved = JSON.parse(readFileSync(f, 'utf8'))
  assert.equal(saved.last['acme/api'], AIS[0].name)
  const back = assign(['acme/api'], { file: f, random: first })
  assert.notEqual(back['acme/api'].name, AIS[0].name)
})

test('when every name is out, one comes back with a numeral', () => {
  const f = file('c')
  const keys = Array.from({ length: AIS.length + 1 }, (_, i) => `org/r${i}`)
  const all = assign(keys, { file: f, random: first })
  const names = Object.values(all).map(a => a.name)
  assert.equal(new Set(names).size, keys.length)
  assert.ok(names.some(n => / II$/.test(n)))
})

test('sessions carry their repo AI, numbered when the repo has several; a closed one carries none', () => {
  const infos = {
    s1: { repo: { key: 'acme/api', name: 'acme/api', root: '/a' } },
    s2: { repo: { key: 'acme/api', name: 'acme/api', root: '/a' } },
    s4: { repo: { key: 'acme/web', name: 'acme/web', root: '/w' } },
  }
  const cards = [
    { sessionId: 's1', isAlive: true, startedAt: 1 },
    { sessionId: 's2', isAlive: true, startedAt: 2 },
    { sessionId: 's4', isAlive: false, startedAt: 4 },
  ]
  const named = Object.fromEntries(nameSessions(cards, sid => infos[sid], { file: file('d'), random: first }).map(c => [c.sessionId, c]))
  assert.equal(named.s1.ai.label, `${AIS[0].name} · 1`)
  assert.equal(named.s2.ai.label, `${AIS[0].name} · 2`)
  assert.equal(named.s2.repo.name, 'acme/api')
  assert.equal(named.s2.noRepo, false)
  assert.equal(named.s4.ai, null, 'a closed session loses its name')
  assert.equal(named.s4.color, NO_REPO_COLOR)
  assert.equal(named.s4.repo.name, 'acme/web')
})

test('a session outside a repository gets an AI of its folder, flagged noRepo; the same folder shares it', () => {
  const infos = {
    a: { repo: { key: 'acme/api', name: 'acme/api', root: '/a' }, cwd: 'C:/a' },
    h1: { repo: null, cwd: 'C:/Users/Ana' },
    h2: { repo: null, cwd: 'c:\\users\\ana\\' },
    t: { repo: null, cwd: 'C:/tmp' },
    gone: { repo: null, cwd: 'C:/old' },
  }
  const cards = [
    { sessionId: 'a', isAlive: true, startedAt: 1 },
    { sessionId: 'h1', isAlive: true, startedAt: 2 },
    { sessionId: 'h2', isAlive: true, startedAt: 3 },
    { sessionId: 't', isAlive: true, startedAt: 4 },
    { sessionId: 'gone', isAlive: false, startedAt: 5 },
  ]
  const f = file('e')
  const named = Object.fromEntries(nameSessions(cards, sid => infos[sid], { file: f, random: first }).map(c => [c.sessionId, c]))
  assert.equal(named.h1.repo, null)
  assert.equal(named.h1.noRepo, true)
  assert.ok(named.h1.ai, 'a repo-less session has an AI too')
  assert.equal(named.h1.ai.name, named.h2.ai.name, 'the same folder, however written, shares the AI')
  assert.equal(named.h2.ai.label, `${named.h1.ai.name} · 2`)
  assert.notEqual(named.t.ai.name, named.h1.ai.name, 'another folder, another AI')
  const all = [named.a, named.h1, named.t].map(c => c.ai.name)
  assert.equal(new Set(all).size, 3, 'repos and folders never share a name')
  assert.equal(named.gone.ai, null)
  assert.equal(named.gone.noRepo, true)
  const saved = JSON.parse(readFileSync(f, 'utf8'))
  assert.ok(saved.repos[folderKey('C:/Users/Ana')], 'the folder AI is kept in names.json under pasta:<folder>')
})

test('Ultron says something for every moment, and "tudo sob controle" at the end', () => {
  const run = (status, steps = []) => ({ revision: 1, status, steps })
  assert.equal(momentOf(null), 'none')
  assert.equal(momentOf(run('awaiting_approval')), 'wait')
  assert.equal(momentOf(run('running', [{ id: 'a', status: 'running' }])), 'work')
  assert.equal(momentOf(run('running', [{ id: 'a', status: 'done' }]), true), 'walk')
  assert.equal(momentOf(run('running', [{ id: 'a', status: 'failed' }])), 'fail')
  assert.equal(momentOf(run('done')), 'win')
  for (const lines of Object.values(LINES)) assert.ok(lines.length > 0)
  for (const t of [0, 8000, 16000, 24000]) assert.match(lineFor(run('done'), 'win', t), /[Tt]udo sob controle/)
  const r = run('running', [{ id: 'a', status: 'running' }])
  assert.equal(lineFor(r, 'work', 1000), lineFor(r, 'work', 7000), 'the line holds within its slot')
  assert.ok(LINES.work.includes(lineFor(r, 'work', 1000)))
})
