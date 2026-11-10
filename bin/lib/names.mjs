// A Marvel AI's name and hologram colour for each repository with an open
// session. The name holds while the repo has a session open; when its last
// session closes the name goes back to the pool, and next time the repo gets
// another one (never the one it just had). Written only by the dashboard
// server, in names.json; the mod reads it to show the name in its pane.
import { join } from 'node:path'

import { HOME, readJson, writeJsonAtomic } from './store.mjs'

export const AIS = [
  { name: 'JARVIS', color: '#4db8ff' },
  { name: 'F.R.I.D.A.Y.', color: '#ffa53d' },
  { name: 'E.D.I.T.H.', color: '#5fe39b' },
  { name: 'Jocasta', color: '#ff6fae' },
  { name: 'Visão', color: '#f2c94c' },
  { name: 'Karen', color: '#b48cff' },
  { name: 'H.O.M.E.R.', color: '#3fd1c7' },
  { name: 'AIDA', color: '#ff7a6b' },
  { name: 'Veronica', color: '#a6e35a' },
  { name: 'Dum-E', color: '#9fb3c8' },
]

/** An open session outside any repository: no AI name, this colour. */
export const NO_REPO_COLOR = '#8a93a6'

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X']

export const NAMES_FILE = join(HOME, 'names.json')

/** The repository a session runs in, as the mod registered it; null outside one. */
export function repoOf(info) {
  const r = info?.repo
  return r && typeof r.key === 'string' && r.key ? { key: r.key, name: String(r.name || r.key), root: r.root ?? null } : null
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)]
}

/**
 * Gives every repo with an open session its AI, frees the names of repos
 * with none, and returns the assignments. `random` is injectable for tests.
 */
export function assign(openRepoKeys, { file = NAMES_FILE, random = Math.random } = {}) {
  const held = readJson(file, { repos: {}, last: {} })
  const repos = { ...(held.repos ?? {}) }
  const last = { ...(held.last ?? {}) }
  let isChanged = false
  const open = new Set(openRepoKeys)
  for (const key of Object.keys(repos)) {
    if (open.has(key)) continue
    last[key] = repos[key].name
    delete repos[key]
    isChanged = true
  }
  for (const key of open) {
    if (repos[key]) continue
    const taken = new Set(Object.values(repos).map(a => a.name))
    const free = AIS.filter(ai => !taken.has(ai.name) && ai.name !== last[key])
    let chosen
    if (free.length) chosen = { ...pick(free, random) }
    else {
      // Every name is out: the same AI again, with a numeral (JARVIS II).
      const base = pick(AIS.filter(ai => ai.name !== last[key]), random)
      const suffix = ROMAN.slice(1).find(s => !taken.has(base.name + s)) ?? ` ${taken.size}`
      chosen = { name: base.name + suffix, color: base.color }
    }
    repos[key] = { ...chosen, since: Date.now() }
    isChanged = true
  }
  if (isChanged) writeJsonAtomic(file, { repos, last })
  return repos
}

/**
 * Adds `repo` and `ai` to each session card: open sessions in a repo carry
 * its AI (with a number when the repo has several open), the rest none.
 */
export function nameSessions(cards, readInfo, options) {
  const withRepo = cards.map(c => ({ card: c, repo: repoOf(readInfo(c.sessionId)) }))
  const openKeys = [...new Set(withRepo.filter(x => x.card.isAlive && x.repo).map(x => x.repo.key))]
  const repos = assign(openKeys, options)
  const byRepo = new Map()
  for (const x of withRepo) {
    if (!x.card.isAlive || !x.repo) continue
    const list = byRepo.get(x.repo.key) ?? []
    list.push(x.card)
    byRepo.set(x.repo.key, list)
  }
  for (const list of byRepo.values()) list.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  return withRepo.map(({ card, repo }) => {
    const a = repo && card.isAlive ? repos[repo.key] : null
    const siblings = repo ? byRepo.get(repo.key) ?? [] : []
    const index = siblings.indexOf(card) + 1
    return {
      ...card,
      repo,
      ai: a ? { name: a.name, color: a.color, index, count: siblings.length, label: siblings.length > 1 ? `${a.name} · ${index}` : a.name } : null,
      color: a ? a.color : NO_REPO_COLOR,
    }
  })
}
