/**
 * ASCII Fire Footer - Vanilla JavaScript Implementation
 * Converted from React component to work with plain HTML/CSS
 */

(function() {
  'use strict';

  // ========== CONSTANTS ==========
  const FONT_SIZE = 9;
  const FPS = 28;

  const CHARSETS = {
    classic: " .:-=+*#%@",
    dense: " `.^,:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    blocks: " ░▒▓█",
    minimal: " .:*#",
  };

  const COLOR_PALETTE = [
    "#411205",
    "#7c2105",
    "#b93608",
    "#e85b0c",
    "#ff8b18",
    "#ffc247",
    "#fff1aa",
  ];

  const MONO_PALETTE = [
    "#181818",
    "#303030",
    "#505050",
    "#787878",
    "#a8a8a8",
    "#d8d8d8",
    "#ffffff",
  ];

  const DEFAULT_CONFIG = {
    intensity: 92,
    windDirection: "right",
    windForce: 22,
    decay: 9,
    turbulence: 42,
    thickness: 2.6,
    embers: true,
    sparks: true,
    pulse: false,
    palette: "custom",
    charset: "dense",
    backgroundColor: "#000000",
    shades: COLOR_PALETTE,
    sparkColor: "#FF3030",
  };

  // ========== UTILITY FUNCTIONS ==========
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function resolveWind(direction, force) {
    const amount = clamp(force, 10, 100);
    return direction === "left" ? -amount : amount;
  }

  function resolveCharacters(charsetName) {
    return CHARSETS[charsetName] || CHARSETS.classic;
  }

  function resolvePalette(paletteMode, customShades) {
    if (paletteMode === "color") return COLOR_PALETTE;
    if (paletteMode === "custom") {
      return customShades && customShades.length > 0 ? customShades : COLOR_PALETTE;
    }
    if (paletteMode === "mono") return MONO_PALETTE;
    return MONO_PALETTE;
  }

  function escapeHtml(char) {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return char;
  }

  // ========== FIRE SIMULATION ==========
  function seedFuel(heat, columns, rows, config, elapsedSeconds) {
    const pulseMultiplier = config.pulse
      ? 0.88 + Math.sin(elapsedSeconds * 2.2) * 0.12
      : 1;
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

  function propagateFire(heat, nextHeat, columns, rows, config) {
    nextHeat.fill(0);
    const windOffset = config.wind / 50;
    const turbulence = config.turbulence / 100;
    const cooling = config.decay / 1000;

    for (let row = 0; row < rows - 1; row++) {
      for (let column = 0; column < columns; column++) {
        const randomDrift = (Math.random() - 0.5) * (1.5 + turbulence * 5);
        const sourceColumn = clamp(
          Math.round(column - windOffset + randomDrift),
          0,
          columns - 1
        );
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

  function updateParticles(particles, columns, rows, config) {
    const updatedParticles = particles
      .map(particle => ({
        ...particle,
        x: particle.x + particle.velocityX + config.wind / 500,
        y: particle.y + particle.velocityY,
        velocityX: particle.velocityX + (Math.random() - 0.5) * (config.turbulence / 300),
        heat: particle.heat * (particle.kind === "spark" ? 0.985 : 0.94),
        life: particle.life - 1,
      }))
      .filter(
        particle =>
          particle.life > 0 &&
          particle.y >= 0 &&
          particle.x >= 0 &&
          particle.x < columns
      );

    const sourceColumns = Array.from({ length: columns }, (_, i) => i);
    
    function spawnParticle(isSpark) {
      const sourceColumn = sourceColumns[Math.floor(Math.random() * sourceColumns.length)] || 0;
      const life = isSpark ? 20 + Math.random() * 24 : 22 + Math.random() * 28;
      updatedParticles.push({
        kind: isSpark ? "spark" : "ember",
        glyph: isSpark ? (Math.random() < 0.5 ? "'" : "|") : ".",
        x: sourceColumn + (Math.random() - 0.5) * 2,
        y: rows - Math.max(2, config.thickness),
        velocityX: (Math.random() - 0.5) * (isSpark ? 0.45 : 0.16),
        velocityY: isSpark
          ? -(0.8 + Math.random() * 0.8)
          : -(0.16 + Math.random() * 0.24),
        heat: isSpark ? 1.2 : 0.76,
        life: life,
        maxLife: life,
      });
    }

    if (config.embers && Math.random() < 0.2 * 2.4) spawnParticle(false);
    if (config.sparks && Math.random() < 0.07 * 2.4) spawnParticle(true);

    return updatedParticles.slice(-Math.max(40, Math.round(columns * 1.5)));
  }

  function renderFire(element, heat, particles, columns, rows, charsetName, palette, sparkColor) {
    const displayHeat = new Float32Array(heat);
    const particleGlyphs = new Map();
    const safePalette = palette && palette.length > 0 ? palette : MONO_PALETTE;
    const resolvedSparkColor = sparkColor || safePalette[safePalette.length - 1];

    for (const particle of particles) {
      const column = clamp(Math.round(particle.x), 0, columns - 1);
      const row = clamp(Math.round(particle.y), 0, rows - 1);
      const fade = particle.life / particle.maxLife;
      const index = row * columns + column;
      displayHeat[index] = Math.max(displayHeat[index], particle.heat * fade);
      if (particle.kind === "spark" || !particleGlyphs.has(index)) {
        particleGlyphs.set(index, {
          color: particle.kind === "spark" ? resolvedSparkColor : safePalette[Math.max(0, safePalette.length - 3)],
          glyph: particle.glyph,
        });
      }
    }

    const characters = resolveCharacters(charsetName);
    const lines = [];

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
          characters.length - 1
        );
        const paletteIndex = clamp(
          Math.floor(Math.pow(value, 0.72) * (safePalette.length - 1)),
          0,
          safePalette.length - 1
        );
        const color = particleGlyph?.color ?? (value < 0.025 ? "" : safePalette[paletteIndex]);
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

  // ========== ASCII FIRE CLASS ==========
  class AsciiFire {
    constructor(container, output, options = {}) {
      this.container = container;
      this.output = output;
      this.options = { ...DEFAULT_CONFIG, ...options };
      
      this.wind = resolveWind(this.options.windDirection, this.options.windForce);
      this.palette = resolvePalette(this.options.palette, this.options.shades);
      this.sparkColor = this.options.palette === "custom" 
        ? this.options.sparkColor 
        : this.palette[this.palette.length - 1];

      this.columns = 1;
      this.rows = 1;
      this.heat = new Float32Array(1);
      this.nextHeat = new Float32Array(1);
      this.particles = [];
      this.previousFrameTime = 0;
      this.startTime = performance.now();
      this.animationFrameId = 0;
      this.isActive = true;

      this.config = {
        intensity: this.options.intensity,
        wind: this.wind,
        decay: this.options.decay,
        turbulence: this.options.turbulence,
        thickness: this.options.thickness,
        embers: this.options.embers,
        sparks: this.options.sparks,
        pulse: this.options.pulse,
      };

      this.measurementContext = document.createElement("canvas").getContext("2d");
      this.reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

      this.init();
    }

    init() {
      this.handleResize = this.handleResize.bind(this);
      this.drawFrame = this.drawFrame.bind(this);
      this.handleMotionPreferenceChange = this.handleMotionPreferenceChange.bind(this);

      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(this.container);
      
      this.handleResize();
      
      if (document.fonts) {
        document.fonts.ready.then(() => {
          if (this.isActive) this.handleResize();
        });
      }

      this.animationFrameId = window.requestAnimationFrame(this.drawFrame);
      this.reducedMotionQuery.addEventListener("change", this.handleMotionPreferenceChange);
    }

    handleResize() {
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
        this.options.charset,
        this.palette,
        this.sparkColor
      );
    }

    drawFrame(timestamp) {
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
          this.options.charset,
          this.palette,
          this.sparkColor
        );
        this.previousFrameTime = timestamp - (elapsedSinceFrame % frameInterval);
      }

      if (this.reducedMotionQuery.matches) return;
      this.animationFrameId = window.requestAnimationFrame(this.drawFrame);
    }

    handleMotionPreferenceChange() {
      window.cancelAnimationFrame(this.animationFrameId);
      this.previousFrameTime = 0;
      this.startTime = performance.now();
      this.animationFrameId = window.requestAnimationFrame(this.drawFrame);
    }

    destroy() {
      this.isActive = false;
      window.cancelAnimationFrame(this.animationFrameId);
      this.resizeObserver.disconnect();
      this.reducedMotionQuery.removeEventListener("change", this.handleMotionPreferenceChange);
    }
  }

  // ========== INITIALIZE ==========
  function initFooter() {
    const footerElement = document.getElementById("ascii-fire-footer");
    if (!footerElement) return;

    const container = footerElement.querySelector(".fire-container");
    const output = footerElement.querySelector(".fire-output");
    
    if (container && output) {
      new AsciiFire(container, output);
    }
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFooter);
  } else {
    initFooter();
  }

  // Expose for manual initialization if needed
  window.AsciiFire = AsciiFire;
})();
