// @ts-check
/** @typedef {{stiffness?: number, damping?: number}} Physics */
/** @typedef {{cancel: () => void, finished: Promise<'finished'|'cancelled'>}} Motion */
/** @typedef {Physics & {from: number, to: number, onUpdate: (value: number, element: HTMLElement) => void}} SpringOptions */

export const springPresets = Object.freeze({
  gentle: Object.freeze({ stiffness: 170, damping: 26 }),
  snappy: Object.freeze({ stiffness: 360, damping: 30 }),
  smooth: Object.freeze({ stiffness: 180, damping: 30 }),
});

/** @type {WeakMap<HTMLElement, Motion>} */
const running = new WeakMap();
/** @type {Set<() => void>} */
const finishNow = new Set();
const preference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const preferenceChanged = () => { if (preference?.matches) [...finishNow].forEach(finish => finish()); };
preference?.addEventListener('change', preferenceChanged);
// Vite cleanup is optional; native ESM browsers simply skip it.
if (import.meta.hot) import.meta.hot.dispose(() => {
  preference?.removeEventListener('change', preferenceChanged);
  [...finishNow].forEach(finish => finish());
});

/**
 * Animate a scalar (pixels, opacity, progress, etc.). onUpdate owns rendering;
 * no style/unit guesses. One motion per element; starting another cancels it.
 * Unit mass; exact damped-oscillator integration is stable at any frame rate.
 * @param {HTMLElement} element
 * @param {SpringOptions} options
 * @returns {Motion}
 */
export function spring(element, { from, to, stiffness = 170, damping = 26, onUpdate }) {
  if (![from, to, stiffness, damping].every(Number.isFinite) || stiffness <= 0 || damping <= 0)
    throw new RangeError('Spring values must be finite; stiffness and damping must be positive.');
  running.get(element)?.cancel();
  let value = from, velocity = 0, frame = 0, last = 0, elapsed = 0, done = false;
  /** @type {(status: 'finished'|'cancelled') => void} */
  let resolve = () => {};
  /** @type {Promise<'finished'|'cancelled'>} */
  const finished = new Promise(res => { resolve = res; });
  const settle = (/** @type {'finished'|'cancelled'} */ status) => {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    finishNow.delete(complete);
    if (running.get(element) === motion) running.delete(element);
    resolve(status);
  };
  const complete = () => { if (!done) { settle('finished'); onUpdate(to, element); } };
  const motion = { cancel: () => settle('cancelled'), finished };
  running.set(element, motion);
  if (preference?.matches || typeof requestAnimationFrame !== 'function' || from === to) {
    complete();
    return motion;
  }
  const epsilon = Math.max(0.001, Math.abs(to - from) * 0.0001);
  const step = (/** @type {number} */ now) => {
    if (done) return;
    // Background tabs resume gently, without integrating minutes of elapsed time.
    const dt = last ? Math.min((now - last) / 1000, 0.064) : 1 / 60;
    last = now;
    elapsed += dt;
    const x = value - to, a = damping / 2, discriminant = a * a - stiffness;
    if (Math.abs(discriminant) < 1e-8) {
      const b = velocity + a * x, decay = Math.exp(-a * dt);
      value = to + (x + b * dt) * decay;
      velocity = (velocity - a * b * dt) * decay;
    } else if (discriminant < 0) {
      const w = Math.sqrt(-discriminant), sin = Math.sin(w * dt), cos = Math.cos(w * dt), decay = Math.exp(-a * dt);
      value = to + decay * (x * cos + (velocity + a * x) / w * sin);
      velocity = decay * (velocity * cos - (a * velocity + stiffness * x) / w * sin);
    } else {
      const root = Math.sqrt(discriminant), r1 = -a + root, r2 = -a - root;
      const c1 = (velocity - r2 * x) / (r1 - r2), c2 = x - c1;
      value = to + c1 * Math.exp(r1 * dt) + c2 * Math.exp(r2 * dt);
      velocity = c1 * r1 * Math.exp(r1 * dt) + c2 * r2 * Math.exp(r2 * dt);
    }
    if ((Math.abs(value - to) <= epsilon && Math.abs(velocity) <= epsilon * 10) || elapsed >= 8) { complete(); return; }
    try { onUpdate(value, element); } catch (error) { motion.cancel(); throw error; }
    if (!done) frame = requestAnimationFrame(step);
  };
  finishNow.add(complete);
  try { onUpdate(from, element); } catch (error) { motion.cancel(); throw error; }
  if (!done) frame = requestAnimationFrame(step);
  return motion;
}

/** @type {WeakMap<HTMLElement, Motion>} */
const heights = new WeakMap();
/**
 * Animate a borderless, padding-free outer wrapper. Put spacing in its child.
 * Keep content mounted through closing; restores natural height when finished.
 * @param {HTMLElement} element
 * @param {boolean} open
 * @param {Physics} [options]
 * @returns {Motion}
 */
export function springHeight(element, open, options = springPresets.snappy) {
  const from = element.hidden ? 0 : element.getBoundingClientRect().height;
  heights.get(element)?.cancel();
  const saved = { height: element.style.height, overflow: element.style.overflow };
  element.hidden = false;
  element.style.height = 'auto';
  const to = open ? element.getBoundingClientRect().height : 0;
  element.style.height = `${from}px`;
  element.style.overflow = 'hidden';
  const inner = spring(element, { ...options, from, to, onUpdate: value => { element.style.height = `${Math.max(0, value)}px`; } });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    element.style.height = saved.height;
    element.style.overflow = saved.overflow;
    if (heights.get(element) === motion) heights.delete(element);
  };
  const motion = { cancel: () => { inner.cancel(); cleanup(); }, finished: inner.finished.then(status => {
    if (!cleaned) { element.hidden = status === 'finished' && !open; cleanup(); }
    return status;
  }) };
  heights.set(element, motion);
  return motion;
}

/** Capture BEFORE a grid mutation, including React setState. @param {HTMLElement} container @param {string} selector */
export function captureGrid(container, selector = '[data-spring-item]') {
  return new Map([...container.querySelectorAll(selector)].filter(node => node instanceof HTMLElement).map(node => [node, node.getBoundingClientRect()]));
}
/** @type {WeakMap<HTMLElement, Motion>} */
const translations = new WeakMap();
/**
 * FLIP translation after the grid commits. Layout/width changes immediately;
 * text is never scaled. Select only a few headings/controls, not whole lists.
 * Elements must not have an existing CSS translate (transform is preserved).
 * @param {HTMLElement} container
 * @param {Map<HTMLElement, DOMRect>} before
 * @param {Physics & {selector?: string}} [options]
 */
export function springGrid(container, before, { selector = '[data-spring-item]', ...physics } = {}) {
  /** @type {Motion[]} */
  const motions = [];
  for (const [element, rect] of before) {
    translations.get(element)?.cancel();
    if (!container.contains(element) || !element.matches(selector)) continue;
    const saved = element.style.translate;
    const translation = getComputedStyle(element).translate;
    if (translation && translation !== 'none') continue;
    const next = element.getBoundingClientRect(), x = rect.left - next.left, y = rect.top - next.top;
    if (Math.abs(x) + Math.abs(y) < 0.5) continue;
    const inner = spring(element, { ...springPresets.gentle, ...physics, from: 1, to: 0,
      onUpdate: progress => { element.style.translate = `${x * progress}px ${y * progress}px`; } });
    const cleanup = () => { if (translations.get(element) === motion) { element.style.translate = saved; translations.delete(element); } };
    const motion = { cancel: () => { inner.cancel(); cleanup(); }, finished: inner.finished.then(status => { cleanup(); return status; }) };
    translations.set(element, motion);
    motions.push(motion);
  }
  return { cancel: () => motions.forEach(m => m.cancel()), finished: Promise.all(motions.map(m => m.finished)) };
}

/**
 * Scroll a real scroll container, clamped to its bounds. Critically/over-damped
 * even when custom physics are supplied: no overshoot. User input cancels it.
 * @param {HTMLElement} element
 * @param {number} top
 * @param {Physics} [options]
 * @returns {Motion}
 */
export function springScroll(element, top, options = springPresets.smooth) {
  const stiffness = options.stiffness ?? springPresets.smooth.stiffness;
  const damping = Math.max(options.damping ?? springPresets.smooth.damping, 2 * Math.sqrt(stiffness));
  const to = Math.max(0, Math.min(top, element.scrollHeight - element.clientHeight));
  const inner = spring(element, { from: element.scrollTop, to, stiffness, damping,
    onUpdate: value => element.scrollTo({ top: value, left: element.scrollLeft, behavior: 'instant' }) });
  const stop = () => inner.cancel();
  const key = (/** @type {KeyboardEvent} */ event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop(); };
  for (const name of ['wheel', 'touchstart', 'pointerdown']) element.addEventListener(name, stop, { passive: true });
  element.addEventListener('keydown', key);
  const cleanup = () => {
    for (const name of ['wheel', 'touchstart', 'pointerdown']) element.removeEventListener(name, stop);
    element.removeEventListener('keydown', key);
  };
  return { cancel: () => { inner.cancel(); cleanup(); }, finished: inner.finished.then(status => { cleanup(); return status; }) };
}
