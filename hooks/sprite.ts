// Ultron for the terminal, after the comics: silver chrome lit from the left,
// a domed head with a bright ridge and side fins, angry slanted red eyes, a
// toothed red grin and a red core on the chest. 16×20 pixels drawn as 10 rows
// of half blocks ('▀': top pixel in the foreground, bottom in the background).
export type Pose = 'idle' | 'walk' | 'work' | 'win' | 'fail' | 'wait'

export const PALETTE: Record<string, string> = {
  K: '#0c0e12', // contorno
  D: '#3d434d', // aço escuro
  N: '#6b7380', // prata escura
  M: '#9aa3b0', // prata
  L: '#cdd4de', // prata clara
  H: '#f4f7fb', // brilho
  R: '#e3241c', // vermelho
  r: '#7a100c', // vermelho escuro (dentes, base do núcleo)
  E: '#ffd0c0', // núcleo do olho e do peito
  G: '#4b4b52', // apagado
  Y: '#ffe27a', // olho em brasa
}

const W = 16

/** Sets single pixels over a copy of the rows: [y, x, colour]. */
function put(rows: string[], points: [number, number, string][]): string[] {
  const out = rows.map(r => r.split(''))
  for (const [y, x, c] of points) if (out[y] && x >= 0 && x < W) out[y]![x] = c
  return out.map(r => r.join(''))
}

// The head: a dome with a bright ridge down the middle, fins on both sides,
// eyes that slant down to the nose, a toothed grin narrowing to the chin.
const HEAD = [
  '......KKKK......',
  '....KKLHHLKK....',
  '...KLMLHHLMNK...',
  '..KLMMLHHLMMNK..',
  '..KMMMMLLMMMNK..',
  '.KNKDDMMMMDDKNK.',
  '.KNKREDMMDERKNK.',
  '.KNKDRRDDRRDKNK.',
  '..KMMDDDDDDNNK..',
  '..KMDRrRrRrDNK..',
  '...KMDRRRRDNK...',
  '...KKKKDDKKKK...',
]

// The body on a fixed grid: arm (cols 1-2), outline, chest (cols 4-11), outline, arm (cols 13-14).
const LEFT_ARM = ['.KLK', 'KLMK', 'KMNK', 'KLNK', 'KHLK']
const RIGHT_ARM = ['KNK.', 'KMDK', 'KNDK', 'KNDK', 'KLMK']
const CHEST = ['MLLMMMNN', 'LMDRRDMN', 'LMRERRMN', 'MMDrrDND', 'DMMMMNND']
const BODY = CHEST.map((c, i) => LEFT_ARM[i] + c + RIGHT_ARM[i])
const HIPS = '.KK.KDNKKNDK.KK.'

const LEGS = {
  stand: ['...KDMK..KNDK...', '..KKKKK..KKKKK..'],
  stride: ['..KDMK....KNDK..', '.KKKKK....KKKKK.'],
  together: ['....KDMKKNDK....', '...KKKKKKKKKK...'],
  tap: ['...KDMK..KKKKK..', '..KKKKK.........'],
}

const figure = (legs: string[], body = BODY, hips = HIPS) => [...HEAD, ...body, hips, ...legs]

const IDLE = figure(LEGS.stand)

/** The right arm thrown up beside the head, claw first, as in the comics. */
function armUp(rows: string[], isOpen: boolean): string[] {
  const out = rows.map(r => r.split(''))
  const set = (y: number, x: number, c: string) => {
    if (out[y] && x >= 0 && x < W) out[y]![x] = c
  }
  // The hanging arm goes; the chest keeps its outline.
  for (let y = 13; y <= 16; y++) {
    set(y, 12, 'K')
    for (let x = 13; x < W; x++) set(y, x, '.')
  }
  for (let x = 12; x < W; x++) set(17, x, '.')
  // Upper arm and forearm, lit on the left; the shoulder joins the chest.
  for (let y = 3; y <= 12; y++) {
    set(y, 13, 'K')
    set(y, 14, y === 8 ? 'M' : 'L')
    set(y, 15, y === 8 ? 'N' : 'M')
  }
  set(11, 12, 'K')
  set(12, 12, 'K')
  set(12, 13, 'M')
  set(3, 14, 'H')
  if (isOpen) {
    set(2, 13, 'L')
    set(2, 14, 'K')
    set(2, 15, 'L')
    set(1, 13, 'H')
    set(1, 15, 'H')
  } else {
    set(1, 13, 'K')
    set(1, 14, 'K')
    set(1, 15, 'K')
    set(2, 13, 'K')
    set(2, 14, 'H')
    set(2, 15, 'L')
  }
  return out.map(r => r.join(''))
}

/** Arms crossed over the chest: waiting on a person. The core still shows above them. */
const CROSSED_BODY = [
  '.KLK' + CHEST[0] + 'KNK.',
  'KLMK' + CHEST[1] + 'KMDK',
  'KMLLLLLLLLLLLMDK',
  '.KMMHMMMMMMHMNK.',
  '..KKDMMMMNNDKK..',
]
const CROSSED_HIPS = '....KDNKKNDK....'

/** Eyes ablaze: the glow fills the slant. */
const BLAZE: [number, number, string][] = [
  [6, 4, 'Y'], [6, 5, 'H'], [6, 10, 'H'], [6, 11, 'Y'],
  [7, 5, 'Y'], [7, 6, 'R'], [7, 9, 'R'], [7, 10, 'Y'],
  [14, 7, 'H'],
]

/** Switched off: grey eyes, a dark grin and a dead core. */
const FAIL = IDLE.map((r, y) => {
  if (y === 6 || y === 7) return r.replace(/[RE]/g, 'G')
  if (y === 9 || y === 10) return r.replace(/R/g, 'D').replace(/r/g, 'K')
  if (y >= 13 && y <= 15) return r.replace(/[RE]/g, 'G').replace(/r/g, 'D')
  return r
})
export const ART = {
  palette: PALETTE,
  frames: {
    idle: IDLE,
    walkA: figure(LEGS.stride),
    walkB: figure(LEGS.together),
    workA: armUp(IDLE, false),
    workB: armUp(IDLE, true),
    waitA: figure(LEGS.stand, CROSSED_BODY, CROSSED_HIPS),
    waitB: figure(LEGS.tap, CROSSED_BODY, CROSSED_HIPS),
    winA: armUp(figure(LEGS.stride), true),
    winB: put(armUp(figure(LEGS.stride), false), BLAZE),
    fail: FAIL,
  } as Record<string, string[]>,
}

const BLINK_EVERY = 9
/** The rows that hold the eyes. */
const EYES = [6, 7]

/** The pose's 20 pixel rows at this frame. */
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
  if (pose !== 'fail' && frame % BLINK_EVERY === BLINK_EVERY - 1) rows = rows.map((r, y) => (EYES.includes(y) ? r.replace(/[REY]/g, 'D') : r))
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
