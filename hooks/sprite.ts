// Ultron for the terminal: the very same 32×32 art as the dashboard
// (dashboard/sprite.js), drawn as 16 rows of half blocks ('▀': top pixel in
// the foreground, bottom in the background). Change the art there and both
// change together.
import { ART as DASHBOARD } from '../dashboard/sprite.js'

export type Pose = 'idle' | 'walk' | 'work' | 'win' | 'fail' | 'wait'

export const PALETTE: Record<string, string> = DASHBOARD.palette

export const ART = { palette: PALETTE, frames: DASHBOARD.frames }

/** Width of every frame, in pixels and so in terminal columns. */
export const SPRITE_W = ART.frames.idle![0]!.length

const BLINK_EVERY = 9
/** The row with the eyes in the dashboard's art (its HEAD_TOP + 4). */
const EYE_ROWS = [5]

/** The pose's 32 pixel rows at this frame (one frame per tick of the pane). */
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
  if (pose !== 'fail' && pose !== 'win' && frame % BLINK_EVERY === BLINK_EVERY - 1) rows = rows.map((r, y) => (EYE_ROWS.includes(y) ? r.replace(/R/g, 'D') : r))
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
