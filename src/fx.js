const MUTE_KEY = 'ogv:mute';
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let ctx = null;
let master = null;

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(muted) {
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  window.dispatchEvent(new CustomEvent('ogv:mute', { detail: muted }));
}

function audio() {
  if (isMuted()) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) {
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, at, length, { type = 'sine', peak = 0.3, slideTo } = {}) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

let lastHover = 0;

export const sfx = {
  click() {
    if (!audio()) return;
    const t = ctx.currentTime;
    tone(1800, t, 0.05, { type: 'triangle', peak: 0.12, slideTo: 900 });
  },
  hover() {
    const now = performance.now();
    if (now - lastHover < 70 || !audio()) return;
    lastHover = now;
    tone(2600, ctx.currentTime, 0.03, { peak: 0.025 });
  },
  found() {
    if (!audio()) return;
    const t = ctx.currentTime;
    tone(660, t, 0.18, { type: 'triangle', peak: 0.2 });
    tone(990, t + 0.12, 0.3, { type: 'triangle', peak: 0.2 });
  },
  win() {
    if (!audio()) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => tone(freq, t + i * 0.09, 0.5, { type: 'triangle', peak: 0.22 }));
    [1568, 2093, 2637].forEach((freq, i) => tone(freq, t + 0.4 + i * 0.05, 1.2, { peak: 0.07 }));
  },
  coin() {
    if (!audio()) return;
    const t = ctx.currentTime;
    tone(1318.5, t, 0.08, { type: 'square', peak: 0.06 });
    tone(1975.5, t + 0.07, 0.35, { type: 'square', peak: 0.06 });
  },
  lose() {
    if (!audio()) return;
    const t = ctx.currentTime;
    tone(392, t, 0.25, { type: 'triangle', peak: 0.15, slideTo: 330 });
    tone(311, t + 0.2, 0.45, { type: 'triangle', peak: 0.15, slideTo: 247 });
  },
};

const CONFETTI_COLORS = ['#f5c542', '#ffe9a3', '#2f6bff', '#ffffff', '#2ecc71'];

export function confetti(count = 90) {
  if (reduced()) return;
  const layer = document.createElement('div');
  layer.className = 'fx-confetti';
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('i');
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    bit.style.setProperty('--x', `${(Math.random() - 0.5) * 240}px`);
    bit.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    bit.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    bit.style.animationDelay = `${Math.random() * 0.35}s`;
    if (i % 3 === 0) bit.style.borderRadius = '50%';
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4000);
}

export function celebrate() {
  sfx.win();
  confetti();
}

function ripple(button, event) {
  if (reduced()) return;
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2;
  const dot = document.createElement('span');
  dot.className = 'fx-ripple';
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${event.clientX - rect.left - size / 2}px`;
  dot.style.top = `${event.clientY - rect.top - size / 2}px`;
  button.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
}

const CLICKABLE = '.btn, .iconbtn, .seg button, .presets button, .wallet-tabs button, .bj-currency button';

export function installUiFx() {
  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest?.(CLICKABLE);
    if (!button || button.disabled) return;
    sfx.click();
    if (button.matches('.btn')) ripple(button, event);
  });
  document.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse') return;
    const button = event.target.closest?.(CLICKABLE);
    if (!button || button.disabled || button.contains(event.relatedTarget)) return;
    sfx.hover();
  });
}
