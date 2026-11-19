import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const root = path.resolve('client/src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const cssFiles = [path.join(root, 'lib/warm-prism/theme.css')];
const theme = postcss.parse(readFileSync(path.join(root, 'lib/warm-prism/theme.css'), 'utf8'));

describe('warm-prism integration policy', () => {
  it('portable tokens resolve without the host stylesheet, including editor colors', () => {
    const defined = new Set<string>();
    theme.walkDecls(decl => { if (decl.prop.startsWith('--')) defined.add(decl.prop); });
    const missing = new Set<string>();
    theme.walkDecls(decl => { for (const match of decl.value.matchAll(/var\((--[\w-]+)/g)) if (!defined.has(match[1])) missing.add(match[1]); });
    expect([...missing]).toEqual([]);
    expect([...defined]).toEqual(expect.arrayContaining(['--bg', '--ink', '--tint-lemon', '--prism', '--glass-bg-alpha']));
  });

  it('uses one light desktop layout and retains accessibility overrides', () => {
    for (const file of cssFiles) {
      const css = postcss.parse(readFileSync(file, 'utf8'));
      css.walkAtRules(rule => {
        if (rule.name === 'media') expect(rule.params).not.toMatch(/prefers-color-scheme|(?:min|max)-width|hover\s*:/);
        expect(rule.name).not.toBe('container');
      });
      css.walkRules(rule => expect(rule.selector).not.toMatch(/\.dark\b|data-theme/));
    }
    const body = theme.nodes.find(node => node.type === 'rule' && node.selector === 'body');
    expect(body?.toString()).toContain('min-width: 1080px');
    expect(theme.toString()).toContain('prefers-reduced-motion: reduce');
    expect(readFileSync('client/src/main.tsx', 'utf8')).not.toContain('warm-prism/theme.css');
    expect(readFileSync('client/index.html', 'utf8')).toContain('width=device-width');
  });

  it('portable prism stays masked; the site retains its pre-theme timeline presentation', () => {
    const prismPaints: string[] = [];
    theme.walkDecls(decl => { if (/^background/.test(decl.prop) && decl.value.includes('var(--prism)')) prismPaints.push(decl.parent?.toString() ?? ''); });
    expect(prismPaints).toHaveLength(1);
    expect(prismPaints[0]).toContain('.prism-edge::before');
    expect(prismPaints[0]).toContain('mask-composite: exclude');
    const timeline = readFileSync(path.join(root, 'pages/InternationalTimeline.tsx'), 'utf8');
    expect(timeline).toMatch(/it-europe-shared glass/);
    expect(timeline).toContain('glass-spring/spring.js');
  });
});
