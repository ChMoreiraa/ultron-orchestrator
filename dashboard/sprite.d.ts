// Types for sprite.js, so the mod (hooks/sprite.ts) draws the same Ultron as the dashboard.
export declare const PALETTE: Record<string, string>
export declare const ART: { palette: Record<string, string>; frames: Record<string, string[]> }
export declare function frame(pose: string, t: number): string[]
export declare function draw(canvas: unknown, pose: string, t: number): void
export declare function drawHead(canvas: unknown, t: number): void
