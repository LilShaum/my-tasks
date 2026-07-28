// @ts-check
/**
 * particles.js — celebration particles, hand-rolled.
 *
 * Original rather than a confetti library, for two reasons: a dependency would
 * be the app's only one, and each theme throws its own shape (hearts, petals,
 * stars, bubbles, droplets, bolts, crumbs) which off-the-shelf confetti won't
 * do.
 *
 * Rules this obeys:
 *   - Never fires for reduced-motion users. Decorative motion is removed, not
 *     slowed.
 *   - Capped at 80 particles, which holds 60fps on mid-range phones.
 *   - Canvas is fixed, pointer-events:none, aria-hidden. It is decoration and
 *     never the feedback — callers announce the real thing separately.
 *   - Only for user milestones (a log saved, a streak reached). Never for a
 *     clinical event. See design rule 2.
 */

import { reducedMotion } from '../utils/dom.js';

const MAX_PARTICLES = 80;
const GRAVITY = 0.28;
const DRAG = 0.988;

/**
 * @typedef {Object} Particle
 * @property {number} x @property {number} y
 * @property {number} vx @property {number} vy
 * @property {number} rot @property {number} vrot
 * @property {number} size @property {number} life @property {number} maxLife
 * @property {string} color @property {string} shape
 */

/** @type {HTMLCanvasElement|null} */
let canvas = null;
/** @type {CanvasRenderingContext2D|null} */
let ctx = null;
/** @type {Particle[]} */
let particles = [];
/** @type {number|null} */
let frame = null;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'particle-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: '120',
  });
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * Read the active theme's colours so particles belong to the palette.
 * @returns {string[]}
 */
function themeColors() {
  const style = getComputedStyle(document.documentElement);
  return ['--primary', '--accent', '--primary-soft', '--accent-soft']
    .map((token) => style.getPropertyValue(token).trim())
    .filter(Boolean);
}

/**
 * Throw a burst.
 * @param {Object} [opts]
 * @param {string} [opts.shape]  heart|petal|star|bubble|drop|bolt|crumb|none
 * @param {number} [opts.count]
 * @param {number} [opts.x]      origin, px; defaults to screen centre
 * @param {number} [opts.y]
 * @param {number} [opts.spread] radians
 */
export function burst(opts = {}) {
  const {
    shape = 'heart',
    count = 46,
    x = window.innerWidth / 2,
    y = window.innerHeight * 0.42,
    spread = Math.PI * 1.5,
  } = opts;

  if (shape === 'none') return;
  if (reducedMotion()) return;

  ensureCanvas();
  const colors = themeColors();
  if (!colors.length) return;

  const n = Math.min(count, MAX_PARTICLES - particles.length);
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
    const speed = 5 + Math.random() * 7;
    const maxLife = 60 + Math.random() * 45;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.22,
      size: 6 + Math.random() * 8,
      life: maxLife,
      maxLife,
      color: colors[(Math.random() * colors.length) | 0],
      shape,
    });
  }

  if (frame == null) frame = requestAnimationFrame(tick);
}

function tick() {
  if (!ctx || !canvas) { frame = null; return; }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of particles) {
    p.vy += GRAVITY;
    p.vx *= DRAG;
    p.vy *= DRAG;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vrot;
    p.life--;

    // Fade over the last third of life so nothing pops out of existence.
    const fade = Math.min(1, p.life / (p.maxLife * 0.34));
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    drawShape(ctx, p.shape, p.size);
    ctx.restore();
  }

  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 60);

  if (particles.length) {
    frame = requestAnimationFrame(tick);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame = null;
  }
}

/**
 * @param {CanvasRenderingContext2D} c
 * @param {string} shape
 * @param {number} s
 */
function drawShape(c, shape, s) {
  switch (shape) {
    case 'heart': {
      const r = s / 2;
      c.beginPath();
      c.moveTo(0, r * 0.7);
      c.bezierCurveTo(-r * 1.4, -r * 0.4, -r * 0.5, -r * 1.5, 0, -r * 0.55);
      c.bezierCurveTo(r * 0.5, -r * 1.5, r * 1.4, -r * 0.4, 0, r * 0.7);
      c.fill();
      break;
    }
    case 'petal': {
      c.beginPath();
      c.ellipse(0, 0, s * 0.34, s * 0.62, 0, 0, Math.PI * 2);
      c.fill();
      break;
    }
    case 'star': {
      const spikes = 5;
      const outer = s * 0.6;
      const inner = outer * 0.44;
      c.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const radius = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI / spikes) * i - Math.PI / 2;
        c.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      c.closePath();
      c.fill();
      break;
    }
    case 'bubble': {
      c.lineWidth = Math.max(1.4, s * 0.16);
      c.beginPath();
      c.arc(0, 0, s * 0.46, 0, Math.PI * 2);
      c.stroke();
      break;
    }
    case 'drop': {
      const r = s * 0.42;
      c.beginPath();
      c.moveTo(0, -r * 1.5);
      c.bezierCurveTo(r * 1.1, -r * 0.2, r, r, 0, r);
      c.bezierCurveTo(-r, r, -r * 1.1, -r * 0.2, 0, -r * 1.5);
      c.fill();
      break;
    }
    case 'bolt': {
      const u = s * 0.28;
      c.beginPath();
      c.moveTo(u * 0.6, -u * 2);
      c.lineTo(-u, u * 0.2);
      c.lineTo(u * 0.1, u * 0.2);
      c.lineTo(-u * 0.5, u * 2);
      c.lineTo(u * 1.3, -u * 0.3);
      c.lineTo(u * 0.2, -u * 0.3);
      c.closePath();
      c.fill();
      break;
    }
    case 'crumb':
    default: {
      const half = s * 0.32;
      // roundRect is Safari 16.4+; square crumbs are a fine fallback.
      if (typeof c.roundRect === 'function') {
        c.beginPath();
        c.roundRect(-half, -half, half * 2, half * 2, half * 0.5);
        c.fill();
      } else {
        c.fillRect(-half, -half, half * 2, half * 2);
      }
      break;
    }
  }
}

/** Stop everything and clear the canvas. */
export function stopParticles() {
  particles = [];
  if (frame != null) cancelAnimationFrame(frame);
  frame = null;
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}
