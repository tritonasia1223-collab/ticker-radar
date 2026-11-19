---
name: warm-prism
description: Apply the portable warm-prism light desktop design system to websites, including palette tokens, restrained glass and prism edges, and state-only spring motion.
---

# Warm prism

Copy `theme.css` and `spring.js` together. Import the CSS after the host stylesheet. No framework or animation package is required. The host can override the root palette tokens after this import; components must reference tokens instead of defining colors, shadows or motion timings. Keep this guide alongside the files.

```js
import './warm-prism/theme.css';
import { spring, springPresets, springHeight, captureGrid, springGrid, springScroll } from './warm-prism/spring.js';
```

## Composition and tokens

Aim for 90% warm neutral, 8% glass, 2% prism. These are visual-area budgets, not quotas. Ordinary content uses `--bg`, `--surface`, `--surface-soft`, `--tint-lemon`, `--ink`, `--ink-soft`, `--line`; use the font, spacing, radius and shadow scales in `theme.css`. Semantic data colors distinguish charts and events; they are not decorative prism surfaces. Preserve user-authored text formatting and data meaning.

```css
.reading-card {
  background: var(--surface);
  color: var(--ink);
  padding: var(--space-scale-4);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-md);
  font: var(--type-base)/var(--leading-normal) var(--font-sans);
}
.section-note { background: var(--tint-lemon); color: var(--ink-soft); }
```

## Glass: floating layers only

Use `.glass` for sticky headers, floating control bars, popovers and tooltips; `.glass-strong` for dialogs. Never apply it to repeating cards, list items, body text, chart lines or chart canvases. European shared events are ordinary surfaces too. Glass derives its tint from `--bg` at `.75` alpha, blur `12px`, saturation `1.4`. Unsupported filters, reduced transparency and forced colors use an opaque surface automatically.

```html
<header class="glass prism-edge">Fixed navigation</header>
<div role="dialog" aria-modal="true" class="glass-strong prism-edge">Dialog contents</div>
<article class="reading-card">No glass on repeated content</article>
```

## Prism: light at the edge, never a fill

Only use lemon → peach → lilac in 1px borders, hover/focus highlights and glass refraction edges. No cyan/magenta rainbow. `.prism-edge` draws a masked 1px ring visible on hover/focus-within, with a non-masked fallback. Never use `background: var(--prism)` on a component surface. Keep normal keyboard focus visible independently of the prism. Avoid combining this utility with another `::before` decoration; put it on a separate wrapper instead.

```html
<div class="prism-edge"><button type="button">Open controls</button></div>
```

## Spring: state transitions, not entrances

Allowed: explicit expand/collapse, toggles, filters, changing indicators and programmatic scrolling. Not allowed: page-load/viewport entrance animations, scroll-linked animation, perpetual decorative loops or large movements on frequent hover. Chart geometry updates immediately. Reduced-motion is handled inside every helper, including preference changes during motion. Cancel outstanding motion on unmount. Never animate all repeated cards.

`springPresets.gentle` is for UI state changes; `snappy` has a small overshoot for toggles; `smooth` is critically damped with no overshoot for scrolling. Every call returns `{cancel, finished}`; `finished` resolves to `finished` or `cancelled`.

```js
// Explicit toggle of an already-mounted indicator, not a page entrance.
const motion = spring(indicator, {
  ...springPresets.gentle, from: previousValue, to: nextValue,
  onUpdate: value => { indicator.style.opacity = String(value); }
});
// Keep this borderless, padding-free wrapper mounted while closing.
// Put padding on its inner child; manage aria-expanded and inert in the host.
const disclosure = springHeight(wrapper, expanded, springPresets.snappy);
await disclosure.finished;
// Capture before changing filter state, then apply after the DOM commits.
// Select a handful of controls/headings; never scale chart text or animate new rows.
const before = captureGrid(grid, '[data-spring-item]');
applyFilter();
requestAnimationFrame(() => springGrid(grid, before));
// Real scroll container; user wheel/touch/navigation keys interrupt motion.
springScroll(scrollContainer, targetOffset, springPresets.smooth);
// Component cleanup:
motion.cancel();
```

## Light desktop policy

One light palette only. Do not add dark classes, theme switches, system-color-scheme queries or theme-attribute blocks. No responsive layout breakpoints or mobile-only views. The module includes `body { min-width: 1080px }` and horizontal overflow. The host document should use `<meta name="viewport" content="width=1080">` so narrow devices display the same desktop layout with zoom/panning available; never disable zoom. Resize observers that measure a chart container and accessibility media queries remain valid.

## Verification

Check ordinary content, one floating layer and a keyboard-focused control. Verify that glass/prism never obscure chart colors or text. Check desktop and narrow viewports for the same layout, expand/collapse reversal, filter reflow, interrupted scrolling and reduced-motion. Do not change saved content or publish merely to apply this system.
