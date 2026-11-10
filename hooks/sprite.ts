// Ultron for the terminal, after the comics: silver chrome, red eyes and
// mouth, domed head with fins and a ridge. 12×16 pixels drawn as 8 rows of
// half blocks ('▀': top pixel in the foreground, bottom in the background).
export type Pose = 'idle' | 'walk' | 'work' | 'win' | 'fail' | 'wait'

export const PALETTE: Record<string, string> = {
  K: '#0c0e12', // contorno
  D: '#3d434d', // aço escuro
  N: '#6b7380', // prata escura
  M: '#9aa3b0', // prata
  L: '#cdd4de', // prata clara
  H: '#f4f7fb', // brilho
  R: '#e3241c', // vermelho
  r: '#7a100c', // dentes
  E: '#ffb3a0', // núcleo do olho
  G: '#4b4b52', // olho apagado
  F: '#ff8c2a', // propulsão
  Y: '#ffe27a', // núcleo da propulsão
}

const W = 12

/** Sets single pixels over a copy of the rows: [y, x, colour]. */
function put(rows: string[], points: [number, number, string][]): string[] {
  const out = rows.map(r => r.split(''))
  for (const [y, x, c] of points) if (out[y] && x >= 0 && x < W) out[y]![x] = c
  return out.map(r => r.join(''))
}

const mirror = (points: [number, number, string][]): [number, number, string][] => points.flatMap(([y, x, c]) => [[y, x, c], [y, W - 1 - x, c]] as [number, number, string][])

// Chibi Ultron, after a pixel-art reference: a big domed head with a ridge,
// side fins, red slanted eyes, red cheek lines and a glowing mouth, over a
// compact armoured body with red marks on the chest and a segmented belly.
const BASE = [
  '...KKKKKK...',
  '..KLRMMRLK..',
  'K.KLLRRLLK.K',
  'KKLLMDDMLLKK',
  'K.KERMMREK.K',
  'K.KMRLLRMK.K',
  '.KKRDMMDRKK.',
  '..KDRRRRDK..',
  '.KLLKMMKLLK.',
  'KLMDDLLDDMLK',
  'KMKRRMMRRKMK',
  'KLKMRDDRMKLK',
  'KMKDMDDMDKMK',
  'KKKKDMMDKKKK',
  '..KDMKKMDK..',
  '.KKKK..KKKK.',
]

const withLegs = (legs: [string, string]) => [...BASE.slice(0, 14), ...legs]

const IDLE = BASE

/** The right arm raised high, as in the comics. */
const ARM_UP: [number, number, string][] = [
  [10, 10, '.'], [10, 11, '.'], [11, 10, '.'], [11, 11, '.'], [12, 10, '.'], [12, 11, '.'], [13, 10, '.'], [13, 11, '.'],
  [10, 9, 'K'], [11, 9, 'K'], [12, 9, 'K'], [13, 9, 'K'],
  [8, 10, 'L'], [8, 11, 'K'], [7, 10, 'M'], [7, 11, 'L'], [6, 10, 'M'], [6, 11, 'L'], [5, 10, 'M'], [5, 11, 'L'], [4, 10, 'M'], [4, 11, 'L'], [3, 10, 'K'], [3, 11, 'L'],
]
const CLAW = put(IDLE, ARM_UP)
const CLAW_SHUT = put(CLAW, [[2, 10, 'L'], [2, 11, 'H']])
const CLAW_OPEN = put(CLAW, [[2, 10, 'H'], [1, 10, 'L'], [1, 11, 'H'], [2, 11, 'L']])

/** Arms crossed: waiting on a person. */
const CROSSED = [...BASE.slice(0, 10), 'KMLLLLLLLLMK', '.KMMHMMHMMK.', '..KDMDDMDK..', '..KKDMMDKK..', ...BASE.slice(14)]
const TAP = [...CROSSED.slice(0, 14), '..KDMKK.....', '.KKKK..KDMK.']

/** The closing stance from the card: legs apart, one claw thrown up, eyes ablaze. */
const STANCE = [...CLAW.slice(0, 14), '.KDMK..KMDK.', 'KKKK....KKKK']
const STANCE_A = put(STANCE, [[2, 10, 'L'], [1, 11, 'H'], [2, 11, 'L']])
const STANCE_B = put(STANCE, [[2, 10, 'H'], [1, 10, 'L'], [1, 11, 'H'], [4, 3, 'Y'], [4, 8, 'Y'], [7, 4, 'E'], [7, 7, 'E']])

const FAIL = put(IDLE, [[1, 4, 'G'], [1, 7, 'G'], [2, 5, 'G'], [2, 6, 'G'], [4, 3, 'G'], [4, 4, 'G'], [4, 7, 'G'], [4, 8, 'G'], [5, 4, 'G'], [5, 7, 'G'], [6, 3, 'G'], [6, 8, 'G'], [7, 4, 'G'], [7, 5, 'D'], [7, 6, 'D'], [7, 7, 'G'], [10, 3, 'G'], [10, 4, 'G'], [10, 7, 'G'], [10, 8, 'G'], [11, 4, 'G'], [11, 7, 'G']])

export const ART = {
  palette: PALETTE,
  frames: {
    idle: IDLE,
    walkA: withLegs(['.KDMK..KMDK.', 'KKKK....KKKK']),
    walkB: withLegs(['...KDMMDK...', '..KKKKKKKK..']),
    workA: CLAW_SHUT,
    workB: CLAW_OPEN,
    waitA: CROSSED,
    waitB: TAP,
    winA: STANCE_A,
    winB: STANCE_B,
    fail: FAIL,
  } as Record<string, string[]>,
}

const BLINK_EVERY = 9

/** The pose's 16 pixel rows at this frame. */
export function pixels(pose: Pose, frame: number): string[] {
  const odd = frame % 2 === 1
  const f = ART.frames
  let rows: string[]
  switch (pose) {
    case 'walk':
      rows = odd ? f.walkA! : f.walkB!
      break
    case 'work':
      rows = odd ? f.workB! : f.workA!
      break
    case 'wait':
      rows = frame % 4 === 3 ? f.waitB! : f.waitA!
      break
    case 'win':
      rows = odd ? f.winB! : f.winA!
      break
    case 'fail':
      rows = f.fail!
      break
    default:
      rows = f.idle!
  }
  if (pose !== 'fail' && frame % BLINK_EVERY === BLINK_EVERY - 1) rows = rows.map((r, y) => (y === 4 || y === 5 ? r.replace(/[RE]/g, 'M') : r))
  return rows
}

export type Cell = { ch: string; fg?: string; bg?: string }

/** Pixel rows folded into text rows of half-block cells, runs of one style merged. */
export function cells(pose: Pose, frame: number): Cell[][] {
  const px = pixels(pose, frame)
  const out: Cell[][] = []
  for (let y = 0; y < px.length; y += 2) {
    const top = px[y]!
    const bottom = px[y + 1] ?? ''
    const row: Cell[] = []
    for (let x = 0; x < top.length; x++) {
      const t = PALETTE[top[x]!]
      const b = PALETTE[bottom[x] ?? '.']
      const cell: Cell = t && b ? { ch: '▀', fg: t, bg: b } : t ? { ch: '▀', fg: t } : b ? { ch: '▄', fg: b } : { ch: ' ' }
      const last = row[row.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.ch[0] === cell.ch) last.ch += cell.ch
      else row.push(cell)
    }
    out.push(row)
  }
  return out
}

/** A small effect beside the sprite, per pose. */
export function spark(pose: Pose, frame: number): string {
  switch (pose) {
    case 'work':
      return ['⚡', ' ✦', '⚡', ' ·'][frame % 4]!
    case 'win':
      return ['✦ ', ' ✧', '✦ ', ' ·'][frame % 4]!
    case 'fail':
      return ['~', ' ~', '  ~'][frame % 3]!
    case 'wait':
      return frame % 2 ? ' ?' : '? '
    default:
      return '  '
  }
}
