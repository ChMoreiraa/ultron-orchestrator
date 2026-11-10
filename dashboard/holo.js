// The AI hologram: a sphere of light lines and data dashes, turning slowly,
// in the colour of the repo's AI (after the Stark AI globes in the films).
// Drawn on any <canvas data-holo="#rrggbb">; size follows the canvas.

const POINTS = (() => {
  // Points on a sphere, spread by the golden angle, each with a dash length.
  const out = []
  const n = 90
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.399963
    out.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, len: 0.06 + ((i * 37) % 11) / 90 })
  }
  return out
})()

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** Draws the hologram at time `t` (ms). `isDim` draws it faint, for a closed session. */
export function drawHolo(canvas, color, t, isDim = false) {
  const size = canvas.clientWidth || canvas.width
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  const px = Math.round(size * ratio)
  if (canvas.width !== px) {
    canvas.width = px
    canvas.height = px
  }
  const ctx = canvas.getContext('2d')
  const R = px * 0.4
  const c = px / 2
  const spin = t / 4200
  const wobble = Math.sin(t / 2600) * 0.25
  const k = isDim ? 0.45 : 1
  ctx.clearRect(0, 0, px, px)
  ctx.globalCompositeOperation = 'lighter'

  // Halo.
  const glow = ctx.createRadialGradient(c, c, R * 0.1, c, c, R * 1.25)
  glow.addColorStop(0, rgba(color, 0.35 * k))
  glow.addColorStop(0.6, rgba(color, 0.08 * k))
  glow.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, px, px)

  ctx.lineCap = 'round'
  // Meridians: ellipses whose width follows the turn, giving the sphere depth.
  for (let i = 0; i < 4; i++) {
    const a = spin + (i * Math.PI) / 4
    const w = Math.abs(Math.cos(a)) * R
    ctx.strokeStyle = rgba(color, (0.25 + 0.35 * Math.abs(Math.sin(a))) * k)
    ctx.lineWidth = Math.max(1, px / 90)
    ctx.beginPath()
    ctx.ellipse(c, c, Math.max(0.5, w), R, wobble, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Parallels.
  for (const lat of [-0.6, -0.25, 0.25, 0.6]) {
    const y = c + lat * R
    const w = Math.sqrt(1 - lat * lat) * R
    ctx.strokeStyle = rgba(color, 0.3 * k)
    ctx.beginPath()
    ctx.ellipse(c, y, w, w * 0.18, wobble * 0.3, 0, Math.PI * 2)
    ctx.stroke()
  }
  // Data dashes on the turning sphere: bright in front, faint behind.
  const cos = Math.cos(spin * 1.6)
  const sin = Math.sin(spin * 1.6)
  for (const p of POINTS) {
    const x = p.x * cos - p.z * sin
    const z = p.x * sin + p.z * cos
    const front = (z + 1) / 2
    ctx.strokeStyle = rgba(color, (0.15 + 0.85 * front) * k)
    ctx.lineWidth = Math.max(1, (px / 70) * (0.6 + front))
    const sx = c + x * R
    const sy = c + p.y * R
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx + p.len * R * (0.5 + front), sy)
    ctx.stroke()
  }
  // The core: a bright eye that breathes.
  const pulse = 0.75 + 0.25 * Math.sin(t / 500)
  const core = ctx.createRadialGradient(c, c, 0, c, c, R * 0.35)
  core.addColorStop(0, rgba('#ffffff', 0.9 * pulse * k))
  core.addColorStop(0.35, rgba(color, 0.8 * pulse * k))
  core.addColorStop(1, rgba(color, 0))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(c, c, R * 0.35, 0, Math.PI * 2)
  ctx.fill()
  // An orbit ring around the core.
  ctx.strokeStyle = rgba(color, 0.7 * k)
  ctx.lineWidth = Math.max(1, px / 60)
  ctx.beginPath()
  ctx.arc(c, c, R * 0.55, spin * 3, spin * 3 + Math.PI * 1.3)
  ctx.stroke()
  ctx.globalCompositeOperation = 'source-over'
}

/** Redraws every hologram on the page; called from the animation loop. */
export function drawAllHolos(t) {
  for (const canvas of document.querySelectorAll('canvas[data-holo]')) {
    if (!canvas.isConnected || canvas.offsetParent === null) continue
    drawHolo(canvas, canvas.dataset.holo, t, canvas.dataset.dim === '1')
  }
}
