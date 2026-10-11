// fx.js - Taskify sound and motion effects.
// Web Audio oscillators only (no files, no libraries) + a tiny canvas confetti.
// All effects respect prefers-reduced-motion and the persisted mute preference.

const MUTE_KEY = "taskify_muted";

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const prefersReducedMotion = () => motionQuery.matches;

// Sound defaults to off when the system asks for reduced motion.
function readMute() {
  try {
    const stored = localStorage.getItem(MUTE_KEY);
    if (stored === null) return prefersReducedMotion();
    return stored === "1";
  } catch {
    return prefersReducedMotion();
  }
}

let muted = readMute();

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable: keep the in-memory preference */
  }
}

export function toggleMute() {
  setMuted(!muted);
  return muted;
}

// --- Sound ---
// The AudioContext is created lazily on the first user-triggered sound, which
// satisfies the browser autoplay policy.
let audioContext = null;

function context() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioContext) audioContext = new Ctor();
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  return audioContext;
}

// One short oscillator blip. `gain` stays deliberately low.
function tone({ type = "sine", from, to = from, delay = 0, dur = 0.12, gain = 0.05 }) {
  const ac = context();
  if (!ac || muted) return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, start);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

export const sound = {
  // Creating a task: soft upward pop.
  create() {
    tone({ type: "triangle", from: 660, to: 990, dur: 0.12, gain: 0.05 });
  },
  // Saving an edit: softer, similar family.
  save() {
    tone({ type: "triangle", from: 520, to: 780, dur: 0.1, gain: 0.045 });
  },
  // Completing a task: the stamp thunk plus a bright ping.
  complete() {
    tone({ type: "square", from: 300, to: 170, dur: 0.09, gain: 0.05 });
    tone({ type: "triangle", from: 880, to: 1320, delay: 0.05, dur: 0.14, gain: 0.05 });
  },
  // Deleting a task: lower and duller, clearly different.
  remove() {
    tone({ type: "sine", from: 240, to: 90, dur: 0.2, gain: 0.07 });
  },
};

// --- Confetti (canvas) ---
let canvas = null;
let ctx = null;
let particles = [];
let frame = null;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
}

function resizeCanvas() {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * ratio;
  canvas.height = window.innerHeight * ratio;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

const CONFETTI_COLORS = ["#5b34b0", "#16855a", "#f2d64b", "#c4303f", "#ffffff"];

export function confetti(x, y, colors = CONFETTI_COLORS) {
  if (prefersReducedMotion()) return;
  ensureCanvas();
  for (let i = 0; i < 16; i += 1) {
    const angle = Math.PI * (0.15 + Math.random() * 0.7); // upward fan
    const speed = 2.4 + Math.random() * 3.6;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
      vy: -Math.abs(Math.sin(angle) * speed) - 1.4,
      size: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    });
  }
  if (!frame) frame = requestAnimationFrame(step);
}

function step() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles.forEach((p) => {
    p.vy += 0.16; // gravity
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.016;
  });
  particles = particles.filter((p) => p.life > 0.05 && p.y < window.innerHeight + 40);

  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62);
    ctx.restore();
  });

  if (particles.length) {
    frame = requestAnimationFrame(step);
  } else {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    frame = null;
  }
}

// --- DOM motion ---
// Classes are removed on animationend so the effect only runs on demand.

function playOnce(node, className) {
  if (!node) return;
  node.classList.add(className);
  node.addEventListener("animationend", () => node.classList.remove(className), {
    once: true,
  });
}

export function enter(node) {
  if (prefersReducedMotion()) return;
  playOnce(node, "fx-enter");
}

export function leave(node) {
  return new Promise((resolve) => {
    if (!node || prefersReducedMotion()) {
      resolve();
      return;
    }
    node.classList.add("fx-leave");
    node.addEventListener("animationend", () => resolve(), { once: true });
    // Safety net if the animation never fires.
    setTimeout(resolve, 400);
  });
}

// The one memorable moment: the HECHO stamp slams onto the completed card.
export function complete(node) {
  sound.complete();
  if (!node || prefersReducedMotion()) return;
  const rect = node.getBoundingClientRect();
  confetti(rect.left + 26, rect.top + rect.height / 2);

  const stamp = document.createElement("span");
  stamp.className = "stamp";
  stamp.setAttribute("aria-hidden", "true");
  stamp.textContent = "Hecho";
  node.appendChild(stamp);
  stamp.addEventListener("animationend", () => stamp.remove(), { once: true });
}
