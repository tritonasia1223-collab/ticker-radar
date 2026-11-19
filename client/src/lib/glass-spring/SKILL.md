---
name: glass-spring
description: Apply portable, host-palette glass surfaces and dependency-free spring state transitions. Use when adding floating-layer glass, accordion motion, grid rearrangement or programmatic scrolling; preserve content readability and reduced-motion preferences.
---

# Glass + spring

Copy `glass.css` and `spring.js` together. Import the CSS once, after the host's utility styles, and import only the JS functions needed. Remove competing opaque background classes from these surfaces. No framework, package installation, build tool or app data is required. `SKILL.md` is the usage contract for humans and AI. TypeScript consumers can enable `allowJs`; the JS has checked JSDoc types.

## Bind the host palette

```css
/* Use complete CSS colors; HSL channel tokens need hsl(...). */
.my-page, .my-portal {
  --glass-host-bg: var(--surface);
  --glass-host-fg: var(--text);
  --glass-host-border: var(--divider); /* opaque fallback border */
}
/* Example for an HSL-token host:
.my-portal { --glass-host-bg: hsl(var(--background));
             --glass-host-fg: hsl(var(--foreground)); } */
```

Bind portal content too: a portalled modal does not inherit page-local tokens. Without bindings the module uses system `Canvas` / `CanvasText`, never a fixed palette. Match the host's light/dark colors; `.dark`, `.light`, `[data-theme]` and OS preference adjust only opacity. An explicit light theme overrides OS dark. Supply system `color-scheme` if relying on system colors.

Defaults: blur 12px, saturation 1.4, alpha .75; `.glass-strong` uses 20px / .9. Dark alpha .82 / .94. Override `--glass-blur`, `--glass-saturate`, `--glass-bg-alpha`, `--glass-strong-alpha`, `--glass-strong-blur`, `--glass-border` (border width/style, default `1px solid`) and `--glass-border-alpha` as needed. `color-mix` applies the alpha to the host surface. Missing blur or `color-mix`, forced colors, and reduced transparency use an opaque surface. Layout, radii and shadows belong to the host.

## Where glass belongs

Use only layers floating above scrolling content; keep their count small:

```html
<header class="glass sticky-header">Sticky navigation</header>
<aside class="glass floating-controls">Filter controls</aside>
<div class="glass my-portal" role="tooltip">Context</div>
<div class="glass my-portal" role="dialog">Popover</div>
<dialog class="glass-strong my-portal">Modal</dialog>
```

The host still supplies sticky/fixed position, stacking order, focus handling and dialog accessibility. Avoid `opacity` on the whole surface: it fades text too. Do not apply blur to repeated cards/list items, colored rules, charts, text editors or the entire page. Keep reading surfaces opaque. Avoid parent opacity/filters that create a backdrop root and prevent the intended blur.

Timeline-specific exception (explicit user request, 2026-11-19): European shared events use `.glass` as protruding panels, with 8px blur, alpha .18 (.26 dark), no border, soft reflections and pronounced floating shadows. Ordinary events remain unblurred. Do not generalize this exception to all list cards. The timeline also overrides alpha to .5 for floating controls and .78 for modals (.58/.84 in dark mode); portable defaults above are unchanged.

## Spring contract

```js
import { spring, springPresets, springHeight, captureGrid,
         springGrid, springScroll } from './spring.js';

const motion = spring(indicator, {
  from: 0, to: 1, ...springPresets.gentle,
  onUpdate: value => { indicator.style.opacity = String(value); }
});
const status = await motion.finished; // 'finished' or 'cancelled', never rejects
// motion.cancel(); // leaves generic rendering at the current value
```

`from` and `to` are finite scalars. Use scalar progress to interpolate several properties in `onUpdate`; CSS units are the caller's responsibility. Positive stiffness/damping, unit mass. One motion per element; a newer call cancels the previous one. Call `cancel()` on unmount. Render callbacks should not throw. Do not add CSS transitions to properties owned by the spring.

| Preset | Use |
| --- | --- |
| `gentle` | UI state changes and subtle indicator appearance |
| `snappy` | Accordions/toggles; slight overshoot |
| `smooth` | Scrolling; no overshoot |

All calls finish at the target immediately when reduced motion is enabled; enabling it during a running animation also completes that animation. Call sites must not duplicate this check. Helpers restore temporary styles when their `finished` promise resolves (the next microtask). Frame-rate-independent integration uses a capped timestep after a background-tab pause and an 8-second safety completion limit.

## Height accordion / expand-collapse

Use a borderless, padding-free outer wrapper; put spacing inside. Keep content mounted until closing finishes. Set initial `hidden` before the first render to avoid a flash. The helper restores natural height on completion, so later edits/reflow work normally. A reversal starts at the currently painted height. If content changes during motion, call again to measure its new natural height.

```html
<button id="toggle" aria-controls="details" aria-expanded="false">Title</button>
<div id="details" hidden><div class="detail-spacing">Explanation</div></div>
```
```js
toggle.onclick = () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  details.inert = !open; // hidden controls must stop accepting focus immediately
  details.setAttribute('aria-hidden', String(!open));
  springHeight(details, open, springPresets.snappy);
};
```

React: capture refs, call `springHeight` in a layout effect after DOM commit, retain children while closing, cancel on unmount. Do not cancel in the dependency effect's cleanup before a reversal; the helper handles interruption. Focus stays on the triggering button; return focus there before programmatically closing a focused panel.

## Toggle / entering indicator

```js
function showIndicator(show) {
  const from = Number(getComputedStyle(indicator).opacity);
  spring(indicator, { from, to: show ? 1 : 0, ...springPresets.gentle,
    onUpdate: value => { indicator.style.opacity = String(Math.max(0, Math.min(1, value))); }
  });
}
function setToggle(on) {
  const from = Number(thumb.dataset.x || 0);
  spring(thumb, { from, to: on ? 16 : 0, ...springPresets.snappy,
    onUpdate: x => { thumb.dataset.x = String(x); thumb.style.transform = `translateX(${x}px)`; }
  });
}
```

Animate state changes only. Do not spring scroll-linked effects, continuous pointer movement, large hover displacement, or every row on a search keystroke. A high-frequency hover indicator can keep a brief opacity fade with a reduced-motion CSS override; do not make its range geometry bounce.

## Grid columns / country filters

```js
const before = captureGrid(header, '[data-column]');
updateColumns(); // synchronously update DOM/layout
const motion = springGrid(header, before, { selector: '[data-column]' });
```

For React, capture before `setState`, then call `springGrid` in `useLayoutEffect` after the column state commits. It animates surviving DOM nodes' translations, not widths/font scale; added nodes appear in their final position. Select a small header/control set, not repeated cards. Existing CSS `translate` is skipped; `transform` remains untouched. Keep node keys stable. On repeated changes capture the current painted positions before starting again. The helper restores inline translate; cancel on unmount.

## Programmatic scroll

```js
springScroll(scrollContainer, 0); // back to top
const top = target.getBoundingClientRect().top
  - scrollContainer.getBoundingClientRect().top
  + scrollContainer.scrollTop - stickyHeaderHeight;
springScroll(scrollContainer, top);
```

Pass the actual HTMLElement scroll container (`document.scrollingElement` for document scrolling). Targets are bounded to its scroll range. Scroll physics are always at least critically damped, even with custom options; wheel/touch/pointer and navigation keys cancel it. Never call on every `scroll` event. Leave normal wheel/touch scrolling native.

## First consumer: international timeline

The app imports this CSS and JS. Glass: sticky country header, event popovers, source/trash dialogs, undo toast. Motion: global-event explanations, country header repositioning and explicit year/top/new-event navigation. Country rules, cards, editor typography and period hover geometry retain their original appearance. The React disclosure adapter stays outside this portable folder.
