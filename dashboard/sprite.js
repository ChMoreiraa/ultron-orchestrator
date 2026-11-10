// Ultron em pixel art (32×32), chibi: o mesmo personagem do painel do
// terminal, em mais detalhe. Cabeça grande de cromo (domo com crista clara
// até o nariz, aletas nas têmporas presas à mandíbula, olhos em fenda que
// descem para o nariz, sorriso em U com dentes) sobre um corpo compacto de
// armadura, com o núcleo vermelho no peito. Cada parte do corpo é pintada na
// sua camada, sombreada com luz do alto à esquerda e carimbada com um traço
// escuro onde cobre a parte de trás.
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

// ---------------------------------------------------------------- the head

// A chibi head, big on a compact body, the same Ultron as the terminal pane:
// a chrome dome with a bright ridge down to the nose, fins at the temples
// joined to the jaw, eyes in slits that slant down to the nose, a toothed
// grin and a chin. Rows of the head start at HEAD_TOP.
const HEAD_TOP = 1
const HEAD_HALVES = [3, 5, 6, 7, 8, 8, 8, 8, 8, 8, 7, 6, 5, 3]
/** The eye slits: [dx from the centre, row]; mirrored for the right eye. */
const EYE_SLIT = [[-7, 7], [-6, 7], [-5, 7], [-5, 8], [-4, 8], [-3, 8]]
const EYE_ROWS = [HEAD_TOP + 7, HEAD_TOP + 8]

function head({ dead = false, blaze = false } = {}) {
  const p = blank()
  rows(p, HEAD_TOP, HEAD_HALVES)
  // Fins: a blade at each temple, rising above the skull, joined to the jaw.
  for (let y = 2; y <= 8; y++) both(p, CX - 11, HEAD_TOP + y, 'M')
  for (let y = 4; y <= 10; y++) both(p, CX - 10, HEAD_TOP + y, 'M')
  both(p, CX - 9, HEAD_TOP + 10, 'M')
  both(p, CX - 8, HEAD_TOP + 11, 'M')
  shadeAcross(p, CX - 9, CX + 9)
  for (let y = 2; y <= 10; y++) {
    set(p, CX - 11, HEAD_TOP + y, y <= 8 ? 'H' : '.')
    set(p, CX - 10, HEAD_TOP + y, y < 4 ? '.' : 'L')
    set(p, mx(CX - 11), HEAD_TOP + y, y <= 8 ? 'N' : '.')
    set(p, mx(CX - 10), HEAD_TOP + y, y < 4 ? '.' : 'D')
  }
  const at = (dx, y, c) => set(p, CX + dx, HEAD_TOP + y, c)
  const pair = (dx, y, c, cr = c) => {
    at(dx, y, c)
    at(-dx, y, cr)
  }
  // The ridge: lit on the left, a shadow on the right, down to the nose.
  for (let y = 0; y <= 6; y++) {
    at(-1, y, 'L')
    at(0, y, 'H')
    at(1, y, 'N')
  }
  at(0, 7, 'L')
  at(1, 7, 'N')
  at(0, 8, 'M')
  at(1, 8, 'D')
  // Brow: a hard shadow over each eye, sloping down to the ridge.
  for (const [dx, y] of [[-7, 6], [-6, 6], [-5, 6], [-4, 7], [-3, 7], [-2, 8]]) pair(dx, y, 'D')
  // Sockets around the slits, then the slits themselves.
  for (const [dx, y] of [[-7, 8], [-6, 8], [-2, 9], [-3, 9], [-4, 9]]) pair(dx, y, 'N', 'D')
  for (const [dx, y] of EYE_SLIT) pair(dx, y, 'R')
  pair(-6, 7, 'E')
  // Cheek lines from the eyes down to the grin.
  for (let y = 9; y <= 10; y++) pair(-7, y, 'N', 'D')
  // The grin: a dark lip, glowing teeth with gaps, narrowing to the chin.
  // The grin, a U: corners up at the cheeks, teeth across, the glow deepest at the bottom.
  for (let dx = -4; dx <= 4; dx++) at(dx, 10, 'D')
  pair(-5, 10, 'R')
  for (let dx = -4; dx <= 4; dx++) at(dx, 11, dx % 2 ? 'r' : 'R')
  pair(-5, 11, 'D')
  for (let dx = -3; dx <= 3; dx++) at(dx, 12, Math.abs(dx) === 3 ? 'r' : 'R')
  pair(-4, 12, 'D')
  // Chin: a lit plate under the grin.
  at(-1, 13, 'L')
  at(0, 13, 'L')
  if (dead) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const c = p[y][x]
        if (c === 'R' || c === 'E') p[y][x] = EYE_ROWS.includes(y) ? 'G' : 'N'
        else if (c === 'r') p[y][x] = 'D'
      }
  } else if (blaze) {
    pair(-5, 7, 'Y')
    pair(-4, 8, 'Y')
    pair(-6, 7, 'H')
  }
  return p
}

// ---------------------------------------------------------------- the body

function neck() {
  const p = blank()
  rows(p, 15, [2])
  shade(p)
  set(p, CX - 1, 15, 'D')
  set(p, CX + 1, 15, 'D')
  return p
}

/** Chest, belly and belt: broad at the shoulders, a short waist. The core glows in the middle. */
function torso({ dead = false } = {}) {
  const p = blank()
  rows(p, 16, [6, 7, 7, 7, 6, 6, 5, 5, 4])
  shadeAcross(p, CX - 7, CX + 7)
  // Softer than the chrome head: the body keeps its brightest light for the plates.
  for (let y = 16; y <= 24; y++) for (let x = 0; x < SIZE; x++) if (p[y][x] === 'H') p[y][x] = 'L'
  // The chest plates: a lit upper edge, a hard line under each.
  for (let x = CX - 6; x <= CX - 3; x++) both(p, x, 16, 'L')
  for (let x = CX - 6; x <= CX - 3; x++) both(p, x, 20, 'D')
  set(p, CX - 5, 17, 'H')
  set(p, CX - 4, 17, 'H')
  // The core: a red diamond with a hot centre, set in a dark ring.
  const core = dead ? { R: 'G', E: 'N', r: 'D' } : { R: 'R', E: 'E', r: 'r' }
  for (const [x, y, c] of [
    [0, 17, 'D'],
    [-1, 18, 'D'], [0, 18, 'R'], [1, 18, 'D'],
    [-2, 19, 'D'], [-1, 19, 'R'], [0, 19, 'E'], [1, 19, 'R'], [2, 19, 'D'],
    [-1, 20, 'D'], [0, 20, 'r'], [1, 20, 'D'],
    [0, 21, 'D'],
  ])
    set(p, CX + x, y, core[c] ?? c)
  // The belly: a line down the middle, lit blocks on the left.
  set(p, CX, 22, 'D')
  set(p, CX - 2, 22, 'H')
  set(p, CX - 1, 22, 'L')
  // Belt with its buckle.
  for (let x = CX - 5; x <= CX + 5; x++) set(p, x, 23, 'D')
  set(p, CX - 1, 23, 'L')
  set(p, CX, 23, 'H')
  set(p, CX + 1, 23, 'N')
  set(p, CX, 24, 'D')
  return p
}

/** Round shoulder plates with a ridge of light on top. */
function shoulders() {
  const p = blank()
  for (const s of [-1, 1]) {
    const x = s < 0 ? CX - 8 : mx(CX - 8)
    disc(p, x, 17, 2)
    set(p, x, 14, 'M')
    set(p, x - s, 14, 'M')
  }
  shade(p)
  for (const s of [-1, 1]) {
    const x = s < 0 ? CX - 8 : mx(CX - 8)
    mark(p, x - 1, 15, 'H')
    mark(p, x, 15, 'L')
    for (let k = -2; k <= 2; k++) mark(p, x + k, 19, 'N')
  }
  return p
}

const ARMS = {
  // [shoulder, elbow, wrist] for the left arm (viewer's left); the right mirrors unless given.
  rest: { left: [[CX - 9, 18], [CX - 10, 21], [CX - 10, 24]] },
  swingA: { left: [[CX - 9, 18], [CX - 9, 21], [CX - 8, 24]], right: [[mx(CX - 9), 18], [mx(CX - 11), 21], [mx(CX - 12), 23]] },
  swingB: { left: [[CX - 9, 18], [CX - 11, 21], [CX - 12, 23]], right: [[mx(CX - 9), 18], [mx(CX - 9), 21], [mx(CX - 8), 24]] },
  claw: { left: [[CX - 9, 18], [CX - 10, 21], [CX - 10, 24]], right: [[mx(CX - 9), 18], [mx(CX - 12), 14], [mx(CX - 13), 9]] },
  crossed: { left: [[CX - 9, 18], [CX - 9, 21], [CX + 4, 20]], right: [[mx(CX - 9), 18], [mx(CX - 9), 22], [CX - 4, 21]] },
  stance: { left: [[CX - 9, 18], [CX - 11, 21], [CX - 12, 24]], right: [[mx(CX - 9), 17], [mx(CX - 12), 13], [mx(CX - 14), 8]] },
  slump: { left: [[CX - 9, 18], [CX - 9, 22], [CX - 8, 26]] },
}

/** A claw at the wrist: palm, three talons fanned, a thumb. */
function claw(p, [ex, ey], [wx, wy], { isOpen = true, thumb = 1 } = {}) {
  const len = Math.hypot(wx - ex, wy - ey) || 1
  const ux = (wx - ex) / len
  const uy = (wy - ey) / len
  const cx = wx + ux
  const cy = wy + uy
  disc(p, Math.round(cx), Math.round(cy), 1)
  const fan = isOpen ? [-0.75, 0, 0.75] : [-0.25, 0.25]
  const reach = isOpen ? 3 : 2
  for (const a of fan) {
    const fx = ux * Math.cos(a) - uy * Math.sin(a)
    const fy = ux * Math.sin(a) + uy * Math.cos(a)
    limb(p, Math.round(cx + fx * 1.5), Math.round(cy + fy * 1.5), Math.round(cx + fx * reach), Math.round(cy + fy * reach), 0)
  }
  if (isOpen) {
    const ta = 1.5 * thumb
    const tx = ux * Math.cos(ta) - uy * Math.sin(ta)
    const ty = ux * Math.sin(ta) + uy * Math.cos(ta)
    limb(p, Math.round(cx + tx * 1.5), Math.round(cy + ty * 1.5), Math.round(cx + tx * 2.2), Math.round(cy + ty * 2.2), 0)
  }
}

/** One arm on its own layer: upper arm, armoured forearm with a cuff, a fist or a claw. */
function arm([a, e, w], { side, raised = false, isOpen = true }) {
  const p = blank()
  limb(p, a[0], a[1], e[0], e[1], 1)
  limb(p, e[0], e[1], w[0], w[1], 1)
  if (raised) claw(p, e, w, { isOpen, thumb: side })
  else {
    // A round fist just past the wrist.
    const len = Math.hypot(w[0] - e[0], w[1] - e[1]) || 1
    disc(p, Math.round(w[0] + (w[0] - e[0]) / len), Math.round(w[1] + (w[1] - e[1]) / len), 1)
  }
  shade(p)
  const len = Math.hypot(w[0] - e[0], w[1] - e[1]) || 1
  const ux = (w[0] - e[0]) / len
  const uy = (w[1] - e[1]) / len
  seam(p, e[0], e[1], ux, uy, 1)
  seam(p, Math.round(w[0] - ux), Math.round(w[1] - uy), ux, uy, 1, 'N')
  return p
}

const LEGS = {
  // [hip, knee, ankle] for each leg, left then right.
  stand: [[[CX - 3, 25], [CX - 3, 27], [CX - 4, 29]], [[mx(CX - 3), 25], [mx(CX - 3), 27], [mx(CX - 4), 29]]],
  strideA: [[[CX - 3, 25], [CX - 5, 27], [CX - 7, 29]], [[mx(CX - 3), 25], [mx(CX - 3), 27], [mx(CX - 2), 29]]],
  strideB: [[[CX - 3, 25], [CX - 3, 27], [CX - 2, 29]], [[mx(CX - 3), 25], [mx(CX - 5), 27], [mx(CX - 7), 29]]],
  tap: [[[CX - 3, 25], [CX - 3, 27], [CX - 4, 29]], [[mx(CX - 3), 25], [mx(CX - 5), 27], [mx(CX - 6), 28]]],
  stance: [[[CX - 4, 25], [CX - 6, 27], [CX - 8, 29]], [[mx(CX - 4), 25], [mx(CX - 6), 27], [mx(CX - 8), 29]]],
}

/** One short leg: thigh, a lit knee, the shin and a boot pointing outwards. */
function leg([hip, knee, ankle]) {
  const p = blank()
  limb(p, hip[0], hip[1], knee[0], knee[1], 1)
  limb(p, knee[0], knee[1], ankle[0], ankle[1], 1)
  const toe = ankle[0] < CX ? -1 : 1
  for (let x = ankle[0] - 2; x <= ankle[0] + 2; x++) set(p, x, ankle[1] + 1, 'M')
  set(p, ankle[0] + 3 * toe, ankle[1] + 1, 'M')
  shade(p)
  set(p, knee[0], knee[1], 'H')
  for (let x = ankle[0] - 2; x <= ankle[0] + 2; x++) mark(p, x, ankle[1] + 1, 'N')
  mark(p, ankle[0] - 1, ankle[1] + 1, 'L')
  return p
}

// ---------------------------------------------------------------- poses

function compose({ armKind = 'rest', legKind = 'stand', dead = false, blaze = false, isOpen = true } = {}) {
  const g = blank()
  for (const l of LEGS[legKind]) stamp(g, leg(l))
  stamp(g, torso({ dead }))
  stamp(g, neck())
  const spec = ARMS[armKind]
  const right = spec.right ?? spec.left.map(([x, y]) => [mx(x), y])
  const raised = armKind === 'claw' || armKind === 'stance'
  if (armKind === 'crossed') {
    // Folded across the chest, in front of everything but the head.
    stamp(g, shoulders())
    stamp(g, arm(right, { side: 1 }))
    stamp(g, arm(spec.left, { side: -1 }))
  } else {
    stamp(g, arm(spec.left, { side: -1 }))
    stamp(g, arm(right, { side: 1, raised, isOpen: armKind === 'claw' ? isOpen : true }))
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
  if (pose !== 'fail' && pose !== 'win' && Math.floor(t / 3000) % 4 === 3 && t % 3000 < 150) rows = rows.map((r, y) => (EYE_ROWS.includes(y) ? r.replace(/[RE]/g, 'D') : r))
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
    const ey = dy + HEAD_TOP + 8
    const glow = ctx.createRadialGradient(ex, ey, 1, ex, ey, strong ? 12 : 9)
    glow.addColorStop(0, `rgba(255,43,31,${(strong ? 0.42 : 0.26) + 0.12 * Math.sin(t / 300)})`)
    glow.addColorStop(1, 'rgba(255,43,31,0)')
    ctx.fillStyle = glow
    ctx.fillRect(ex - 13, ey - 13, 26, 26)
  }
  paint(ctx, frame(pose, t), dx, dy)

  if (pose === 'work') {
    const sparks = [[36, 4], [38, 8], [33, 2], [37, 6], [35, 10]]
    const [sx, sy] = sparks[tick % sparks.length]
    dot(ctx, sx, sy, PALETTE.S)
    dot(ctx, sx + 1, sy, PALETTE.R)
    dot(ctx, sx, sy + 1, PALETTE.R)
    const [ox, oy] = sparks[(tick + 2) % sparks.length]
    dot(ctx, ox - 2, oy + 2, PALETTE.S)
  }
  if (pose === 'win') {
    // Energy crackling around the raised claw, dust at the feet.
    const points = [[38, 6], [35, 2], [39, 11], [32, 4], [1, 33], [38, 36], [2, 38]]
    points.forEach(([x, y], k) => {
      if ((tick + k) % 3) dot(ctx, x, y, tick % 2 ? PALETTE.R : PALETTE.S)
    })
  }
  if (pose === 'fail') {
    const puff = tick % 6
    ctx.fillStyle = 'rgba(154,160,170,0.75)'
    ctx.fillRect(26 - puff, 3 - (puff >> 1), 3, 2)
    ctx.fillRect(29 - puff, 1 - (puff >> 2), 2, 1)
  }
  if (pose === 'wait') {
    // A "?" over his head.
    ctx.fillStyle = PALETTE.H
    ctx.fillRect(32, 0, 7, 8)
    ctx.fillStyle = PALETTE.K
    ctx.fillRect(34, 1, 3, 1)
    ctx.fillRect(36, 2, 1, 2)
    ctx.fillRect(35, 4, 1, 1)
    ctx.fillRect(35, 6, 1, 1)
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
const LOGO_W = 23
const LOGO_H = 16

export function drawHead(canvas, t) {
  const ctx = canvas.getContext('2d')
  if (canvas.width !== LOGO_W) {
    canvas.width = LOGO_W
    canvas.height = LOGO_H
  }
  ctx.clearRect(0, 0, LOGO_W, LOGO_H)
  // Only the head's own layer, outlined, so neither neck nor shoulders creep in.
  const g = blank()
  stamp(g, head())
  const rows = outline(g)
    .map(r => r.join(''))
    .slice(0, LOGO_H)
    .map(r => r.slice(CX - 11, CX + 12))
  const blink = Math.floor(t / 3000) % 4 === 3 && t % 3000 < 150
  paint(ctx, blink ? rows.map((r, y) => (EYE_ROWS.includes(y) ? r.replace(/[RE]/g, 'D') : r)) : rows, 0, 0)
}
