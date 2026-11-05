// Mini Ultron for the terminal: 10×10 pixels drawn as 5 rows of half blocks
// ('▀' painted top pixel in the foreground, bottom pixel in the background).
export type Pose = 'idle' | 'walk' | 'work' | 'win' | 'fail' | 'wait'

export const PALETTE: Record<string, string> = {
  K: '#1b1f29',
  S: '#c9d1dc',
  L: '#f1f4f8',
  D: '#7b8594',
  R: '#e1263b',
  E: '#ff4d3d',
  Y: '#ffe08a',
  G: '#4b5262',
  V: '#2b0e16',
}

// Capacete com crista, visor escuro, grade na boca; ombreiras e núcleo no peito.
const HEAD = ['...KRrK...', '..KSRrSK..', '.KLSSSSDK.', '.KEYVVYEK.', '.KDSDDSDK.', '..KKDDKK..']
const BODY = ['KRRSYYSRRK', 'KSDKRRKDSK']
const ARMS_UP = ['RRKSYYSKRR', '.SDKRRKDS.']
const LEGS = {
  stand: ['..KSDDSK..', '.KKK..KKK.'],
  walkA: ['.KSD..DSK.', 'KKK....KKK'],
  walkB: ['...KSSK...', '..KKKKKK..'],
}

const swap = (rows: string[], from: string, to: string) => rows.map(r => r.split(from).join(to))

export function pixels(pose: Pose, frame: number): string[] {
  let head = HEAD
  if (pose === 'fail') head = swap(swap(HEAD, 'E', 'G'), 'Y', 'G')
  else if (pose === 'win') head = swap(HEAD, 'E', 'Y')
  else if (frame % 9 === 8) head = swap(swap(HEAD, 'E', 'V'), 'Y', 'V')
  if (pose === 'win' && frame % 2 === 0) head = [head[0]!, head[1]!, head[2]!, head[3]!, head[4]!, 'K.KKDDKK.K']
  let body = pose === 'win' && frame % 2 === 0 ? ARMS_UP : BODY
  if (pose === 'work' && frame % 2 === 1) body = swap(body, 'Y', 'L')
  const legs = pose === 'walk' ? (frame % 2 ? LEGS.walkA : LEGS.walkB) : LEGS.stand
  return [...head, ...body, ...legs]
}

export type Cell = { ch: string; fg?: string; bg?: string }

/** Pixel rows folded into text rows of half-block cells, runs of one style merged. */
export function cells(pose: Pose, frame: number): Cell[][] {
  const px = pixels(pose, frame)
  const rows: Cell[][] = []
  for (let y = 0; y < px.length; y += 2) {
    const top = px[y]!
    const bottom = px[y + 1] ?? ''
    const row: Cell[] = []
    for (let x = 0; x < top.length; x++) {
      const t = PALETTE[top[x]!]
      const b = PALETTE[bottom[x] ?? '.']
      const cell: Cell = t && b ? { ch: '▀', fg: t, bg: b } : t ? { ch: '▀', fg: t } : b ? { ch: '▄', fg: b } : { ch: ' ' }
      const last = row[row.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg && (last.ch[0] === cell.ch || (cell.ch === ' ' && !last.fg))) last.ch += cell.ch
      else row.push(cell)
    }
    rows.push(row)
  }
  return rows
}

/** A small effect beside the sprite, per pose. */
export function spark(pose: Pose, frame: number): string {
  switch (pose) {
    case 'work':
      return ['⚡', ' ✦', '⚡', ' ·'][frame % 4]!
    case 'win':
      return frame % 2 ? '✨' : '🏁'
    case 'fail':
      return ['~', ' ~', '  ~'][frame % 3]!
    case 'wait':
      return frame % 2 ? ' ?' : '? '
    default:
      return '  '
  }
}
