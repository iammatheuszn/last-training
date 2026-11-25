import { MODES } from './modes.js';
import { accuracyOf, clamp, scoreFor } from './scoring.mjs';

const SIM_STEP = 1000 / 120;
const HUD_STEP = 100;
const GRID_POINTS = Object.freeze([
  [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
  [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
  [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]
]);

const random = (min, max) => min + Math.random() * (max - min);

function gridPoint(index) {
  const [x, y] = GRID_POINTS[index % GRID_POINTS.length];
  return { x, y };
}

export default class TrainingEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.mode = MODES[options.mode] || MODES.clicking;
    this.settings = options.settings || {};
    this.onHud = options.onHud || (() => {});
    this.onFinish = options.onFinish || (() => {});

    this.running = false;
    this.paused = false;
    this.raf = 0;
    this.lastFrame = 0;
    this.accumulator = 0;
    this.hudClock = 0;
    this.width = 0;
    this.height = 0;
    this.x = NaN;
    this.y = NaN;
    this.flash = 0;
    this.elapsedMs = 0;
    this.insideMs = 0;
    this.holdMs = 0;
    this.hits = 0;
    this.misses = 0;
    this.reactionTotalMs = 0;
    this.targets = [];
    this.active = 0;
    this.startedAt = 0;
    this.tremorMs = 0;
    this.overshootTotal = 0;
    this.targetTimeTotalMs = 0;
    this.targetCount = 0;
    this.lastSimX = NaN;
    this.lastSimY = NaN;
    this.lastDeltaX = 0;
    this.lastDeltaY = 0;

    this.handleMove = this.handleMove.bind(this);
    this.handleDown = this.handleDown.bind(this);
    this.frame = this.frame.bind(this);
    this.resize = this.resize.bind(this);

    window.addEventListener('pointermove', this.handleMove);
    this.resize();
    this.reset();
    this.render();
  }

  opacity() {
    const value = Number(this.settings.crosshairOpacity);
    return Number.isFinite(value) ? clamp(value / 100, 0.15, 1) : 0.8;
  }

  feedback() {
    const value = Number(this.settings.feedback);
    return 0.35 + (Number.isFinite(value) ? clamp(value, 0, 100) / 100 : 0.45) * 0.9;
  }

  targetScale() {
    const value = Number(this.settings.targetSize);
    return 0.045 + (Number.isFinite(value) ? clamp(value, 0, 100) / 100 : 0.68) * 0.045;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!this.running) {
      if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
        this.x = this.width / 2;
        this.y = this.height / 2;
      }
      this.render();
      return;
    }
    this.x = clamp(Number.isFinite(this.x) ? this.x : this.width / 2, 0, this.width);
    this.y = clamp(Number.isFinite(this.y) ? this.y : this.height / 2, 0, this.height);
  }

  start() {
    if (this.running) return;
    this.resize();
    this.reset();
    this.running = true;
    this.lastFrame = performance.now();
    window.addEventListener('resize', this.resize);
    this.canvas.addEventListener('pointerdown', this.handleDown);
    this.raf = requestAnimationFrame(this.frame);
    this.emitHud();
  }

  makeTarget(index = 0, overrides = {}) {
    const point = this.mode.kind === 'grid'
      ? gridPoint(index)
      : { x: random(0.12, 0.88), y: random(0.14, 0.86) };
    return {
      index,
      x: point.x,
      y: point.y,
      radiusFactor: overrides.radiusFactor ?? this.mode.radiusFactor ?? 1,
      spawnedAt: this.elapsedMs,
      expiresAt: this.mode.targetLifeMs ? this.elapsedMs + this.mode.targetLifeMs : 0
    };
  }

  reset() {
    this.paused = false;
    this.elapsedMs = 0;
    this.insideMs = 0;
    this.holdMs = 0;
    this.hits = 0;
    this.misses = 0;
    this.reactionTotalMs = 0;
    this.tremorMs = 0;
    this.overshootTotal = 0;
    this.targetTimeTotalMs = 0;
    this.targetCount = 0;
    this.lastSimX = this.x;
    this.lastSimY = this.y;
    this.lastDeltaX = 0;
    this.lastDeltaY = 0;
    this.flash = 0;
    this.accumulator = 0;
    this.hudClock = 0;
    this.startedAt = performance.now();
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
      this.x = this.width / 2;
      this.y = this.height / 2;
    }
    this.active = 0;

    if (this.mode.kind === 'switching') {
      this.targets = [this.makeTarget(0), this.makeTarget(1), this.makeTarget(2)];
      return;
    }
    if (this.mode.kind === 'grid') {
      this.targets = GRID_POINTS.map((_, index) => this.makeTarget(index));
      return;
    }
    if (this.mode.kind === 'follow') {
      this.targets = [this.makeTarget(0, { radiusFactor: 1.25 })];
      return;
    }
    if (this.mode.kind === 'stability') {
      this.targets = [{ ...this.makeTarget(0), x: 0.5, y: 0.5 }];
      return;
    }
    this.targets = [this.makeTarget(0)];
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.canvas.removeEventListener('pointerdown', this.handleDown);
    this.emitHud();
  }

  destroy() {
    this.stop();
    window.removeEventListener('pointermove', this.handleMove);
    this.onHud = () => {};
    this.onFinish = () => {};
  }

  togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    this.lastFrame = performance.now();
    this.emitHud();
  }

  handleMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    const px = Number(event.clientX);
    const py = Number(event.clientY);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    this.x = clamp(px - rect.left, 0, this.width);
    this.y = clamp(py - rect.top, 0, this.height);
    if (!this.running) this.render();
  }

  handleDown(event) {
    if (!this.running || this.paused || event.button !== 0) return;
    event.preventDefault();

    if (this.mode.continuous || this.mode.kind === 'grid') return;

    const index = this.hitIndex();
    if (this.mode.kind === 'switching') {
      if (index === this.active) {
        this.hits += 1;
        this.noteAcquired(this.targets[index]);
        this.targets[index] = this.makeTarget(index);
        this.active = (this.active + 1) % this.targets.length;
        this.flash = this.feedback();
      } else {
        this.misses += 1;
        this.noteOvershoot();
        this.flash = -this.feedback();
      }
      this.emitHud();
      return;
    }

    if (index === 0) {
      this.hits += 1;
      this.noteAcquired(this.targets[0]);
      if (this.mode.kind === 'flick') {
        this.reactionTotalMs += Math.max(0, this.elapsedMs - this.targets[0].spawnedAt);
      }
      this.targets[0] = this.makeTarget(0);
      this.flash = this.feedback();
    } else {
      this.misses += 1;
      if (this.mode.kind === 'flick') {
        this.noteOvershoot();
        this.targets[0] = this.makeTarget(0);
      }
      this.flash = -this.feedback();
    }
    this.emitHud();
  }

  radius(target = this.targets[0]) {
    const factor = target?.radiusFactor ?? this.mode.radiusFactor ?? 1;
    return Math.min(this.width, this.height) * this.targetScale() * factor;
  }

  targetPoint(target, time) {
    if (this.mode.kind === 'tracking') {
      const phase = time / 1000;
      const x = target.x + Math.sin(phase * 0.86) * 0.19 + Math.sin(phase * 1.73) * 0.045;
      const y = target.y + Math.cos(phase * 1.11) * 0.16 + Math.cos(phase * 2.07) * 0.035;
      return {
        x: clamp(x, 0.1, 0.9) * this.width,
        y: clamp(y, 0.12, 0.88) * this.height
      };
    }
    if (this.mode.kind === 'follow') {
      const phase = time / 1000;
      const x = 0.5 + Math.sin(phase * 0.72) * 0.29 + Math.sin(phase * 1.41) * 0.05;
      const y = 0.5 + Math.cos(phase * 0.93) * 0.24 + Math.sin(phase * 1.67) * 0.04;
      return { x: x * this.width, y: y * this.height };
    }
    if (this.mode.kind === 'stability') {
      return {
        x: (0.5 + Math.sin(time / 4200) * 0.008) * this.width,
        y: (0.5 + Math.cos(time / 5300) * 0.008) * this.height
      };
    }
    return { x: target.x * this.width, y: target.y * this.height };
  }

  hitIndex() {
    for (let i = 0; i < this.targets.length; i += 1) {
      const point = this.targetPoint(this.targets[i], this.elapsedMs);
      if (Math.hypot(this.x - point.x, this.y - point.y) <= this.radius(this.targets[i])) return i;
    }
    return -1;
  }

  trackTremor(dt) {
    if (!Number.isFinite(this.lastSimX) || !Number.isFinite(this.lastSimY)) {
      this.lastSimX = this.x;
      this.lastSimY = this.y;
      return;
    }
    const dx = this.x - this.lastSimX;
    const dy = this.y - this.lastSimY;
    const movement = Math.hypot(dx, dy);
    const limit = Math.max(2, this.radius() * 0.08);
    const reversal = this.lastDeltaX * dx + this.lastDeltaY * dy < 0;

    if (reversal && movement > 0.35 && movement <= limit) this.tremorMs += dt;
    this.lastSimX = this.x;
    this.lastSimY = this.y;
    this.lastDeltaX = dx;
    this.lastDeltaY = dy;
  }

  noteAcquired(target) {
    if (!target) return;
    this.targetCount += 1;
    this.targetTimeTotalMs += Math.max(0, this.elapsedMs - target.spawnedAt);
  }

  noteOvershoot() {
    const target = this.targets[this.mode.kind === 'switching' ? this.active : 0];
    if (!target) return;
    const point = this.targetPoint(target, this.elapsedMs);
    const excess = Math.max(0, Math.hypot(this.x - point.x, this.y - point.y) - this.radius(target));
    this.overshootTotal += clamp((excess / Math.max(1, this.radius(target))) * 100, 0, 2000);
  }

  step(dt) {
    if (this.paused) return;
    this.elapsedMs += dt;
    this.flash *= 0.86;
    this.trackTremor(dt);

    if (this.mode.kind === 'speed') {
      const target = this.targets[0];
      if (this.elapsedMs >= target.expiresAt) {
        this.misses += 1;
        this.flash = -this.feedback();
        this.targets[0] = this.makeTarget(0);
      }
    }

    if (this.mode.continuous && this.hitIndex() === 0) this.insideMs += dt;

    if (this.mode.kind === 'grid') {
      const point = this.targetPoint(this.targets[this.active], this.elapsedMs);
      const distance = Math.hypot(this.x - point.x, this.y - point.y);
      if (distance <= this.radius(this.targets[this.active])) {
        this.holdMs += dt;
        if (this.holdMs >= (this.mode.holdMs || 160)) {
          this.hits += 1;
          this.noteAcquired(this.targets[this.active]);
          this.holdMs = 0;
          this.active = (this.active + 1) % this.targets.length;
          this.flash = this.feedback();
        }
      } else {
        this.holdMs = 0;
      }
    }

    if (this.elapsedMs >= this.mode.durationMs) {
      this.finish();
      return;
    }

    this.hudClock += dt;
    if (this.hudClock >= HUD_STEP) {
      this.hudClock = 0;
      this.emitHud();
    }
  }

  frame(now) {
    if (!this.running) return;
    const delta = Math.min(120, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    if (!this.paused) {
      this.accumulator += delta;
      let guard = 0;
      while (this.accumulator >= SIM_STEP && this.running && guard < 16) {
        this.step(SIM_STEP);
        this.accumulator -= SIM_STEP;
        guard += 1;
      }
      if (guard >= 16) this.accumulator = 0;
    }
    this.render();
    if (this.running) this.raf = requestAnimationFrame(this.frame);
  }

  emitHud() {
    const attempts = this.mode.continuous
      ? Math.round(this.elapsedMs / 100)
      : this.hits + this.misses;
    const hits = this.mode.continuous ? Math.round(this.insideMs / 100) : this.hits;
    this.onHud({
      mode: this.mode.label,
      score: this.currentScore(),
      accuracy: accuracyOf(hits, attempts),
      hits,
      misses: this.misses,
      remainingMs: Math.max(0, this.mode.durationMs - this.elapsedMs),
      paused: this.paused,
      running: this.running
    });
  }

  currentScore() {
    return scoreFor(this.mode.id, {
      hits: this.hits,
      misses: this.misses,
      insideMs: this.insideMs,
      elapsedMs: Math.max(1, this.elapsedMs),
      reactionTotalMs: this.reactionTotalMs
    });
  }

  finish() {
    if (!this.running) return;
    this.elapsedMs = this.mode.durationMs;
    const attempts = this.mode.continuous
      ? Math.round(this.elapsedMs / 100)
      : this.hits + this.misses;
    const hits = this.mode.continuous ? Math.round(this.insideMs / 100) : this.hits;
    const result = {
      id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
      mode: this.mode.id,
      modeLabel: this.mode.label,
      category: this.mode.category,
      score: this.currentScore(),
      accuracy: Math.round(accuracyOf(hits, attempts)),
      hits,
      misses: this.misses,
      insideMs: Math.round(this.insideMs),
      reactionTotalMs: Math.round(this.reactionTotalMs),
      tremorMs: Math.round(this.tremorMs),
      overshootTotal: Math.round(this.overshootTotal),
      targetTimeTotalMs: Math.round(this.targetTimeTotalMs),
      targetCount: this.targetCount,
      elapsedMs: this.elapsedMs,
      at: new Date().toISOString()
    };
    this.stop();
    this.onFinish(result);
  }

  drawTarget(index) {
    const ctx = this.ctx;
    const target = this.targets[index];
    const point = this.targetPoint(target, this.elapsedMs);
    const radius = this.radius(target);
    const active = this.mode.kind !== 'switching' || index === this.active;
    const gridIdle = this.mode.kind === 'grid' && index !== this.active;

    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = gridIdle ? '#242424' : active ? '#f4f4f4' : '#3a3a3a';
    ctx.lineWidth = active && !gridIdle ? 2 : 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2, radius * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = gridIdle ? '#242424' : active ? '#f4f4f4' : '#3a3a3a';
    ctx.fill();

    if (active && this.mode.kind === 'switching') {
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#6e6e6e';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (this.mode.kind === 'speed' && this.mode.targetLifeMs) {
      const left = clamp(1 - (this.elapsedMs - target.spawnedAt) / this.mode.targetLifeMs, 0, 1);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.strokeStyle = '#8a8a8a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (this.mode.kind === 'grid' && index === this.active && this.holdMs > 0) {
      const progress = clamp(this.holdMs / (this.mode.holdMs || 160), 0, 1);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  renderCrosshair(opacity) {
    const ctx = this.ctx;
    const spread = 12;
    const length = 9;
    ctx.strokeStyle = `rgba(244,244,244,${opacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x - spread - length, this.y);
    ctx.lineTo(this.x - spread, this.y);
    ctx.moveTo(this.x + spread, this.y);
    ctx.lineTo(this.x + spread + length, this.y);
    ctx.moveTo(this.x, this.y - spread - length);
    ctx.lineTo(this.x, this.y - spread);
    ctx.moveTo(this.x, this.y + spread);
    ctx.lineTo(this.x, this.y + spread + length);
    ctx.stroke();

    ctx.fillStyle = `rgba(244,244,244,${opacity})`;
    ctx.fillRect(this.x - 1, this.y - 1, 2, 2);
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#121212';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= w; gx += 64) {
      ctx.moveTo(gx + 0.5, 0);
      ctx.lineTo(gx + 0.5, h);
    }
    for (let gy = 0; gy <= h; gy += 64) {
      ctx.moveTo(0, gy + 0.5);
      ctx.lineTo(w, gy + 0.5);
    }
    ctx.stroke();

    for (let i = 0; i < this.targets.length; i += 1) this.drawTarget(i);

    const opacity = this.opacity();
    this.renderCrosshair(opacity);

    if (Math.abs(this.flash) > 0.03) {
      const strength = clamp(Math.abs(this.flash), 0, 1);
      ctx.strokeStyle = this.flash > 0
        ? `rgba(244,244,244,${strength * 0.5})`
        : `rgba(120,120,120,${strength * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 18 + (1 - strength) * 20, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (this.paused) {
      ctx.fillStyle = 'rgba(5,5,5,0.72)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4f4';
      ctx.font = '500 34px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSADO', w / 2, h / 2);
    }
  }
}
