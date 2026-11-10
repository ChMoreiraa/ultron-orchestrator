// A Marvel AI's name and hologram colour for each repository with an open
// session, and for each folder outside a repository that has one (keyed
// `pasta:<folder>`, from the same pool, so no two share a name). The name
// holds while a session is open there; when the last one closes the name goes
// back to the pool, and next time it gets another one (never the one it just
// had). Written only by the dashboard server, in names.json; the mod reads it
// to show the name in its pane.
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

/** A closed session, or one with no folder: no AI name, this colour. */
export const NO_REPO_COLOR = '#8a93a6'

/** The names.json key of a folder outside any repository (the mod computes the same). */
export const folderKey = cwd => `pasta:${String(cwd).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`

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
 * Adds `repo`, `noRepo` and `ai` to each session card: an open session carries
 * the AI of its repo, or of its folder when it runs outside one (numbered when
 * several are open there); a closed one carries none.
 */
export function nameSessions(cards, readInfo, options) {
  const withKey = cards.map(c => {
    const info = readInfo(c.sessionId)
    const repo = repoOf(info)
    const cwd = info?.cwd ?? c.cwd
    return { card: c, repo, key: repo ? repo.key : cwd ? folderKey(cwd) : null }
  })
  const openKeys = [...new Set(withKey.filter(x => x.card.isAlive && x.key).map(x => x.key))]
  const repos = assign(openKeys, options)
  const byKey = new Map()
  for (const x of withKey) {
    if (!x.card.isAlive || !x.key) continue
    const list = byKey.get(x.key) ?? []
    list.push(x.card)
    byKey.set(x.key, list)
  }
  for (const list of byKey.values()) list.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  return withKey.map(({ card, repo, key }) => {
    const a = key && card.isAlive ? repos[key] : null
    const siblings = key ? byKey.get(key) ?? [] : []
    const index = siblings.indexOf(card) + 1
    return {
      ...card,
      repo,
      noRepo: !repo,
      ai: a ? { name: a.name, color: a.color, index, count: siblings.length, label: siblings.length > 1 ? `${a.name} · ${index}` : a.name } : null,
      color: a ? a.color : NO_REPO_COLOR,
    }
  })
}
