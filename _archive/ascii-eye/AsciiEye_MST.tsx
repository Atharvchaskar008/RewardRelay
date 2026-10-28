"use client";

import React, { useEffect, useRef } from "react";

/**
 * AsciiEye – Web port of the "Eye → Space" generative animation.
 * Canvas-based for performance. Drop it into any React / Next.js page.
 *
 * Timeline (approx):
 * 0.0s  – Eye closed
 * 0.9s  – Eye starts opening
 * 4.0s  – Blink
 * 5.4s  – Camera begins zooming into the pupil
 * 8.9s  – Space / stars become visible
 * 8.9s+ – Red triangular logo nebula morphs in (MST logo style)
 */

type Props = {
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Restart when this value changes */
  restartKey?: number | string;
};

const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
const NR = RAMP.length - 1;

// Simple seeded random
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

// Smoothstep
function ss(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function ease(t: number) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function mix3(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
}

// Lightweight value noise
function valueNoise2D(x: number, y: number, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const hash = (i: number, j: number) => {
    const n = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };

  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);

  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}

function fbm(x: number, y: number, octaves = 4, seed = 0) {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise2D(x * freq, y * freq, seed + i * 17);
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

// Pre-generate some stars
const STAR_COUNT = 1800;
const stars: { x: number; y: number; z: number; b: number; phase: number; freq: number; col: [number, number, number] }[] = [];
for (let i = 0; i < STAR_COUNT; i++) {
  const z = 0.08 + Math.pow(rand(), 1.6) * 0.92;
  const bright = 0.15 + 0.85 * Math.pow(rand(), 2.2);
  const t = Math.pow(rand(), 1.4);
  stars.push({
    x: (rand() - 0.5) * 2.2,
    y: (rand() - 0.5) * 2.2,
    z,
    b: bright,
    phase: rand() * Math.PI * 2,
    freq: 1.2 + rand() * 2.5,
    col: mix3([0.72, 0.84, 1.0], [1.0, 0.82, 0.55], t),
  });
}

export default function AsciiEye({
  width = 640,
  height = 420,
  className = "",
  style,
  restartKey = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Use a reasonable cell size for performance
    const CELL = 7;
    const COLS = Math.floor(width / CELL);
    const ROWS = Math.floor(height / CELL);

    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    // Timeline constants (seconds)
    const T_OPEN = 0.9;
    const T_OPEN_D = 2.4;
    const T_BLINK = 4.0;
    const T_Z0 = 5.4;
    const T_ZD = 22.0;
    const ZEND = 14.0;
    const T_SPACE = T_Z0 + 3.0;
    const T_LOGO = T_Z0 + 4.5;
    const T_LOGO_D = 18.0;

    const WO = 0.78;
    const HU = 0.30;
    const HL = 0.20;
    const RI = 0.27;
    const RP0 = 0.098;

    function blinkAmount(t: number) {
      const d = t - T_BLINK;
      if (d < 0 || d > 0.36) return 0;
      if (d < 0.09) return ease(d / 0.09);
      if (d < 0.12) return 1;
      return 1 - ease((d - 0.12) / 0.24);
    }

    function lidOpen(t: number) {
      let k = ease((t - T_OPEN) / T_OPEN_D);
      k = k * (1 + 0.035 * Math.sin(Math.PI * k));
      return Math.min(1, k) * (1 - 0.985 * blinkAmount(t));
    }

    function zoomProgress(t: number) {
      return ease((t - T_Z0) / T_ZD);
    }

    // Signed distance for an equilateral triangular frame (matches the red logo)
    // Returns negative inside the thick triangular ring
    function logoSDF(px: number, py: number) {
      // Scale & center the triangle so it sits nicely in the view
      const s = 0.92;
      const x = px * s;
      const y = py * s + 0.08;

      // Equilateral triangle vertices (pointing up)
      // Using a standard SDF for a triangle
      const k = Math.sqrt(3.0);
      const q = [Math.abs(x), y];

      // Outer triangle
      let dOuter = -q[1] * 0.5 + q[0] * 0.5 * k;
      dOuter = Math.max(dOuter, q[1] - 0.55);

      // Soft round the corners a tiny bit
      const outer = dOuter;

      // Inner triangle (smaller, creates the hollow frame)
      const innerScale = 0.55;
      const ix = x / innerScale;
      const iy = (y + 0.02) / innerScale;
      const iq = [Math.abs(ix), iy];
      let dInner = -iq[1] * 0.5 + iq[0] * 0.5 * k;
      dInner = Math.max(dInner, iq[1] - 0.55);
      dInner = dInner * innerScale;

      // The frame is the region between outer and inner
      // We also add a small "cut" feel on the lower right to mimic the logo
      let frame = Math.max(outer, -dInner - 0.02);

      // Slight 3D bevel feel by biasing
      return frame;
    }

    function render(t: number) {
      const prog = zoomProgress(t);
      const z = Math.exp(Math.log(ZEND) * prog) * (1 + 0.04 * ease(t / T_Z0));
      const ou = lidOpen(t);

      // soft gaze drift
      const gx = 0.012 * Math.sin(t * 0.7) * (1 - prog * 0.7);
      const gy = 0.008 * Math.sin(t * 0.55 + 1.2) * (1 - prog * 0.7) - 0.025 * blinkAmount(t);

      const Rp = RP0 * (0.78 + 0.22 * ease((t - 1.8) / 3.2)) * (1 + 0.22 * prog);

      // clear
      ctx.fillStyle = "#020306";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const starAmt = ease((t - (T_Z0 + 1.2)) / 3.5);
      const nebAmt = ease((t - (T_Z0 + 3.0)) / 6.0);
      const logoMorph = ease((t - T_LOGO) / T_LOGO_D);

      // Precompute some lid geometry
      const invZ = 1 / z;

      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          // normalized coords, center = 0, height = 1
          const u0 = ((col + 0.5) / COLS - 0.5) * (COLS / ROWS) * 1.05;
          const v0 = (row + 0.5) / ROWS - 0.5;

          // after zoom
          const u = u0 * invZ;
          const v = v0 * invZ;

          const pmU = u - gx;
          const pmV = v - gy;
          const r = Math.sqrt(pmU * pmU + pmV * pmV);

          let rCol = 0.01,
            gCol = 0.012,
            bCol = 0.025;
          let brightness = 0.02;

          const near = z < 3.6;

          // ---- Space / pupil content ----
          if (r < Rp * 1.15 || !near) {
            // background deep space
            rCol = 0.008;
            gCol = 0.01;
            bCol = 0.025;

            // stars
            if (starAmt > 0.01) {
              // simple star sampling via hash (cheap)
              const sx = (u0 + gx * 0.3) * (0.9 + z * 0.04);
              const sy = (v0 + gy * 0.3) * (0.9 + z * 0.04);
              const n = valueNoise2D(sx * 28 + 40, sy * 28 + 90, 3);
              const n2 = valueNoise2D(sx * 55 + 10, sy * 55 + 200, 7);
              if (n > 0.92) {
                const tw = 0.55 + 0.45 * Math.sin(t * 2.1 + n * 20);
                const b = (n - 0.92) / 0.08 * tw * starAmt;
                rCol += b * 0.9;
                gCol += b * 0.95;
                bCol += b * 1.1;
              }
              if (n2 > 0.955) {
                const b = (n2 - 0.955) / 0.045 * 0.7 * starAmt;
                rCol += b;
                gCol += b * 0.85;
                bCol += b * 0.55;
              }
            }

            // Logo nebula (red triangular frame matching the MST logo)
            if (nebAmt > 0.01) {
              const scale = 0.21 * (0.88 + 0.18 * Math.sin(t * 1.6) * logoMorph * logoMorph);
              const lx = (u0 - gx * 0.35) / scale;
              const ly = (v0 - gy * 0.35) / scale;

              // soft warping that decreases as the logo solidifies
              const nC = fbm(lx * 1.7 + 2.8, ly * 1.7 + 1.4, 3, 11);
              const nD = fbm(lx * 1.5 + 7.5, ly * 1.5 + 3.9, 3, 19);
              const wob = 1 - 0.72 * logoMorph;
              const lxw = lx + wob * 0.32 * (nC - 0.5);
              const lyw = ly + wob * 0.32 * (nD - 0.5);

              // start as a soft circular cloud, morph into the logo
              const qc = Math.sqrt(lxw * lxw + lyw * lyw) / 0.80 - 1.0;
              const ql = logoSDF(lxw, lyw);
              const q = mix(qc, ql, logoMorph);

              const inside = Math.max(0, Math.min(1, -q / 0.55));
              let body =
                q < 0
                  ? 0.55 + 0.45 * Math.sqrt(inside)
                  : Math.exp(-Math.max(0, q) * 3.4) * 0.38;

              // subtle texture while still nebula-like
              const tex = 0.78 + 0.45 * fbm(lxw * 4.2 + t * 0.12, lyw * 4.2, 3, 5);
              body *= mix(tex, 1.0, logoMorph * 0.7);

              // Strong red palette matching the logo
              const deep: [number, number, number] = [0.72, 0.05, 0.08];
              const bright: [number, number, number] = [1.0, 0.18, 0.14];
              const mid: [number, number, number] = [0.92, 0.10, 0.10];
              const hcol = mix3(deep, bright, Math.pow(inside, 0.65));
              const finalCol = mix3(hcol, mid, logoMorph * 0.35);

              // outer glow
              const halo = Math.exp(-Math.max(0, q) * 1.7) * 0.22 * (0.55 + nC);

              // edge highlight for the 3D / beveled look of the logo
              const edge = Math.exp(-Math.pow(q + 0.02, 2) / 0.012) * logoMorph;

              rCol += (body * finalCol[0] + halo * 0.85 + edge * 0.9) * nebAmt * 1.25;
              gCol += (body * finalCol[1] + halo * 0.08 + edge * 0.12) * nebAmt * 1.25;
              bCol += (body * finalCol[2] + halo * 0.08 + edge * 0.10) * nebAmt * 1.25;
            }

            // pupil edge vignette
            const edge = ss(Rp * 0.92, Rp * 1.08, r);
            rCol *= 1 - 0.55 * edge;
            gCol *= 1 - 0.55 * edge;
            bCol *= 1 - 0.55 * edge;
          }

          // ---- Eye structure (only when not fully zoomed) ----
          if (near) {
            // lid curves
            const s = u / WO;
            const sa = Math.max(-1.3, Math.min(1.3, s));
            const wu = sa < -0.12 ? 0.88 : 1.12;
            const cu = Math.pow(Math.max(0, 1 - Math.pow((sa + 0.12) / wu, 2)), 0.8);
            const cl = Math.pow(Math.max(0, 1 - Math.pow(sa - 0.08, 2)), 0.9);
            const vt = v + 0.055 * s;
            const vc = 0.03 * cl;
            const vl = vc + (HL * cl - vc) * (0.35 + 0.65 * ou);
            const vu = vl + (-HU * cu - vl) * ou;

            const duIn = vt - vu;
            const dlIn = vl - vt;
            const dIn = Math.min(duIn, dlIn);
            const insideEye = ss(-0.015, 0.02, dIn);

            // iris
            const rn = Math.max(0, Math.min(1.3, (r - Rp) / (RI - Rp)));
            const ang = (Math.atan2(pmV, pmU) / (Math.PI * 2) + 1) % 1;
            const fib = 0.55 * fbm(ang * 18 + 2, rn * 9, 3, 2) + 0.45 * fbm(ang * 28, rn * 6, 2, 8);
            const zig = Math.abs(((ang * 34) % 1) - 0.5) * 2 - 0.5;
            const cr = 0.34 + 0.18 * (fbm(ang * 8, 0.5, 2, 4) - 0.5) + 0.03 * zig;
            const mm = ss(-0.08, 0.20, rn - cr);

            let irR = mix(0.80, 0.42, mm);
            let irG = mix(0.45, 0.20, mm);
            let irB = mix(0.10, 0.06, mm);
            irR *= 0.5 + 1.0 * fib;
            irG *= 0.5 + 1.0 * fib;
            irB *= 0.5 + 1.0 * fib;

            // collarette highlight
            const ring = Math.exp(-Math.pow((rn - cr) / 0.065, 2));
            irR += 0.18 * ring * (0.3 + fib);
            irG += 0.09 * ring * (0.3 + fib);

            // darken outer iris
            const outer = ss(0.55, 1.05, rn);
            irR *= 1 - 0.75 * outer;
            irG *= 1 - 0.75 * outer;
            irB *= 1 - 0.75 * outer;

            // sclera
            const cw = ss(0.35, 0.95, Math.abs(s));
            let sh = (0.40 + 0.60 * ss(0, 0.20, duIn)) * (0.75 + 0.25 * ss(0, 0.09, dlIn));
            sh *= 1 - 0.28 * cw;
            let scR = 0.80 * sh;
            let scG = 0.82 * sh;
            let scB = 0.86 * sh;
            // slight redness near corners
            scR = mix(scR, 0.86 * sh, cw * 0.32);
            scG = mix(scG, 0.48 * sh, cw * 0.32);
            scB = mix(scB, 0.44 * sh, cw * 0.32);

            // veins
            const vein = Math.max(0, (fbm(u * 55 + 20, v * 55 + 40, 3, 6) - 0.72) * 4.5) * (0.3 + 0.7 * cw);
            scR = mix(scR, 0.60, vein * 0.55);
            scG = mix(scG, 0.14, vein * 0.55);
            scB = mix(scB, 0.13, vein * 0.55);

            // combine sclera / iris
            const irisMask = ss(RI + 0.01, RI - 0.015, r);
            let eR = mix(scR, irR, irisMask);
            let eG = mix(scG, irG, irisMask);
            let eB = mix(scB, irB, irisMask);

            // catchlights
            const fade = Math.max(0, Math.min(1, 1 - (z - 1.5) / 2.2));
            if (fade > 0.01) {
              const d1 = Math.hypot(pmU - 0.07, pmV + 0.035);
              const d2 = Math.hypot(pmU + 0.04, pmV - 0.045);
              const win = Math.max(0, 1 - (d1 - 0.028) / 0.018);
              const win2 = Math.max(0, 1 - (d2 - 0.012) / 0.014) * 0.45;
              eR += (win + win2) * fade * 1.25;
              eG += (win + win2) * fade * 1.22;
              eB += (win + win2) * fade * 1.18;
            }

            // pupil already handled earlier – blend with space content
            const pupilMask = ss(Rp + 0.012, Rp - 0.008, r);
            eR = mix(eR, rCol, pupilMask);
            eG = mix(eG, gCol, pupilMask);
            eB = mix(eB, bCol, pupilMask);

            // skin / lids
            const mid = 0.5 * (vu + vl);
            const upper = vt < mid;
            const du = Math.max(vu - vt, 0);
            const dl = Math.max(vt - vl, 0);
            const dd = upper ? du : dl;

            const tx = fbm(u * 90 + 30, v * 90 + 20, 3, 9);
            let skR = 0.62 * (0.88 + 0.22 * tx);
            let skG = 0.40 * (0.88 + 0.22 * tx);
            let skB = 0.29 * (0.88 + 0.22 * tx);

            let skinSh = 0.52 + 0.48 * ss(0, 0.28, dd);
            skinSh *= 1 + 0.09 * Math.exp(-Math.pow((v + 0.18) / 0.09, 2));
            const crPos = 0.07 + 0.025 * (1 - ou);
            skinSh *= 1 - 0.40 * Math.exp(-Math.pow((du - crPos) / 0.018, 2)) * (upper ? 1 : 0);

            skR *= skinSh;
            skG *= skinSh;
            skB *= skinSh;

            // eyebrow
            const sb = Math.max(0, 1 - Math.abs(s));
            const eb = Math.exp(-Math.pow((vt + 0.40 + 0.09 * s * s) / (0.038 + 0.012 * sb), 2));
            const hair = 0.5 + 0.9 * valueNoise2D(u * 70, v * 25, 14);
            const ebAmt = Math.min(0.9, eb * hair);
            skR = mix(skR, 0.11, ebAmt);
            skG = mix(skG, 0.07, ebAmt);
            skB = mix(skB, 0.045, ebAmt);

            // lid line
            const line = Math.exp(-Math.pow(du / 0.009, 2)) * (upper ? 1 : 0);
            skR = mix(skR, 0.05, line * 0.85);
            skG = mix(skG, 0.03, line * 0.85);
            skB = mix(skB, 0.022, line * 0.85);

            // blend eye interior vs skin
            rCol = mix(skR, eR, insideEye);
            gCol = mix(skG, eG, insideEye);
            bCol = mix(skB, eB, insideEye);
          }

          // final tone map + slight vignette
          const vign = 0.65 + 0.35 * ss(0.55, 0.15, Math.hypot(u0, v0));
          rCol = 1 - Math.exp(-2.1 * Math.max(0, rCol) * vign);
          gCol = 1 - Math.exp(-2.1 * Math.max(0, gCol) * vign);
          bCol = 1 - Math.exp(-2.1 * Math.max(0, bCol) * vign);

          // fade in at start
          const fadeIn = ease(t / 1.1);
          rCol *= fadeIn;
          gCol *= fadeIn;
          bCol *= fadeIn;

          brightness = 0.3 * rCol + 0.55 * gCol + 0.15 * bCol;
          const charIdx = Math.max(0, Math.min(NR, Math.floor(Math.pow(brightness, 0.72) * NR)));
          const ch = RAMP[charIdx];

          // draw character
          const px = col * CELL;
          const py = row * CELL;

          // background is already dark; just draw the glyph
          ctx.fillStyle = `rgb(${Math.floor(rCol * 255)},${Math.floor(gCol * 255)},${Math.floor(bCol * 255)})`;
          ctx.font = `bold ${CELL}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, px + CELL / 2, py + CELL / 2 + 0.5);
        }
      }
    }

    let last = 0;
    const loop = (now: number) => {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      // run at ~28 fps for smoothness vs cost
      if (now - last > 1000 / 28) {
        render(t);
        last = now;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    startRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [width, height, restartKey]);

  return (
    <div
      className={className}
      style={{
        display: "inline-block",
        background: "#020306",
        borderRadius: 8,
        overflow: "hidden",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}
