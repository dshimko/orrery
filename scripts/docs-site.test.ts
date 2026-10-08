// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  checkLinks,
  createSlugger,
  discoverSources,
  renderSite,
  writeSite,
} from './docs-site.mjs';

type Site = { files: Map<string, string>; errors: string[] };

const temporary: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'orrery-docs-'));
  temporary.push(dir);
  return dir;
}

/** A small repository with the given files, relative path to content. */
function fixtureRoot(files: Record<string, string>): string {
  const root = tempDir();
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

const render = (root: string): Site => renderSite(root) as Site;

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('docs site built from the repository', () => {
  const out = mkdtempSync(path.join(tmpdir(), 'orrery-docs-out-'));
  const { files, errors } = render(REPO_ROOT);
  writeSite(files, out);
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('writes a page for every documentation file and the stylesheet', () => {
    const written = readdirSync(out).sort();
    for (const page of [
      'index.html',
      'configuration.html',
      'adapters.html',
      'forking.html',
      'prior-art.html',
      'databricks.html',
      'decisions.html',
      'specification.html',
      'contributing.html',
      'security.html',
      'changelog.html',
      'style.css',
    ]) {
      expect(written).toContain(page);
    }
  });

  it('puts the shared nav on every page and marks the current one', () => {
    const pages = readdirSync(out).filter((name) => name.endsWith('.html'));
    for (const page of pages) {
      const html = readFileSync(path.join(out, page), 'utf8');
      expect(html, page).toContain('<nav class="site-nav" aria-label="Documentation">');
      expect(html, page).toContain(`<a href="${page}" aria-current="page">`);
      expect(html, page).toContain('href="configuration.html"');
    }
  });

  it('has no broken relative links or anchors', () => {
    expect(errors).toEqual([]);
    const result = checkLinks(files) as { errors: string[]; linkCount: number };
    expect(result.errors).toEqual([]);
    expect(result.linkCount).toBeGreaterThan(0);
  });

  it('loads no external script, font, or stylesheet', () => {
    for (const [name, html] of files) {
      if (!name.endsWith('.html')) continue;
      expect(html, name).not.toMatch(/<script/i);
      expect(html, name).not.toMatch(/<link[^>]+href="https?:/i);
    }
    expect(files.get('style.css')).not.toMatch(/@import|url\(/);
  });
});

describe('markdown rendering', () => {
  const root = fixtureRoot({
    'README.md': [
      '# Home',
      '',
      'See [the guide](docs/guide.md#second-part) and [license](LICENSE).',
      '',
      'Inline <script>alert(1)</script> and <img src=x onerror=alert(2)>.',
      '',
      '<script>alert(3)</script>',
      '',
      '<!-- note to maintainers -->',
      '',
      '[bad](javascript:alert(4)) [also bad](  JaVa\tScript:alert(5))',
      '',
      '![tracker](data:image/svg+xml;base64,AAAA)',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
    ].join('\n'),
    LICENSE: 'text',
    'docs/guide.md':
      '# Guide\n\n## First part\n\n## Second part\n\n## Second part\n\nBack to [home](../README.md).\n',
  });
  const { files, errors } = render(root);
  const home = files.get('index.html') ?? '';

  it('escapes raw HTML instead of passing it through', () => {
    expect(home).not.toContain('<script>');
    expect(home).not.toContain('<img src=x');
    expect(home).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(home).toContain('&lt;script&gt;alert(3)&lt;/script&gt;');
  });

  it('drops HTML comments', () => {
    expect(home).not.toContain('note to maintainers');
  });

  it('renders links and images with unsafe schemes as plain text', () => {
    expect(home).not.toMatch(/href="\s*javascript/i);
    expect(home).not.toMatch(/href="[^"]*script:/i);
    expect(home).not.toContain('data:image');
    expect(home).toContain('bad');
  });

  it('rewrites links to Markdown pages to .html and keeps the fragment', () => {
    expect(home).toContain('href="guide.html#second-part"');
    expect(files.get('guide.html')).toContain('href="index.html"');
  });

  it('does not link to repository files outside the site', () => {
    expect(home).not.toContain('href="LICENSE"');
    expect(home).toContain('class="repo-path"');
    expect(errors).toEqual([]);
  });

  it('adds heading ids and numbers duplicates like GitHub', () => {
    const guide = files.get('guide.html') ?? '';
    expect(guide).toContain('<h2 id="first-part">');
    expect(guide).toContain('<h2 id="second-part">');
    expect(guide).toContain('<h2 id="second-part-1">');
    expect(guide).toContain('class="anchor"');
  });

  it('wraps tables so they can scroll', () => {
    expect(home).toContain('<div class="table-wrap"><table>');
  });
});

describe('link checker', () => {
  it('reports links to missing files from the Markdown source', () => {
    const root = fixtureRoot({ 'README.md': '# Home\n\n[gone](docs/missing.md)\n' });
    const { errors } = render(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('README.md');
    expect(errors[0]).toContain('docs/missing.md');
  });

  it('reports links that leave the repository', () => {
    const root = fixtureRoot({ 'README.md': '# Home\n\n[out](../elsewhere.md)\n' });
    expect(render(root).errors[0]).toContain('leaves the repository');
  });

  it('reports a fragment that matches no heading, on the same page and across pages', () => {
    const root = fixtureRoot({
      'README.md': '# Home\n\n[x](#nope) [y](docs/guide.md#nowhere) [ok](docs/guide.md#guide)\n',
      'docs/guide.md': '# Guide\n',
    });
    const { files, errors } = render(root);
    expect(errors).toEqual([]);
    const result = checkLinks(files) as { errors: string[] };
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join('\n')).toContain('#nope');
    expect(result.errors.join('\n')).toContain('guide.html#nowhere');
  });

  it('reports a link to a page that is not in the output', () => {
    const files = new Map([['index.html', '<a href="missing.html">x</a><h1 id="a"></h1>']]);
    const result = checkLinks(files) as { errors: string[] };
    expect(result.errors[0]).toContain('missing.html');
  });
});

describe('page discovery and slugs', () => {
  it('orders guides first and names the specification', () => {
    const root = fixtureRoot({
      'README.md': '# Home\n',
      'docs/zeta.md': '# Zeta\n',
      'docs/BUILD_PROMPT.md': '# Prompt\n',
      'docs/configuration.md': '# Configuration\n',
      'CONTRIBUTING.md': '# Contributing\n',
    });
    const pages = discoverSources(root) as { source: string; out: string; label: string }[];
    expect(pages.map((page) => page.source)).toEqual([
      'README.md',
      'docs/configuration.md',
      'docs/BUILD_PROMPT.md',
      'docs/zeta.md',
      'CONTRIBUTING.md',
    ]);
    const spec = pages.find((page) => page.source === 'docs/BUILD_PROMPT.md');
    expect(spec).toMatchObject({ out: 'specification.html', label: 'Specification' });
  });

  it('slugs headings the way GitHub does', () => {
    const slug = createSlugger() as (text: string) => string;
    expect(slug('Matcher keys (match)')).toBe('matcher-keys-match');
    expect(slug('1. Create the private repository')).toBe('1-create-the-private-repository');
    expect(slug('Secrets: ${env:NAME}')).toBe('secrets-envname');
  });
});
