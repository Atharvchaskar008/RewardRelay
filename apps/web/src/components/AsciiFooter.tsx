"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

export default function AsciiFooter() {
  const containerRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const engineRef = useRef<AsciiFireEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current || !outputRef.current) return;

    const engine = new AsciiFireEngine(containerRef.current, outputRef.current);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <footer
      style={{
        backgroundColor: "#000000",
        color: "#ffffff",
        padding: "0",
        margin: "0",
      }}
    >
      {/* ASCII Fire Animation */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "180px",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#000000",
        }}
      >
        <pre
          ref={outputRef}
          style={{
            margin: 0,
            padding: "16px 8px",
            fontSize: "9px",
            lineHeight: "1.05",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: "pre",
            overflow: "hidden",
            backgroundColor: "transparent",
            color: "#ffffff",
          }}
        />
      </div>

      {/* Footer Content */}
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "32px 16px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "32px",
        }}
      >
        <div>
          <h3 style={{ marginBottom: "16px", fontSize: "18px", fontWeight: "bold" }}>
            RewardRelay
          </h3>
          <p style={{ fontSize: "14px", color: "#999", lineHeight: "1.6" }}>
            A trusted peer-to-peer marketplace for unused rewards and card perks, secured by smart
            contract escrow on MST Blockchain.
          </p>
        </div>

        <div>
          <h4 style={{ marginBottom: "16px", fontSize: "16px", fontWeight: "600" }}>Quick Links</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li style={{ marginBottom: "8px" }}>
              <Link
                href="/explore"
                style={{ color: "#999", textDecoration: "none", fontSize: "14px" }}
              >
                Browse Offers
              </Link>
            </li>
            <li style={{ marginBottom: "8px" }}>
              <Link
                href="/login"
                style={{ color: "#999", textDecoration: "none", fontSize: "14px" }}
              >
                Sign In
              </Link>
            </li>
            <li style={{ marginBottom: "8px" }}>
              <Link
                href="/terms"
                style={{ color: "#999", textDecoration: "none", fontSize: "14px" }}
              >
                Terms
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 style={{ marginBottom: "16px", fontSize: "16px", fontWeight: "600" }}>Connect</h4>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            <li style={{ marginBottom: "8px" }}>
              <a
                href="https://github.com/Atharvchaskar008/RewardRelay"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#999", textDecoration: "none", fontSize: "14px" }}
              >
                GitHub
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div
        style={{
          borderTop: "1px solid #333",
          padding: "24px 16px",
          textAlign: "center",
          color: "#666",
          fontSize: "14px",
        }}
      >
        <p style={{ margin: 0 }}>© 2026 RewardRelay • Built on MST Blockchain</p>
      </div>
    </footer>
  );
}

// ========== ASCII FIRE ENGINE ==========

const FONT_SIZE = 9;
const FPS = 28;

const CHARSETS = {
  classic: " .:-=+*#%@",
  dense: " `.^,:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " ░▒▓█",
  minimal: " .:*#",
};

const COLOR_PALETTE = ["#411205", "#7c2105", "#b93608", "#e85b0c", "#ff8b18", "#ffc247", "#fff1aa"];

interface FireConfig {
  intensity: number;
  wind: number;
  decay: number;
  turbulence: number;
  thickness: number;
  embers: boolean;
  sparks: boolean;
  pulse: boolean;
}

interface Particle {
  kind: "spark" | "ember";
  glyph: string;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  heat: number;
  life: number;
  maxLife: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveWind(direction: string, force: number): number {
  const amount = clamp(force, 10, 100);
  return direction === "left" ? -amount : amount;
}

function resolveCharacters(charsetName: string): string {
  return CHARSETS[charsetName as keyof typeof CHARSETS] || CHARSETS.classic;
}

function escapeHtml(char: string): string {
  if (char === "&") return "&amp;";
  if (char === "<") return "&lt;";
  if (char === ">") return "&gt;";
  return char;
}

function seedFuel(
  heat: Float32Array,
  columns: number,
  rows: number,
  config: FireConfig,
  elapsedSeconds: number,
): void {
  const pulseMultiplier = config.pulse ? 0.88 + Math.sin(elapsedSeconds * 2.2) * 0.12 : 1;
  const fuelRows = clamp(Math.round(config.thickness), 1, Math.max(1, rows - 1));
  const baseHeat = clamp(config.intensity / 100, 0.05, 1) * pulseMultiplier;

  for (let rowOffset = 0; rowOffset < fuelRows; rowOffset++) {
    const row = rows - 1 - rowOffset;
    const rowStrength = 1 - rowOffset / Math.max(fuelRows * 2, 1);

    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const flicker = 0.58 + Math.random() * 0.42;
      heat[index] = clamp(baseHeat * rowStrength * flicker, 0, 1);
    }
  }
}

function propagateFire(
  heat: Float32Array,
  nextHeat: Float32Array,
  columns: number,
  rows: number,
  config: FireConfig,
): void {
  nextHeat.fill(0);
  const windOffset = config.wind / 50;
  const turbulence = config.turbulence / 100;
  const cooling = config.decay / 1000;

  for (let row = 0; row < rows - 1; row++) {
    for (let column = 0; column < columns; column++) {
      const randomDrift = (Math.random() - 0.5) * (1.5 + turbulence * 5);
      const sourceColumn = clamp(Math.round(column - windOffset + randomDrift), 0, columns - 1);
      const rowBelow = (row + 1) * columns;
      const rowTwoBelow = Math.min(row + 2, rows - 1) * columns;
      const sideDirection = Math.random() < 0.5 ? -1 : 1;
      const side = rowBelow + clamp(sourceColumn + sideDirection, 0, columns - 1);
      const center = rowBelow + sourceColumn;
      const deep = rowTwoBelow + sourceColumn;
      let carriedHeat = heat[center] * 0.58 + heat[side] * 0.16 + heat[deep] * 0.26;
      const randomCooling = cooling * (0.2 + Math.random() * (1.3 + turbulence * 2));

      if (Math.random() < turbulence * 0.08) {
        carriedHeat *= 0.45 + Math.random() * 0.35;
      }

      nextHeat[row * columns + column] = clamp(carriedHeat - randomCooling, 0, 1);
    }
  }

  const fuelStart = Math.max(0, rows - Math.round(config.thickness));
  nextHeat.set(heat.subarray(fuelStart * columns), fuelStart * columns);
}

function updateParticles(
  particles: Particle[],
  columns: number,
  rows: number,
  config: FireConfig,
): Particle[] {
  const updatedParticles = particles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.velocityX + config.wind / 500,
      y: particle.y + particle.velocityY,
      velocityX: particle.velocityX + (Math.random() - 0.5) * (config.turbulence / 300),
      heat: particle.heat * (particle.kind === "spark" ? 0.985 : 0.94),
      life: particle.life - 1,
    }))
    .filter(
      (particle) => particle.life > 0 && particle.y >= 0 && particle.x >= 0 && particle.x < columns,
    );

  const sourceColumns = Array.from({ length: columns }, (_, i) => i);

  function spawnParticle(isSpark: boolean) {
    const sourceColumn = sourceColumns[Math.floor(Math.random() * sourceColumns.length)] || 0;
    const life = isSpark ? 20 + Math.random() * 24 : 22 + Math.random() * 28;
    updatedParticles.push({
      kind: isSpark ? "spark" : "ember",
      glyph: isSpark ? (Math.random() < 0.5 ? "'" : "|") : ".",
      x: sourceColumn + (Math.random() - 0.5) * 2,
      y: rows - Math.max(2, config.thickness),
      velocityX: (Math.random() - 0.5) * (isSpark ? 0.45 : 0.16),
      velocityY: isSpark ? -(0.8 + Math.random() * 0.8) : -(0.16 + Math.random() * 0.24),
      heat: isSpark ? 1.2 : 0.76,
      life: life,
      maxLife: life,
    });
  }

  if (config.embers && Math.random() < 0.2 * 2.4) spawnParticle(false);
  if (config.sparks && Math.random() < 0.07 * 2.4) spawnParticle(true);

  return updatedParticles.slice(-Math.max(40, Math.round(columns * 1.5)));
}

function renderFire(
  element: HTMLPreElement,
  heat: Float32Array,
  particles: Particle[],
  columns: number,
  rows: number,
  charsetName: string,
  palette: string[],
  sparkColor: string,
): void {
  const displayHeat = new Float32Array(heat);
  const particleGlyphs = new Map<
    number,
    {
      color: string;
      glyph: string;
    }
  >();

  for (const particle of particles) {
    const column = clamp(Math.round(particle.x), 0, columns - 1);
    const row = clamp(Math.round(particle.y), 0, rows - 1);
    const fade = particle.life / particle.maxLife;
    const index = row * columns + column;
    displayHeat[index] = Math.max(displayHeat[index], particle.heat * fade);
    if (particle.kind === "spark" || !particleGlyphs.has(index)) {
      particleGlyphs.set(index, {
        color: particle.kind === "spark" ? sparkColor : palette[Math.max(0, palette.length - 3)],
        glyph: particle.glyph,
      });
    }
  }

  const characters = resolveCharacters(charsetName);
  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = "";
    let activeColor = "";
    let run = "";

    function flushRun() {
      if (!run) return;
      line += activeColor ? `<span style="color:${activeColor}">${run}</span>` : run;
      run = "";
    }

    for (let column = 0; column < columns; column++) {
      const index = row * columns + column;
      const value = displayHeat[index];
      const particleGlyph = particleGlyphs.get(index);
      const characterIndex = clamp(
        Math.floor(value * (characters.length - 1)),
        0,
        characters.length - 1,
      );
      const paletteIndex = clamp(
        Math.floor(Math.pow(value, 0.72) * (palette.length - 1)),
        0,
        palette.length - 1,
      );
      const color = particleGlyph?.color ?? (value < 0.025 ? "" : palette[paletteIndex]);
      const character = particleGlyph?.glyph ?? (value < 0.025 ? " " : characters[characterIndex]);

      if (color !== activeColor) {
        flushRun();
        activeColor = color;
      }
      run += escapeHtml(character);
    }

    flushRun();
    lines.push(line);
  }

  element.innerHTML = lines.join("\n");
}

class AsciiFireEngine {
  private container: HTMLDivElement;
  private output: HTMLPreElement;
  private config: FireConfig;
  private wind: number;
  private palette: string[];
  private sparkColor: string;

  private columns = 1;
  private rows = 1;
  private heat: Float32Array;
  private nextHeat: Float32Array;
  private particles: Particle[] = [];
  private previousFrameTime = 0;
  private startTime = performance.now();
  private animationFrameId = 0;
  private isActive = true;

  private measurementContext: CanvasRenderingContext2D | null;
  private reducedMotionQuery: MediaQueryList;
  private resizeObserver!: ResizeObserver;

  constructor(container: HTMLDivElement, output: HTMLPreElement) {
    this.container = container;
    this.output = output;

    this.wind = resolveWind("right", 22);
    this.palette = COLOR_PALETTE;
    this.sparkColor = "#FF3030";

    this.heat = new Float32Array(1);
    this.nextHeat = new Float32Array(1);

    this.config = {
      intensity: 92,
      wind: this.wind,
      decay: 9,
      turbulence: 42,
      thickness: 2.6,
      embers: true,
      sparks: true,
      pulse: false,
    };

    const measurementCanvas = document.createElement("canvas");
    this.measurementContext = measurementCanvas.getContext("2d");

    this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.init();
  }

  private init(): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.handleResize();

    if (document.fonts) {
      document.fonts.ready.then(() => {
        if (this.isActive) this.handleResize();
      });
    }

    this.animationFrameId = window.requestAnimationFrame((time) => this.drawFrame(time));
    this.reducedMotionQuery.addEventListener("change", () => this.handleMotionPreferenceChange());
  }

  private handleResize(): void {
    const bounds = this.container.getBoundingClientRect();
    const width = Math.max(bounds.width, this.container.clientWidth) || 800;
    const height = Math.max(bounds.height, this.container.clientHeight) || 180;

    const fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    const lineHeight = FONT_SIZE * 1.05;

    if (this.measurementContext) {
      this.measurementContext.font = `${FONT_SIZE}px ${fontFamily}`;
    }

    const characterWidth = this.measurementContext?.measureText("M").width || FONT_SIZE * 0.6;
    const nextColumns = Math.max(1, Math.floor(width / characterWidth));
    const nextRows = Math.max(1, Math.floor(height / lineHeight));

    if (nextColumns === this.columns && nextRows === this.rows) return;

    this.columns = nextColumns;
    this.rows = nextRows;
    this.heat = new Float32Array(this.columns * this.rows);
    this.nextHeat = new Float32Array(this.columns * this.rows);
    this.particles = [];

    // Warm-up
    for (let warmUpStep = 0; warmUpStep < Math.min(this.rows, 40); warmUpStep++) {
      seedFuel(this.heat, this.columns, this.rows, this.config, warmUpStep / FPS);
      propagateFire(this.heat, this.nextHeat, this.columns, this.rows, this.config);
      [this.heat, this.nextHeat] = [this.nextHeat, this.heat];
    }

    renderFire(
      this.output,
      this.heat,
      this.particles,
      this.columns,
      this.rows,
      "dense",
      this.palette,
      this.sparkColor,
    );
  }

  private drawFrame = (timestamp: number): void => {
    const frameInterval = 1000 / FPS;
    const elapsedSinceFrame = timestamp - this.previousFrameTime;

    if (elapsedSinceFrame >= frameInterval || this.previousFrameTime === 0) {
      const elapsedSeconds = (timestamp - this.startTime) / 1000;
      seedFuel(this.heat, this.columns, this.rows, this.config, elapsedSeconds);
      propagateFire(this.heat, this.nextHeat, this.columns, this.rows, this.config);
      [this.heat, this.nextHeat] = [this.nextHeat, this.heat];
      this.particles = updateParticles(this.particles, this.columns, this.rows, this.config);
      renderFire(
        this.output,
        this.heat,
        this.particles,
        this.columns,
        this.rows,
        "dense",
        this.palette,
        this.sparkColor,
      );
      this.previousFrameTime = timestamp - (elapsedSinceFrame % frameInterval);
    }

    if (this.reducedMotionQuery.matches) return;
    this.animationFrameId = window.requestAnimationFrame(this.drawFrame);
  };

  private handleMotionPreferenceChange(): void {
    window.cancelAnimationFrame(this.animationFrameId);
    this.previousFrameTime = 0;
    this.startTime = performance.now();
    this.animationFrameId = window.requestAnimationFrame(this.drawFrame);
  }

  public destroy(): void {
    this.isActive = false;
    window.cancelAnimationFrame(this.animationFrameId);
    this.resizeObserver.disconnect();
    this.reducedMotionQuery.removeEventListener("change", () =>
      this.handleMotionPreferenceChange(),
    );
  }
}
