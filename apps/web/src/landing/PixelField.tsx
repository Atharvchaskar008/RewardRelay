"use client";

import { useEffect, useRef } from "react";

/**
 * SAKER's signature visual: a slowly drifting field of accent-blue pixels. Density comes from a
 * small value-noise function plus a diagonal flow; `clearZone` keeps a calm area for text. It only
 * animates while visible, at a low frame rate, and stays still for users who prefer reduced motion.
 */

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash(x0, y0);
  const b = hash(x0 + 1, y0);
  const c = hash(x0, y0 + 1);
  const d = hash(x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number): number {
  return (
    valueNoise(x, y) * 0.55 +
    valueNoise(x * 2.1, y * 2.1) * 0.3 +
    valueNoise(x * 4.3, y * 4.3) * 0.15
  );
}

export interface PixelFieldProps {
  /** Seed offset, so two fields on one page differ. */
  seed?: number;
  /** Where to keep the field quiet (fractions of width/height), e.g. behind a headline. */
  clearZone?: { x: number; y: number; w: number; h: number };
  /** Overall density bias (positive = more pixels). */
  bias?: number;
  className?: string;
}

export function PixelField({ seed = 0, clearZone, bias = 0, className }: PixelFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let cell = 12;
    let visible = true;
    let frame = 0;
    let last = 0;
    let time = seed * 37;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      cell = width < 640 ? 8 : 10;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#0700ff";
      ctx.fillStyle = accent;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const u = i / cols;
          const v = j / rows;
          // Domain warping: offset the lookup by a second noise field for organic, flowing shapes.
          const x = i * 0.045 + seed;
          const y = j * 0.06 + seed * 0.5;
          const wx = fbm(x * 0.6 + 5.2 + time * 0.02, y * 0.6 + 1.3);
          const wy = fbm(x * 0.6 + 1.7, y * 0.6 + 9.2 - time * 0.015);
          let d = fbm(x + wx * 1.6 + time * 0.012, y + wy * 1.6);
          d += (u - 0.4) * 0.3 - (v - 0.45) * 0.18 + bias;
          // Fade out under the navigation bar.
          d -= Math.max(0, 0.09 - v) * 3;
          if (clearZone && width >= 640) {
            const dx = Math.max(clearZone.x - u, 0, u - (clearZone.x + clearZone.w));
            const dy = Math.max(clearZone.y - v, 0, v - (clearZone.y + clearZone.h));
            const dist = Math.hypot(dx * 1.4, dy);
            d -= Math.max(0, 0.42 - dist * 2.2);
          }
          // Three dither levels: full pixel, half pixel, dot.
          const size = d > 0.68 ? 0.74 : d > 0.62 ? 0.5 : d > 0.57 ? 0.24 : 0;
          if (size) {
            const s = cell * size;
            ctx.fillRect(i * cell + (cell - s) / 2, j * cell + (cell - s) / 2, s, s);
          }
        }
      }
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden || now - last < 80) return;
      time += (now - last || 80) / 1000;
      last = now;
      draw();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(canvas);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();
    if (!reduce) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
    };
  }, [seed, clearZone, bias]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
