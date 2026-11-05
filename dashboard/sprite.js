// Mini Ultron em pixel art (16×16), desenhado num <canvas> pequeno e ampliado
// com image-rendering: pixelated. Cada letra é um pixel da paleta.
export const PALETTE = {
  K: '#0d0f14', // contorno
  S: '#c9d1dc', // prata
  L: '#f1f4f8', // brilho
  D: '#7b8594', // aço/sombra
  R: '#e1263b', // vermelho
  r: '#8f1426', // vermelho escuro
  E: '#ff4d3d', // olho
  Y: '#ffe08a', // núcleo aceso
  G: '#4b5262', // olho apagado
  V: '#2b0e16', // visor
}

// Capacete com crista, visor escuro com olhos em cunha e grade na boca.
const HEAD = [
  '.......KK.......',
  '......KRrK......',
  '....KKSRrSKK....',
  '...KSLLRrSSDK...',
  '..KSLSSSSSSSDK..',
  '..KSVEEVVEEVDK..',
  '..KSVVEVVEVVDK..',
  '...KDSKDDKSDK...',
  '....KKDDDDKK....',
]

// Ombreiras vermelhas e o núcleo aceso no peito.
const TORSO = [
  '.KRRKKSSSSKKRRK.',
  '.KrSKDSYYSDKSrK.',
  '.KSKKDSRRSDKKSK.',
  '.KDK.KDrrDK.KDK.',
]

const ARMS_UP = [
  'KSK.KKSSSSKK.KSK',
  'KRRKKDSYYSDKKRRK',
  '.KKrKDSRRSDKrKK.',
  '....KKDrrDKK....',
]

const LEGS = {
  stand: ['...KSDK..KSDK...', '...KDDK..KDDK...', '..KKKKK..KKKKK..'],
  walkA: ['..KSDK....KSDK..', '..KDDK....KDDK..', '.KKKKK....KKKKK.'],
  walkB: ['....KSDKKSDK....', '....KDDKKDDK....', '...KKKKKKKKKK...'],
}

const swapEyes = (rows, from, to) => rows.map(r => r.replaceAll(from, to))

/** The frame's 16 rows for a pose. */
export function frame(pose, t) {
  const tick = Math.floor(t / 160)
  let head = HEAD
  if (pose === 'fail') head = swapEyes(swapEyes(HEAD, 'E', 'G'), 'Y', 'G')
  else if (pose === 'win') head = swapEyes(HEAD, 'E', 'Y')
  else if (Math.floor(t / 2600) % 6 === 5 && t % 2600 < 160) head = swapEyes(HEAD, 'E', 'V') // pisca
  let torso = pose === 'win' && tick % 2 === 0 ? ARMS_UP : TORSO
  if (pose === 'work' && tick % 2 === 1) torso = swapEyes(torso, 'Y', 'L')
  const legs = pose === 'walk' ? (tick % 2 ? LEGS.walkA : LEGS.walkB) : LEGS.stand
  return [...head, ...torso, ...legs]
}

for (const rows of [HEAD, TORSO, ARMS_UP, ...Object.values(LEGS)]) {
  for (const r of rows) if (r.length !== 16) console.warn('ultron sprite: linha com tamanho errado', r)
}

/**
 * Draws Ultron on a canvas `size` pixels wide (a multiple of 16 keeps it crisp),
 * with the pose's motion and effects.
 */
export function draw(canvas, pose, t) {
  const ctx = canvas.getContext('2d')
  const W = 24 // 16px de sprite + margem para efeitos
  if (canvas.width !== W) {
    canvas.width = W
    canvas.height = W
  }
  ctx.clearRect(0, 0, W, W)
  const tick = Math.floor(t / 160)
  let dx = 4
  let dy = 6
  if (pose === 'idle' || pose === 'wait') dy += Math.floor(t / 500) % 2
  if (pose === 'walk') dy += tick % 2
  if (pose === 'work') dx += tick % 2 ? 1 : 0
  if (pose === 'win') dy -= [0, 2, 3, 2][tick % 4]
  if (pose === 'fail') dx += 1

  const rows = frame(pose, t)
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const c = PALETTE[row[x]]
      if (!c) continue
      ctx.fillStyle = c
      ctx.fillRect(dx + x, dy + y, 1, 1)
    }
  })

  // efeitos
  if (pose === 'work') {
    const sparks = [
      [2, 10],
      [21, 8],
      [20, 14],
      [3, 4],
    ]
    const [sx, sy] = sparks[tick % sparks.length]
    ctx.fillStyle = PALETTE.Y
    ctx.fillRect(sx, sy, 1, 1)
    ctx.fillStyle = PALETTE.E
    ctx.fillRect(sx + 1, sy, 1, 1)
    ctx.fillRect(sx, sy + 1, 1, 1)
  }
  if (pose === 'win') {
    ctx.fillStyle = tick % 2 ? PALETTE.Y : PALETTE.L
    for (const [x, y] of [
      [1, 3],
      [22, 2],
      [2, 15],
      [21, 12],
    ])
      if ((x + tick) % 3) ctx.fillRect(x, y, 1, 1)
  }
  if (pose === 'fail') {
    ctx.fillStyle = 'rgba(160,165,175,0.7)'
    const puff = tick % 4
    ctx.fillRect(15 - puff, 4 - puff, 2, 1)
    ctx.fillRect(17 - puff, 2 - (puff >> 1), 1, 1)
  }
  if (pose === 'wait') {
    // balão "?"
    ctx.fillStyle = PALETTE.L
    ctx.fillRect(18, 0, 5, 5)
    ctx.fillStyle = PALETTE.K
    ctx.fillRect(19, 1, 3, 1)
    ctx.fillRect(21, 2, 1, 1)
    ctx.fillRect(20, 3, 1, 1)
  }
}
