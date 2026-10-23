'use client';
import React, { useEffect, useRef, useState } from 'react';
import { MistRenderer } from '@/lib/ui/mist-renderer';

/**
 * The dreamy mist behind a section. Place inside a `position: relative` parent.
 *
 * Two layers: a CSS "still" (fog, light rays, bokeh, grain, slow drift) that
 * every browser shows, and the live WebGL mist that fades in on top only once
 * it has actually drawn a frame. No GPU, WebGL blocked, or a lost GPU context:
 * the still stays, so everyone sees the same look.
 */
export default function MistBackground({ accent = '#8fe3b5', intensity = 0.85 }: { accent?: string; intensity?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MistRenderer | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!canvas.current) return;
    const mist = new MistRenderer(canvas.current, {
      accent, intensity,
      onFirstFrame: () => setLive(true),
      onLost: () => setLive(false),
    });
    if (!mist.start()) return;
    renderer.current = mist;
    const parent = canvas.current.parentElement;
    const move = (e: PointerEvent) => {
      const r = parent!.getBoundingClientRect();
      mist.setPointer((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
    };
    parent?.addEventListener('pointermove', move, { passive: true });
    return () => { parent?.removeEventListener('pointermove', move); mist.dispose(); renderer.current = null; setLive(false); };
    // Recreated only on mount; accent/intensity changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderer.current?.setAccent(accent); }, [accent]);
  useEffect(() => { renderer.current?.setIntensity(intensity); }, [intensity]);

  return <>
    <div className={live ? 'mist-still is-covered' : 'mist-still'} aria-hidden="true" data-testid="mist-still">
      <span className="mist-fog" />
      <span className="mist-rays" />
      <span className="mist-bokeh" />
      <span className="mist-grain" />
    </div>
    <canvas ref={canvas} className={live ? 'mist-canvas is-live' : 'mist-canvas'} aria-hidden="true" data-live={live ? 'true' : 'false'} />
    <div className="mist-scrim" aria-hidden="true" />
  </>;
}
