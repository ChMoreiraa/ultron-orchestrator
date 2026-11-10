// Ultron em pixel art (32×32), no visual dos quadrinhos: corpo humanoide de
// armadura prateada e uma cabeça desenhada pixel a pixel (oval, crista
// central que desce até o nariz, aletas nas têmporas presas à mandíbula,
// olhos em fenda sob sobrancelhas inclinadas, sorriso em U com dentes).
// Cada parte do corpo é pintada na sua camada, sombreada com luz do alto à
// esquerda e carimbada com um traço escuro onde cobre a parte de trás.
export const PALETTE = {
  K: '#0b0d11', // contorno
  D: '#2f343d', // aço profundo
  N: '#58606c', // prata escura
  M: '#8e97a5', // prata
  L: '#c4cbd6', // prata clara
  H: '#f2f5fa', // brilho
  R: '#ff2b1f', // vermelho incandescente
  r: '#8e130e', // vermelho escuro
  E: '#ffd9cc', // núcleo do olho
  G: '#4b4b52', // olho apagado
  Y: '#ffe27a', // olho em brasa
  S: '#ffe08a', // faísca
}

const SIZE = 32
const CX = 15 // the figure is symmetric about column 15
const mx = x => 2 * CX - x // mirror a column

// ---------------------------------------------------------------- drawing on a grid

const blank = () => Array.from({ length: SIZE }, () => Array(SIZE).fill('.'))
const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE
const set = (g, x, y, c) => {
  if (inside(x, y)) g[y][x] = c
}
const both = (g, x, y, c) => {
  set(g, x, y, c)
  set(g, mx(x), y, c)
}
/** Recolours a pixel only where the part already has metal. */
const mark = (g, x, y, c) => {
  if (inside(x, y) && g[y][x] !== '.') g[y][x] = c
}

/** A thick segment from (x0,y0) to (x1,y1), as a round brush of radius `r`. */
function limb(g, x0, y0, x1, y1, r = 1, c = 'M') {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / steps)
    const y = Math.round(y0 + ((y1 - y0) * i) / steps)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.6) set(g, x + dx, y + dy, c)
  }
}

const disc = (g, x, y, r, c = 'M') => limb(g, x, y, x, y, r, c)

/** A shape symmetric about the centre column, given its half-width per row. */
function rows(g, top, halves, c = 'M') {
  halves.forEach((w, i) => {
    for (let x = CX - w; x <= CX + w; x++) set(g, x, top + i, c)
  })
}

/** A dark seam across a limb: perpendicular to (ux,uy) at (x,y). */
function seam(g, x, y, ux, uy, r, c = 'D') {
  for (let k = -r; k <= r; k++) mark(g, Math.round(x - uy * k), Math.round(y + ux * k), c)
}

const LIGHTER = { D: 'N', N: 'M', M: 'L', L: 'H', H: 'H' }
const DARKER = { H: 'L', L: 'M', M: 'N', N: 'D', D: 'D' }

/**
 * Brushed steel lit from the upper left: each horizontal run gets a rim of
 * light, a bright band, the body tone and a shadow side; top edges catch the
 * light and bottom edges fall into shade, which rounds the forms.
 */
function shade(p) {
  const src = p.map(r => [...r])
  for (let y = 0; y < SIZE; y++) {
    let x = 0
    while (x < SIZE) {
      if (src[y][x] !== 'M') {
        x++
        continue
      }
      let end = x
      while (end < SIZE && src[y][end] === 'M') end++
      const len = end - x
      for (let i = x; i < end; i++) {
        const t = (i - x) / Math.max(1, len - 1)
        let c
        if (len < 3) c = t < 0.5 ? 'L' : 'N'
        else if (len < 6) c = t < 0.3 ? 'L' : t < 0.7 ? 'M' : 'N'
        else c = t < 0.07 ? 'L' : t < 0.24 ? 'H' : t < 0.4 ? 'L' : t < 0.68 ? 'M' : t < 0.88 ? 'N' : 'D'
        p[y][i] = c
      }
      x = end
    }
  }
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (src[y][x] !== 'M') continue
      if (src[y - 1]?.[x] !== 'M') p[y][x] = LIGHTER[p[y][x]] ?? p[y][x]
      else if (src[y + 1]?.[x] !== 'M') p[y][x] = DARKER[p[y][x]] ?? p[y][x]
    }
  return p
}

/** Steel shaded by column across a whole part, so wide forms read as one surface. */
function shadeAcross(p, x0, x1) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (p[y][x] !== 'M') continue
      const t = (x - x0) / (x1 - x0)
      let c = t < 0.1 ? 'L' : t < 0.3 ? 'H' : t < 0.45 ? 'L' : t < 0.7 ? 'M' : t < 0.88 ? 'N' : 'D'
      if (p[y - 1]?.[x] === '.') c = LIGHTER[c]
      p[y][x] = c
    }
  return p
}

/** Lays a part over the figure, with a dark seam where it covers what is behind. */
function stamp(g, p) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (p[y][x] === '.') continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (inside(nx, ny) && p[ny][nx] === '.' && g[ny][nx] !== '.') g[ny][nx] = 'K'
      }
    }
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (p[y][x] !== '.') g[y][x] = p[y][x]
}

/** Every empty pixel touching the figure becomes its outline. */
function outline(g) {
  const out = g.map(r => [...r])
  const isFigure = c => c && c !== '.' && c !== 'S'
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (g[y][x] !== '.') continue
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isFigure(g[y + dy]?.[x + dx]))) out[y][x] = 'K'
    }
  return out
}

// ---------------------------------------------------------------- the head, by hand

// 15 columns, centred on the ridge. Fins on columns 1 and 13, joined to the
// jaw at the mouth line; the gap between fin and skull becomes outline.
const HEAD = [
  '.....LMHDN.....',
  '....LLLHDNN....',
  '.L.LLLMHDNNN.N.',
  '.L.LDDMHMDDN.N.',
  '.L.LRRDHDRRN.N.',
  '.L.MLMDNDMNN.N.',
  '.M.LRMMNMMRN.D.',
  '.MMLRrrrrrRNDD.',
  '....DRRRRRD....',
  '.....LDLDL.....',
  '......LMN......',
]
const HEAD_TOP = 1
const EYES = [[4, 4], [5, 4], [9, 4], [10, 4]] // [column, row] in HEAD

function head({ dead = false, blaze = false } = {}) {
  const p = blank()
  const at = (x, y, c) => set(p, CX - 7 + x, HEAD_TOP + y, c)
  HEAD.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') at(x, y, row[x])
  })
  if (dead) {
    HEAD.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === 'R' || row[x] === 'r') at(x, y, EYES.some(([ex, ey]) => ex === x && ey === y) ? 'G' : 'D')
    })
  } else if (blaze) {
    at(5, 4, 'Y')
    at(9, 4, 'Y')
    at(4, 4, 'E')
    at(10, 4, 'E')
  }
  return p
}

// ---------------------------------------------------------------- the body

function neck() {
  const p = blank()
  rows(p, 11, [2, 2, 2])
  shade(p)
  for (const x of [CX - 1, CX + 1]) for (let y = 11; y <= 13; y++) set(p, x, y, 'D')
  return p
}

/** Chest, abdomen, belt and hips: a broad chest tapering hard to a thin waist. */
function torso() {
  const p = blank()
  rows(p, 13, [6, 9, 10, 10, 10, 9, 8, 6, 5, 4, 4, 3])
  shadeAcross(p, CX - 10, CX + 10)
  // The plate on the upper chest.
  for (let x = CX - 2; x <= CX + 2; x++) {
    set(p, x, 15, 'D')
    set(p, x, 17, 'D')
    set(p, x, 16, x < CX ? 'L' : 'N')
  }
  both(p, CX - 3, 16, 'D')
  set(p, CX - 2, 16, 'H')
  // Collar, and the pecs: a lit upper edge, a hard line curving under each.
  for (let x = CX - 6; x <= CX - 4; x++) both(p, x, 14, 'L')
  for (let x = CX - 8; x <= CX - 5; x++) both(p, x, 18, 'D')
  for (let x = CX - 4; x <= CX - 1; x++) both(p, x, 19, 'N')
  for (let x = CX - 8; x <= CX - 5; x++) set(p, x, 17, 'H')
  // The abs: a line down the middle, lit blocks on the left.
  for (let y = 19; y <= 21; y++) set(p, CX, y, 'D')
  set(p, CX - 2, 20, 'L')
  set(p, CX - 1, 20, 'H')
  set(p, CX - 1, 21, 'L')
  // Belt with its buckle.
  for (let x = CX - 4; x <= CX + 4; x++) set(p, x, 22, 'D')
  set(p, CX - 1, 22, 'L')
  set(p, CX, 22, 'H')
  set(p, CX + 1, 22, 'M')
  // Hips: a V down the middle.
  both(p, CX - 3, 23, 'D')
  set(p, CX, 23, 'D')
  set(p, CX, 24, 'D')
  return p
}

/** Angular deltoid plates with small spikes along the top. */
function shoulders() {
  const p = blank()
  const plate = [[13, -1, 2], [14, -2, 2], [15, -3, 2], [16, -3, 1], [17, -2, 1]] // [y, from, to] around the joint
  for (const s of [-1, 1]) {
    const x = c => (s < 0 ? c : mx(c))
    const x0 = CX - 10
    for (const [y, a, b] of plate) for (let k = a; k <= b; k++) set(p, x(x0 + k), y, 'M')
    for (const sx of [CX - 11, CX - 8]) {
      set(p, x(sx), 12, 'M')
      set(p, x(sx), 11, 'M')
    }
  }
  shade(p)
  for (const s of [-1, 1]) for (let k = -2; k <= 0; k++) mark(p, s < 0 ? CX - 10 + k : mx(CX - 10 + k), 16, 'N')
  return p
}

const ARMS = {
  // [shoulder, elbow, wrist] for the left arm (viewer's left); the right mirrors unless given.
  rest: { left: [[CX - 11, 16], [CX - 13, 20], [CX - 13, 24]] },
  swingA: { left: [[CX - 11, 16], [CX - 11, 20], [CX - 10, 24]], right: [[mx(CX - 11), 16], [mx(CX - 13), 19], [mx(CX - 14), 23]] },
  swingB: { left: [[CX - 11, 16], [CX - 13, 19], [CX - 14, 23]], right: [[mx(CX - 11), 16], [mx(CX - 11), 20], [mx(CX - 10), 24]] },
  claw: { left: [[CX - 11, 16], [CX - 12, 20], [CX - 13, 24]], right: [[mx(CX - 11), 16], [mx(CX - 13), 11], [mx(CX - 13), 6]] },
  crossed: { left: [[CX - 11, 16], [CX - 11, 20], [CX + 4, 19]], right: [[mx(CX - 11), 16], [mx(CX - 11), 21], [CX - 5, 20]] },
  stance: { left: [[CX - 11, 16], [CX - 13, 20], [CX - 14, 24]], right: [[mx(CX - 11), 15], [mx(CX - 13), 12], [mx(CX - 14), 7]] },
  slump: { left: [[CX - 11, 16], [CX - 11, 21], [CX - 10, 26]] },
}

/** An open hand at the wrist: palm, three fingers fanned, a thumb. */
function hand(p, [ex, ey], [wx, wy], { isOpen = true, thumb = 1 } = {}) {
  const len = Math.hypot(wx - ex, wy - ey) || 1
  const ux = (wx - ex) / len
  const uy = (wy - ey) / len
  const cx = wx + ux
  const cy = wy + uy
  disc(p, Math.round(cx), Math.round(cy), 1)
  const fan = isOpen ? [-0.7, 0, 0.7] : [-0.3, 0, 0.3]
  const reach = isOpen ? 3.2 : 2.2
  for (const a of fan) {
    const fx = ux * Math.cos(a) - uy * Math.sin(a)
    const fy = ux * Math.sin(a) + uy * Math.cos(a)
    limb(p, Math.round(cx + fx * 1.5), Math.round(cy + fy * 1.5), Math.round(cx + fx * reach), Math.round(cy + fy * reach), 0)
  }
  const ta = 1.5 * thumb
  const tx = ux * Math.cos(ta) - uy * Math.sin(ta)
  const ty = ux * Math.sin(ta) + uy * Math.cos(ta)
  limb(p, Math.round(cx + tx * 1.5), Math.round(cy + ty * 1.5), Math.round(cx + tx * 2.5), Math.round(cy + ty * 2.5), 0)
}

/** One arm on its own layer: bulky upper arm, armoured forearm, the hand. */
function arm([a, e, w], { side, isOpen = true, fist = false }) {
  const p = blank()
  // Upper arm with a bulging biceps, a lean forearm.
  limb(p, a[0], a[1], e[0], e[1], 1)
  disc(p, Math.round(a[0] + (e[0] - a[0]) * 0.45), Math.round(a[1] + (e[1] - a[1]) * 0.45), 2)
  limb(p, e[0], e[1], w[0], w[1], 1)
  if (fist) disc(p, w[0], w[1], 1)
  else hand(p, e, w, { isOpen, thumb: side })
  shade(p)
  const len = Math.hypot(w[0] - e[0], w[1] - e[1]) || 1
  const ux = (w[0] - e[0]) / len
  const uy = (w[1] - e[1]) / len
  seam(p, e[0] + ux, e[1] + uy, ux, uy, 1)
  return p
}

const LEGS = {
  // [hip, knee, ankle] for each leg, left then right.
  stand: [[[CX - 3, 23], [CX - 4, 26], [CX - 5, 29]], [[mx(CX - 3), 23], [mx(CX - 4), 26], [mx(CX - 5), 29]]],
  strideA: [[[CX - 3, 23], [CX - 6, 26], [CX - 8, 29]], [[mx(CX - 3), 23], [mx(CX - 3), 26], [mx(CX - 3), 29]]],
  strideB: [[[CX - 3, 23], [CX - 3, 26], [CX - 3, 29]], [[mx(CX - 3), 23], [mx(CX - 6), 26], [mx(CX - 8), 29]]],
  tap: [[[CX - 3, 23], [CX - 4, 26], [CX - 5, 29]], [[mx(CX - 3), 23], [mx(CX - 5), 26], [mx(CX - 7), 28]]],
  stance: [[[CX - 4, 23], [CX - 7, 26], [CX - 10, 29]], [[mx(CX - 4), 23], [mx(CX - 7), 26], [mx(CX - 10), 29]]],
}

/** One leg: armoured thigh, knee plate, shin and boot. */
function leg([hip, knee, ankle]) {
  const p = blank()
  limb(p, hip[0], hip[1], knee[0], knee[1], 2)
  limb(p, knee[0], knee[1], ankle[0], ankle[1], 1)
  const toe = ankle[0] < CX ? -1 : 1
  for (let x = ankle[0] - 2; x <= ankle[0] + 2; x++) set(p, x, ankle[1] + 1, 'M')
  set(p, ankle[0] + 3 * toe, ankle[1] + 1, 'M')
  shade(p)
  set(p, knee[0], knee[1], 'H')
  set(p, knee[0] + 1, knee[1], 'L')
  for (let x = ankle[0] - 1; x <= ankle[0] + 1; x++) mark(p, x, ankle[1], 'D')
  return p
}

// ---------------------------------------------------------------- poses

function compose({ armKind = 'rest', legKind = 'stand', dead = false, blaze = false, isOpen = true } = {}) {
  const g = blank()
  for (const l of LEGS[legKind]) stamp(g, leg(l))
  stamp(g, torso())
  stamp(g, neck())
  const spec = ARMS[armKind]
  const right = spec.right ?? spec.left.map(([x, y]) => [mx(x), y])
  const fist = armKind === 'crossed'
  // Arms hang behind the shoulder plates, except when folded across the chest.
  if (fist) {
    stamp(g, shoulders())
    stamp(g, arm(right, { side: 1, fist }))
    stamp(g, arm(spec.left, { side: -1, fist }))
  } else {
    stamp(g, arm(spec.left, { side: -1 }))
    stamp(g, arm(right, { side: 1, isOpen: armKind === 'claw' ? isOpen : true }))
    stamp(g, shoulders())
  }
  stamp(g, head({ dead, blaze }))
  return outline(g).map(r => r.join(''))
}

const FRAMES = {
  idle: compose(),
  walkA: compose({ armKind: 'swingA', legKind: 'strideA' }),
  walkB: compose({ armKind: 'swingB', legKind: 'strideB' }),
  workA: compose({ armKind: 'claw', isOpen: false }),
  workB: compose({ armKind: 'claw', isOpen: true }),
  waitA: compose({ armKind: 'crossed' }),
  waitB: compose({ armKind: 'crossed', legKind: 'tap' }),
  winA: compose({ armKind: 'stance', legKind: 'stance' }),
  winB: compose({ armKind: 'stance', legKind: 'stance', blaze: true }),
  fail: compose({ armKind: 'slump', dead: true }),
}

/** For tools that preview the art: the palette and every frame. */
export const ART = { palette: PALETTE, frames: FRAMES }

const EYE_ROWS = [HEAD_TOP + 4]

/** The frame's 32 rows for a pose and time. */
export function frame(pose, t) {
  const tick = Math.floor(t / 180)
  let rows
  switch (pose) {
    case 'walk':
      rows = tick % 2 ? FRAMES.walkA : FRAMES.walkB
      break
    case 'work':
      rows = tick % 2 ? FRAMES.workB : FRAMES.workA
      break
    case 'wait':
      rows = tick % 6 === 5 ? FRAMES.waitB : FRAMES.waitA
      break
    case 'win':
      rows = Math.floor(t / 420) % 2 ? FRAMES.winB : FRAMES.winA
      break
    case 'fail':
      rows = FRAMES.fail
      break
    default:
      rows = FRAMES.idle
  }
  // A blink now and then.
  if (pose !== 'fail' && pose !== 'win' && Math.floor(t / 3000) % 4 === 3 && t % 3000 < 150) rows = rows.map((r, y) => (EYE_ROWS.includes(y) ? r.replace(/R/g, 'D') : r))
  return rows
}

const CANVAS = 40 // 32 of Ultron and room for sparks, smoke and the "?"

/** Draws Ultron with the pose's motion and effects on a 40×40 canvas. */
export function draw(canvas, pose, t) {
  const ctx = canvas.getContext('2d')
  if (canvas.width !== CANVAS) {
    canvas.width = CANVAS
    canvas.height = CANVAS
  }
  ctx.clearRect(0, 0, CANVAS, CANVAS)
  const tick = Math.floor(t / 180)
  let dx = 4
  let dy = 5
  if (pose === 'idle') dy += Math.floor(t / 1100) % 2
  if (pose === 'walk') dy += tick % 2
  if (pose === 'work') dx += tick % 4 === 1 ? 1 : 0
  if (pose === 'fail') dx += 1
  // Eyes that glow: a soft red halo behind the face, a blaze at the end.
  if (pose !== 'fail') {
    const strong = pose === 'win'
    const ex = dx + CX + 0.5
    const ey = dy + HEAD_TOP + 5
    const glow = ctx.createRadialGradient(ex, ey, 1, ex, ey, strong ? 10 : 7)
    glow.addColorStop(0, `rgba(255,43,31,${(strong ? 0.42 : 0.28) + 0.12 * Math.sin(t / 300)})`)
    glow.addColorStop(1, 'rgba(255,43,31,0)')
    ctx.fillStyle = glow
    ctx.fillRect(ex - 11, ey - 11, 22, 22)
  }
  paint(ctx, frame(pose, t), dx, dy)

  if (pose === 'work') {
    const sparks = [[34, 3], [36, 7], [31, 1], [35, 5], [33, 9]]
    const [sx, sy] = sparks[tick % sparks.length]
    dot(ctx, sx, sy, PALETTE.S)
    dot(ctx, sx + 1, sy, PALETTE.R)
    dot(ctx, sx, sy + 1, PALETTE.R)
    const [ox, oy] = sparks[(tick + 2) % sparks.length]
    dot(ctx, ox - 2, oy + 2, PALETTE.S)
  }
  if (pose === 'win') {
    // Energy crackling around the raised claw, dust at the feet.
    const points = [[37, 5], [34, 1], [38, 10], [31, 3], [1, 33], [38, 36], [2, 38]]
    points.forEach(([x, y], k) => {
      if ((tick + k) % 3) dot(ctx, x, y, tick % 2 ? PALETTE.R : PALETTE.S)
    })
  }
  if (pose === 'fail') {
    const puff = tick % 6
    ctx.fillStyle = 'rgba(154,160,170,0.75)'
    ctx.fillRect(24 - puff, 3 - (puff >> 1), 3, 2)
    ctx.fillRect(27 - puff, 1 - (puff >> 2), 2, 1)
  }
  if (pose === 'wait') {
    // A "?" over his head.
    ctx.fillStyle = PALETTE.H
    ctx.fillRect(31, 0, 7, 8)
    ctx.fillStyle = PALETTE.K
    ctx.fillRect(33, 1, 3, 1)
    ctx.fillRect(35, 2, 1, 2)
    ctx.fillRect(34, 4, 1, 1)
    ctx.fillRect(34, 6, 1, 1)
  }
}

function paint(ctx, rows, dx, dy) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]]
      if (c) dot(ctx, dx + x, dy + y, c)
    }
  })
}

function dot(ctx, x, y, c) {
  ctx.fillStyle = c
  ctx.fillRect(x, y, 1, 1)
}

/** The head and fins alone, for the logo: Ultron as the main icon. */
export function drawHead(canvas, t) {
  const ctx = canvas.getContext('2d')
  if (canvas.width !== 17) {
    canvas.width = 17
    canvas.height = 12
  }
  ctx.clearRect(0, 0, 17, 12)
  const rows = frame('idle', t)
    .slice(0, 12)
    .map(r => r.slice(CX - 8, CX + 9))
  paint(ctx, rows, 0, 0)
}
