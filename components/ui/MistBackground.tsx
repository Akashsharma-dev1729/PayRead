'use client';
import React, { useEffect, useRef } from 'react';
import { MistRenderer } from '@/lib/ui/mist-renderer';

/**
 * Decorative WebGL mist behind a section. Place inside a `position: relative`
 * parent; it fills it and follows the pointer slightly.
 */
export default function MistBackground({ accent = '#8fe3b5', intensity = 0.85 }: { accent?: string; intensity?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MistRenderer | null>(null);

  useEffect(() => {
    if (!canvas.current) return;
    const mist = new MistRenderer(canvas.current, { accent, intensity });
    if (!mist.start()) return;
    renderer.current = mist;
    const parent = canvas.current.parentElement;
    const move = (e: PointerEvent) => {
      const r = parent!.getBoundingClientRect();
      mist.setPointer((e.clientX - r.left) / Math.max(1, r.width), (e.clientY - r.top) / Math.max(1, r.height));
    };
    parent?.addEventListener('pointermove', move, { passive: true });
    return () => { parent?.removeEventListener('pointermove', move); mist.dispose(); renderer.current = null; };
    // Recreated only on mount; accent/intensity changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderer.current?.setAccent(accent); }, [accent]);
  useEffect(() => { renderer.current?.setIntensity(intensity); }, [intensity]);

  return <>
    <canvas ref={canvas} className="mist-canvas" aria-hidden="true" />
    <div className="mist-scrim" aria-hidden="true" />
  </>;
}
