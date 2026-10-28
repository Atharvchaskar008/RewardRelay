/**
 * AsciiEye - Vanilla JavaScript Implementation
 * Eye → Space animation with heart nebula
 * Converted from React component
 */

(function() {
  'use strict';

  const RAMP = " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
  const NR = RAMP.length - 1;

  // Simple seeded random
  function mulberry32(a) {
    return function() {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(42);

  function ss(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function ease(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }

  function mix(a, b, k) {
    return a + (b - a) * k;
  }

  function mix3(a, b, k) {
    return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
  }

  function valueNoise2D(x, y, seed = 0) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const hash = (i, j) => {
      const n = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
      return n - Math.floor(n);
    };

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    return mix(mix(a, b, ux), mix(c, d, ux), uy);
  }

  function fbm(x, y, octaves = 4, seed = 0) {
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

  function heartSDF(hx, hy) {
    const x = hx;
    const y = -hy + 0.15;
    const a = x * x + y * y - 1;
    return a * a * a - x * x * y * y * y;
  }

  // Signed distance for an equilateral triangular frame (MST logo)
  function logoSDF(px, py) {
    const s = 0.92;
    const x = px * s;
    const y = py * s + 0.08;

    const k = Math.sqrt(3.0);
    const q = [Math.abs(x), y];

    let dOuter = -q[1] * 0.5 + q[0] * 0.5 * k;
    dOuter = Math.max(dOuter, q[1] - 0.55);

    const outer = dOuter;

    const innerScale = 0.55;
    const ix = x / innerScale;
    const iy = (y + 0.02) / innerScale;
    const iq = [Math.abs(ix), iy];
    let dInner = -iq[1] * 0.5 + iq[0] * 0.5 * k;
    dInner = Math.max(dInner, iq[1] - 0.55);
    dInner = dInner * innerScale;

    let frame = Math.max(outer, -dInner - 0.02);

    return frame;
  }

  class AsciiEye {
    constructor(container, width, height) {
      this.container = container;
      this.width = width;
      this.height = height;
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.rafId = 0;
      this.startTime = 0;
      this.lastFrame = 0;
      this.isActive = true;

      this.CELL = 7;
      this.COLS = Math.floor(width / this.CELL);
      this.ROWS = Math.floor(height / this.CELL);

      this.canvas.width = this.COLS * this.CELL;
      this.canvas.height = this.ROWS * this.CELL;
      this.canvas.style.display = 'block';
      this.canvas.style.width = '100%';
      this.canvas.style.height = 'auto';
      this.canvas.style.imageRendering = 'pixelated';

      this.container.appendChild(this.canvas);

      // Timeline constants
      this.T_OPEN = 0.5;
      this.T_OPEN_D = 1.5;
      this.T_BLINK = 2.5;
      this.T_Z0 = 3.5;
      this.T_ZD = 12.0;
      this.ZEND = 14.0;
      this.T_SPACE = this.T_Z0 + 1.5;
      this.T_LOGO = this.T_Z0 + 2.5;
      this.T_LOGO_D = 10.0;

      this.WO = 0.78;
      this.HU = 0.30;
      this.HL = 0.20;
      this.RI = 0.27;
      this.RP0 = 0.098;

      this.init();
    }

    blinkAmount(t) {
      const d = t - this.T_BLINK;
      if (d < 0 || d > 0.36) return 0;
      if (d < 0.09) return ease(d / 0.09);
      if (d < 0.12) return 1;
      return 1 - ease((d - 0.12) / 0.24);
    }

    lidOpen(t) {
      let k = ease((t - this.T_OPEN) / this.T_OPEN_D);
      k = k * (1 + 0.035 * Math.sin(Math.PI * k));
      return Math.min(1, k) * (1 - 0.985 * this.blinkAmount(t));
    }

    zoomProgress(t) {
      return ease((t - this.T_Z0) / this.T_ZD);
    }

    render(t) {
      const prog = this.zoomProgress(t);
      const z = Math.exp(Math.log(this.ZEND) * prog) * (1 + 0.04 * ease(t / this.T_Z0));
      const ou = this.lidOpen(t);

      const gx = 0.012 * Math.sin(t * 0.7) * (1 - prog * 0.7);
      const gy = 0.008 * Math.sin(t * 0.55 + 1.2) * (1 - prog * 0.7) - 0.025 * this.blinkAmount(t);

      const Rp = this.RP0 * (0.78 + 0.22 * ease((t - 1.8) / 3.2)) * (1 + 0.22 * prog);

      this.ctx.fillStyle = "#020306";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      const starAmt = ease((t - (this.T_Z0 + 1.2)) / 3.5);
      const nebAmt = ease((t - (this.T_Z0 + 3.0)) / 6.0);
      const logoMorph = ease((t - this.T_LOGO) / this.T_LOGO_D);

      const invZ = 1 / z;

      for (let row = 0; row < this.ROWS; row++) {
        for (let col = 0; col < this.COLS; col++) {
          const u0 = ((col + 0.5) / this.COLS - 0.5) * (this.COLS / this.ROWS) * 1.05;
          const v0 = (row + 0.5) / this.ROWS - 0.5;

          const u = u0 * invZ;
          const v = v0 * invZ;

          const pmU = u - gx;
          const pmV = v - gy;
          const r = Math.sqrt(pmU * pmU + pmV * pmV);

          let rCol = 0.01, gCol = 0.012, bCol = 0.025;
          let brightness = 0.02;

          const near = z < 3.6;

          if (r < Rp * 1.15 || !near) {
            rCol = 0.008;
            gCol = 0.01;
            bCol = 0.025;

            if (starAmt > 0.01) {
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

            if (nebAmt > 0.01) {
              const scale = 0.21 * (0.88 + 0.18 * Math.sin(t * 1.6) * logoMorph * logoMorph);
              const lx = (u0 - gx * 0.35) / scale;
              const ly = (v0 - gy * 0.35) / scale;

              const nC = fbm(lx * 1.7 + 2.8, ly * 1.7 + 1.4, 3, 11);
              const nD = fbm(lx * 1.5 + 7.5, ly * 1.5 + 3.9, 3, 19);
              const wob = 1 - 0.72 * logoMorph;
              const lxw = lx + wob * 0.32 * (nC - 0.5);
              const lyw = ly + wob * 0.32 * (nD - 0.5);

              const qc = Math.sqrt(lxw * lxw + lyw * lyw) / 0.80 - 1.0;
              const ql = logoSDF(lxw, lyw);
              const q = mix(qc, ql, logoMorph);

              const inside = Math.max(0, Math.min(1, -q / 0.55));
              let body = q < 0 ? 0.55 + 0.45 * Math.sqrt(inside) : Math.exp(-Math.max(0, q) * 3.4) * 0.38;

              const tex = 0.78 + 0.45 * fbm(lxw * 4.2 + t * 0.12, lyw * 4.2, 3, 5);
              body *= mix(tex, 1.0, logoMorph * 0.7);

              const deep = [0.72, 0.05, 0.08];
              const bright = [1.0, 0.18, 0.14];
              const mid = [0.92, 0.10, 0.10];
              const hcol = mix3(deep, bright, Math.pow(inside, 0.65));
              const finalCol = mix3(hcol, mid, logoMorph * 0.35);

              const halo = Math.exp(-Math.max(0, q) * 1.7) * 0.22 * (0.55 + nC);

              const edge = Math.exp(-Math.pow(q + 0.02, 2) / 0.012) * logoMorph;

              rCol += (body * finalCol[0] + halo * 0.85 + edge * 0.9) * nebAmt * 1.25;
              gCol += (body * finalCol[1] + halo * 0.08 + edge * 0.12) * nebAmt * 1.25;
              bCol += (body * finalCol[2] + halo * 0.08 + edge * 0.10) * nebAmt * 1.25;
            }

            const edge = ss(Rp * 0.92, Rp * 1.08, r);
            rCol *= 1 - 0.55 * edge;
            gCol *= 1 - 0.55 * edge;
            bCol *= 1 - 0.55 * edge;
          }

          if (near) {
            const s = u / this.WO;
            const sa = Math.max(-1.3, Math.min(1.3, s));
            const wu = sa < -0.12 ? 0.88 : 1.12;
            const cu = Math.pow(Math.max(0, 1 - Math.pow((sa + 0.12) / wu, 2)), 0.8);
            const cl = Math.pow(Math.max(0, 1 - Math.pow(sa - 0.08, 2)), 0.9);
            const vt = v + 0.055 * s;
            const vc = 0.03 * cl;
            const vl = vc + (this.HL * cl - vc) * (0.35 + 0.65 * ou);
            const vu = vl + (-this.HU * cu - vl) * ou;

            const duIn = vt - vu;
            const dlIn = vl - vt;
            const dIn = Math.min(duIn, dlIn);
            const insideEye = ss(-0.015, 0.02, dIn);

            const rn = Math.max(0, Math.min(1.3, (r - Rp) / (this.RI - Rp)));
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

            const ring = Math.exp(-Math.pow((rn - cr) / 0.065, 2));
            irR += 0.18 * ring * (0.3 + fib);
            irG += 0.09 * ring * (0.3 + fib);

            const outer = ss(0.55, 1.05, rn);
            irR *= 1 - 0.75 * outer;
            irG *= 1 - 0.75 * outer;
            irB *= 1 - 0.75 * outer;

            const cw = ss(0.35, 0.95, Math.abs(s));
            let sh = (0.40 + 0.60 * ss(0, 0.20, duIn)) * (0.75 + 0.25 * ss(0, 0.09, dlIn));
            sh *= 1 - 0.28 * cw;
            let scR = 0.80 * sh;
            let scG = 0.82 * sh;
            let scB = 0.86 * sh;
            scR = mix(scR, 0.86 * sh, cw * 0.32);
            scG = mix(scG, 0.48 * sh, cw * 0.32);
            scB = mix(scB, 0.44 * sh, cw * 0.32);

            const vein = Math.max(0, (fbm(u * 55 + 20, v * 55 + 40, 3, 6) - 0.72) * 4.5) * (0.3 + 0.7 * cw);
            scR = mix(scR, 0.60, vein * 0.55);
            scG = mix(scG, 0.14, vein * 0.55);
            scB = mix(scB, 0.13, vein * 0.55);

            const irisMask = ss(this.RI + 0.01, this.RI - 0.015, r);
            let eR = mix(scR, irR, irisMask);
            let eG = mix(scG, irG, irisMask);
            let eB = mix(scB, irB, irisMask);

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

            const pupilMask = ss(Rp + 0.012, Rp - 0.008, r);
            eR = mix(eR, rCol, pupilMask);
            eG = mix(eG, gCol, pupilMask);
            eB = mix(eB, bCol, pupilMask);

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

            const sb = Math.max(0, 1 - Math.abs(s));
            const eb = Math.exp(-Math.pow((vt + 0.40 + 0.09 * s * s) / (0.038 + 0.012 * sb), 2));
            const hair = 0.5 + 0.9 * valueNoise2D(u * 70, v * 25, 14);
            const ebAmt = Math.min(0.9, eb * hair);
            skR = mix(skR, 0.11, ebAmt);
            skG = mix(skG, 0.07, ebAmt);
            skB = mix(skB, 0.045, ebAmt);

            const line = Math.exp(-Math.pow(du / 0.009, 2)) * (upper ? 1 : 0);
            skR = mix(skR, 0.05, line * 0.85);
            skG = mix(skG, 0.03, line * 0.85);
            skB = mix(skB, 0.022, line * 0.85);

            rCol = mix(skR, eR, insideEye);
            gCol = mix(skG, eG, insideEye);
            bCol = mix(skB, eB, insideEye);
          }

          const vign = 0.65 + 0.35 * ss(0.55, 0.15, Math.hypot(u0, v0));
          rCol = 1 - Math.exp(-2.1 * Math.max(0, rCol) * vign);
          gCol = 1 - Math.exp(-2.1 * Math.max(0, gCol) * vign);
          bCol = 1 - Math.exp(-2.1 * Math.max(0, bCol) * vign);

          const fadeIn = ease(t / 1.1);
          rCol *= fadeIn;
          gCol *= fadeIn;
          bCol *= fadeIn;

          brightness = 0.3 * rCol + 0.55 * gCol + 0.15 * bCol;
          const charIdx = Math.max(0, Math.min(NR, Math.floor(Math.pow(brightness, 0.72) * NR)));
          const ch = RAMP[charIdx];

          const px = col * this.CELL;
          const py = row * this.CELL;

          this.ctx.fillStyle = `rgb(${Math.floor(rCol * 255)},${Math.floor(gCol * 255)},${Math.floor(bCol * 255)})`;
          this.ctx.font = `bold ${this.CELL}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
          this.ctx.textAlign = "center";
          this.ctx.textBaseline = "middle";
          this.ctx.fillText(ch, px + this.CELL / 2, py + this.CELL / 2 + 0.5);
        }
      }
    }

    loop(now) {
      if (!this.isActive) return;
      
      if (!this.startTime) this.startTime = now;
      const t = (now - this.startTime) / 1000;

      // Loop duration: 15 seconds (faster)
      const LOOP_DURATION = 15;
      if (t >= LOOP_DURATION) {
        this.startTime = now; // Restart
      }

      if (now - this.lastFrame > 1000 / 28) {
        const currentTime = (now - this.startTime) / 1000;
        this.render(currentTime);
        this.lastFrame = now;
      }

      this.rafId = requestAnimationFrame((time) => this.loop(time));
    }

    init() {
      this.rafId = requestAnimationFrame((time) => this.loop(time));
    }

    destroy() {
      this.isActive = false;
      cancelAnimationFrame(this.rafId);
    }
  }

  function initAsciiEye() {
    const container = document.getElementById('ascii-eye-container');
    if (!container) return;

    const width = 840;
    const height = 560;
    
    new AsciiEye(container, width, height);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAsciiEye);
  } else {
    initAsciiEye();
  }

  window.AsciiEye = AsciiEye;
})();
