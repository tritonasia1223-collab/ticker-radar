import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import defaultTheme from 'tailwindcss/defaultTheme';
import config from '../tailwind.config';

const sourceRoot = path.resolve('client/src');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const source = files(sourceRoot).filter(f => /\.(tsx?|jsx?)$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
const theme = postcss.parse(readFileSync(path.join(sourceRoot, 'lib/warm-prism/theme.css'), 'utf8'));
const tokens = new Map<string, string>();
theme.walkDecls(d => { if (d.prop.startsWith('--')) tokens.set(d.prop, d.value); });
const resolve = (value: string): string => value.replace(/var\((--[\w-]+)\)/g, (_, key) => {
  expect(tokens.has(key), `missing token ${key}`).toBe(true);
  return tokens.get(key)!;
});

describe('site typography compatibility', () => {
  it('compiles every page utility with valid token names and preserves fractional font sizes', async () => {
    const sizes = Object.keys(defaultTheme.fontSize);
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: `${source}\n${sizes.map(s => `text-${s}`).join(' ')}`, extension: 'tsx' }] })]).process('@tailwind utilities;', { from: undefined });
    const declarations = new Map<string, Record<string, string>>();
    result.root.walkRules(rule => {
      const values: Record<string, string> = {};
      rule.walkDecls(d => {
        expect(d.value).not.toMatch(/var\(--[^),]*\s[^),]*\)/);
        values[d.prop] = resolve(d.value.replace(/var\(--(?!font-|type-|space-)[\w-]+\)/g, 'host-token'));
      });
      declarations.set(rule.selector, values);
    });
    for (const [size, spec] of Object.entries(defaultTheme.fontSize)) {
      const [fontSize, options] = spec as [string, { lineHeight: string }];
      expect(declarations.get(`.text-${size}`)).toMatchObject({ 'font-size': fontSize, 'line-height': options.lineHeight });
    }
    const fractional = [...source.matchAll(/text-\[(\d+\.\d+)px\]/g)];
    expect(fractional.length).toBeGreaterThan(50);
    for (const match of fractional) {
      const selector = '.' + match[0].replace(/[\[\].]/g, '\\$&');
      expect(declarations.get(selector)?.['font-size']).toBe(match[1] + 'px');
    }
  });

  it('keeps the original general and page-specific font stacks', () => {
    expect(tokens.get('--font-sans')).toBe('Open Sans, sans-serif');
    expect(tokens.get('--font-serif')).toBe('Georgia, serif');
    expect(tokens.get('--font-mono')).toBe('Menlo, monospace');
    expect(tokens.get('--font-reading-sans')).toBe('"IBM Plex Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif');
    expect(tokens.get('--font-timeline')).toContain('"Source Serif 4", Georgia, "Pretendard"');
  });
});
