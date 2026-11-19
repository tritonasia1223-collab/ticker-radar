// App adapter for charts that calculate text contrast. The portable theme has no JS dependency.
const cache = new Map<string, number>();
let canvas: HTMLCanvasElement | undefined;
export function isDarkColor(color: string): boolean {
  let luminance = cache.get(color);
  if (luminance === undefined) {
    if (typeof document === 'undefined') return false;
    // Resolve CSS variables and color-mix in the document before sampling in sRGB.
    const probe = document.createElement('span');
    probe.style.color = color;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    canvas ??= document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.fillStyle = resolved;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    luminance = .2126 * r + .7152 * g + .0722 * b;
    cache.set(color, luminance);
  }
  return luminance < 150;
}
