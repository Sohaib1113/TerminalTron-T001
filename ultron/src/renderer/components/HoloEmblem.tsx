import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { startHolo } from './holoEmblemEngine'; // engine: icosphere globe + HUD + bloom (port of terminal-tron-t002.html)

export interface HoloEmblemProps {
  /** Display size in CSS px (the square the emblem fills). */
  size: number;
  /** When true, runs the full animated mood loop; otherwise draws one settled frame. */
  animate?: boolean;
  /** Extra class names (e.g. "brand-logo" / "orb-logo") for layout + glow CSS. */
  className?: string;
}

/**
 * HoloEmblem — the TERMINAL-TRON holographic emblem rendered into a canvas.
 *
 * A React wrapper around the holoEmblem engine. Used in the three brand spots:
 *   - Title bar (20px, static frame)
 *   - Sidebar (36px, static frame)
 *   - Chat orb (70px, animated)
 *
 * The engine draws into an offscreen buffer sized to `size * devicePixelRatio`
 * so it stays crisp on hi-DPI displays. It runs the animated loop only when
 * `animate` is set, keeping the two small static instances cheap.
 */
export default function HoloEmblem({ size, animate = false, className }: HoloEmblemProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handle = startHolo(canvas, size, animate);
    return () => handle.destroy();
  }, [size, animate]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size, display: 'inline-block' }}
      aria-hidden="true"
    />
  );
}
