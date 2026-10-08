// SPDX-License-Identifier: Apache-2.0
// Renders the Markdown docs to a static HTML site with `marked` (MIT) and checks the links.
//
//   node scripts/docs-site.mjs                build into build/docs (and check the links)
//   node scripts/docs-site.mjs --check        check links and anchors without writing files
//   node scripts/docs-site.mjs --out <dir>    build into another directory
//
// Raw HTML in Markdown is never passed through: it is escaped (comments are dropped), and links
// and images with a scheme other than http, https, or mailto are rendered as plain text.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Marked } from 'marked';

const SCRIPT_DIR = import.meta.dirname;
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'build/docs');
const STYLE_FILE = path.join(SCRIPT_DIR, 'docs-site.css');
const STYLE_OUT = 'style.css';
const SITE_NAME = 'Orrery docs';
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

/** Nav order of the guides under docs/; other docs/*.md follow alphabetically. */
const DOC_ORDER = [
  'configuration',
  'adapters',
  'databricks',
  'forking',
  'prior-art',
  'decisions',
  'databricks-sources',
  'build-prompt',
];
const LABELS = new Map([
  ['README.md', 'Overview'],
  ['docs/BUILD_PROMPT.md', 'Specification'],
  ['docs/databricks.md', 'Databricks adapter'],
  ['docs/databricks-sources.md', 'Databricks sources'],
  ['docs/prior-art.md', 'Prior art'],
]);
const OUT_NAMES = new Map([
  ['README.md', 'index.html'],
  ['docs/BUILD_PROMPT.md', 'specification.html'],
]);
const ROOT_PAGES = ['CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md'];
const GROUP_ORDER = ['Start', 'Guides', 'Reference', 'Deploy', 'Project'];
const GUIDES = new Set(['configuration', 'adapters', 'databricks', 'forking']);

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function titleCase(slug) {
  const words = slug.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function docsSources(root) {
  const dir = path.join(root, 'docs');
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -'.md'.length));
  const key = (name) => name.toLowerCase().replace(/_/g, '-');
  const rank = (name) => {
    const index = DOC_ORDER.indexOf(key(name));
    return index === -1 ? DOC_ORDER.length : index;
  };
  return names
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => {
      const source = `docs/${name}.md`;
      const slug = key(name);
      return {
        source,
        out: OUT_NAMES.get(source) ?? `${slug}.html`,
        label: LABELS.get(source) ?? titleCase(slug),
        group: GUIDES.has(slug) ? 'Guides' : 'Reference',
      };
    });
}

function deploySources(root) {
  const dir = path.join(root, 'deploy');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((name) => existsSync(path.join(dir, name, 'README.md')))
    .map((name) => ({
      source: `deploy/${name}/README.md`,
      out: `deploy-${name}.html`,
      label: `Deploy: ${name}`,
      group: 'Deploy',
    }));
}

/** The pages of the site, in nav order: `{ source, out, label, group }` per Markdown file. */
export function discoverSources(root) {
  const entry = (source, group) => ({
    source,
    out: OUT_NAMES.get(source) ?? `${path.posix.basename(source, '.md').toLowerCase()}.html`,
    label: LABELS.get(source) ?? titleCase(path.posix.basename(source, '.md').toLowerCase()),
    group,
  });
  const all = [
    ...(existsSync(path.join(root, 'README.md')) ? [entry('README.md', 'Start')] : []),
    ...docsSources(root),
    ...deploySources(root),
    ...ROOT_PAGES.filter((file) => existsSync(path.join(root, file))).map((file) =>
      entry(file, 'Project'),
    ),
  ];
  return all.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

/** GitHub-style heading ids: lowercase, punctuation dropped, spaces to hyphens, duplicates numbered. */
export function createSlugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

function classifyHref(raw) {
  const href = raw.trim();
  // Browsers ignore control characters and spaces inside a scheme, so check the compacted form.
  const compact = [...href].filter((char) => char.charCodeAt(0) > 0x20 && char !== '\x7f').join('');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme) return SAFE_SCHEMES.has(scheme) ? { kind: 'external', href } : { kind: 'unsafe' };
  if (compact.startsWith('//')) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'anchor', href };
  return { kind: 'relative', href };
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Resolves a relative link found in `source` to a site page (`{ href }`), an existing repository
 * file outside the site (`{ repoPath }`), or a problem (`{ error }`).
 */
function resolveRelative(href, source, site) {
  const [withoutHash, ...hashParts] = href.split('#');
  const hash = hashParts.length > 0 ? `#${hashParts.join('#')}` : '';
  const pathPart = safeDecode((withoutHash ?? '').split('?')[0] ?? '');
  if (pathPart === '') return { href: hash };
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(source), pathPart));
  if (resolved.startsWith('..')) return { error: `link leaves the repository: ${href}` };
  const page = site.byRepoPath.get(resolved);
  if (page) return { href: `${page.out}${hash}` };
  if (existsSync(path.join(site.root, resolved))) return { repoPath: resolved };
  return { error: `link to a file that does not exist: ${href}` };
}

/** Local images may come only from docs/images and only as raster files (no SVG scripts). */
const IMAGE_DIR = 'docs/images/';
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

/** Registers a relative image for copying into the site and returns its output path. */
function siteImage(href, source, site, errors) {
  const resolved = resolveRelative(href, source, site);
  if (resolved.error) {
    errors.push(`${source}: ${resolved.error}`);
    return undefined;
  }
  const repoPath = resolved.repoPath;
  if (!repoPath || !repoPath.startsWith(IMAGE_DIR) || !IMAGE_EXT.test(repoPath)) {
    errors.push(
      `${source}: images must be PNG, JPEG, WebP, or GIF files under ${IMAGE_DIR}: ${href}`,
    );
    return undefined;
  }
  const out = `images/${repoPath.slice(IMAGE_DIR.length)}`;
  site.images.set(out, repoPath);
  return out;
}

function plainText(html) {
  return unescapeHtml(html.replace(/<[^>]*>/g, ''));
}

function renderTitle(attr) {
  return attr ? ` title="${escapeHtml(attr)}"` : '';
}

/** A marked instance for one document. Raw HTML is escaped and unsafe URLs become plain text. */
export function createMarkdown(source, site, errors) {
  const slug = createSlugger();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      html(token) {
        const raw = token.text.trim();
        if (/^<!--[\s\S]*-->$/.test(raw)) return '';
        return token.block ? `<p>${escapeHtml(raw)}</p>\n` : escapeHtml(token.text);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const id = slug(plainText(inner));
        const anchor = `<a class="anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a>`;
        return `<h${depth} id="${escapeHtml(id)}">${inner}${anchor}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = classifyHref(href);
        if (target.kind === 'unsafe') return inner;
        if (target.kind === 'external') {
          const rel = target.href.startsWith('mailto:') ? '' : ' rel="noopener"';
          return `<a href="${escapeHtml(target.href)}"${renderTitle(title)}${rel}>${inner}</a>`;
        }
        if (target.kind === 'anchor') {
          return `<a href="${escapeHtml(target.href)}"${renderTitle(title)}>${inner}</a>`;
        }
        const resolved = resolveRelative(target.href, source, site);
        if (resolved.error) {
          errors.push(`${source}: ${resolved.error}`);
          return `<span class="broken-link">${inner}</span>`;
        }
        if (resolved.repoPath) {
          return `<span class="repo-path" title="Repository file: ${escapeHtml(resolved.repoPath)}">${inner}</span>`;
        }
        return `<a href="${escapeHtml(resolved.href)}"${renderTitle(title)}>${inner}</a>`;
      },
      image({ href, title, text }) {
        const target = classifyHref(href);
        if (target.kind === 'external') {
          return `<img src="${escapeHtml(target.href)}" alt="${escapeHtml(text)}"${renderTitle(title)}>`;
        }
        if (target.kind !== 'relative') return escapeHtml(text);
        const out = siteImage(target.href, source, site, errors);
        if (!out) return escapeHtml(text);
        return `<img src="${escapeHtml(out)}" alt="${escapeHtml(text)}"${renderTitle(title)}>`;
      },
    },
  });
  return marked;
}

function titleOf(markdown, fallback) {
  const marked = new Marked();
  const heading = marked.lexer(markdown).find((t) => t.type === 'heading' && t.depth === 1);
  return heading ? heading.text.replace(/`/g, '') : fallback;
}

function renderNav(site, current) {
  const sections = GROUP_ORDER.flatMap((group) => {
    const pages = site.pages.filter((page) => page.group === group);
    if (pages.length === 0) return [];
    const items = pages.map((page) => {
      const aria = page.out === current ? ' aria-current="page"' : '';
      return `<li><a href="${escapeHtml(page.out)}"${aria}>${escapeHtml(page.label)}</a></li>`;
    });
    return [`<p class="nav-group">${escapeHtml(group)}</p>\n<ul>\n${items.join('\n')}\n</ul>`];
  });
  return `<nav class="site-nav" aria-label="Documentation">\n<a class="brand" href="index.html">${SITE_NAME}</a>\n${sections.join('\n')}\n</nav>`;
}

function wrapTables(html) {
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

function renderPage(page, body, site) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} - ${SITE_NAME}</title>
<link rel="stylesheet" href="${STYLE_OUT}">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
${renderNav(site, page.out)}
<main id="content">
${wrapTables(body)}</main>
</body>
</html>
`;
}

/**
 * Renders every page in memory. Returns `{ files, errors }`: `files` maps output names to
 * contents (pages and the stylesheet), and `errors` lists links that cannot be resolved.
 */
export function renderSite(root = REPO_ROOT) {
  const errors = [];
  const sources = discoverSources(root);
  const pages = sources.map((page) => {
    const markdown = readFileSync(path.join(root, page.source), 'utf8');
    return { ...page, markdown, title: titleOf(markdown, page.label) };
  });
  const site = {
    root,
    pages,
    byRepoPath: new Map(pages.map((page) => [toPosix(page.source), page])),
    images: new Map(),
  };
  const files = new Map();
  for (const page of pages) {
    const body = createMarkdown(page.source, site, errors).parse(page.markdown, { async: false });
    files.set(page.out, renderPage(page, body, site));
  }
  files.set(STYLE_OUT, readFileSync(STYLE_FILE, 'utf8'));
  for (const [out, repoPath] of site.images)
    files.set(out, readFileSync(path.join(root, repoPath)));
  return { files, errors };
}

function idsOf(html) {
  return new Set(
    [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => unescapeHtml(match[1] ?? '')),
  );
}

/**
 * Checks every local `href` in the rendered pages: the target file must exist and, when the link
 * has a fragment, the target page must contain that id. Returns `{ errors, linkCount }`.
 */
export function checkLinks(files) {
  const errors = [];
  const ids = new Map(
    [...files]
      .filter(([name]) => name.endsWith('.html'))
      .map(([name, html]) => [name, idsOf(html)]),
  );
  let linkCount = 0;
  for (const [name, html] of files) {
    if (!name.endsWith('.html')) continue;
    for (const match of html.matchAll(/\ssrc="([^"]*)"/g)) {
      const src = unescapeHtml(match[1] ?? '');
      if (classifyHref(src).kind === 'external') continue;
      linkCount += 1;
      if (!files.has(src)) errors.push(`${name}: broken image "${src}" (not in the site)`);
    }
    for (const match of html.matchAll(/\shref="([^"]*)"/g)) {
      const href = unescapeHtml(match[1] ?? '');
      if (classifyHref(href).kind === 'external') continue;
      linkCount += 1;
      const [file = '', hash] = href.split('#');
      const target = file === '' ? name : file;
      if (!files.has(target)) {
        errors.push(`${name}: broken link to "${href}" (no such page)`);
      } else if (hash !== undefined && hash !== '' && !ids.get(target)?.has(safeDecode(hash))) {
        errors.push(`${name}: broken anchor "${href}" (no heading with that id in ${target})`);
      }
    }
  }
  return { errors, linkCount };
}

/** Writes the site into `outDir`, replacing the pages and stylesheet of an earlier build. */
export function writeSite(files, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const entry of readdirSync(outDir)) {
    if (entry.endsWith('.html') || entry === STYLE_OUT || entry === 'images') {
      rmSync(path.join(outDir, entry), { recursive: true });
    }
  }
  for (const [name, content] of files) {
    mkdirSync(path.dirname(path.join(outDir, name)), { recursive: true });
    writeFileSync(path.join(outDir, name), content);
  }
}

function parseArgs(args) {
  const outIndex = args.indexOf('--out');
  const outDir = outIndex === -1 ? undefined : args[outIndex + 1];
  if (outIndex !== -1 && !outDir) throw new Error('--out needs a directory.');
  return { check: args.includes('--check'), outDir: path.resolve(outDir ?? DEFAULT_OUT_DIR) };
}

function main(args) {
  const { check, outDir } = parseArgs(args);
  const { files, errors: renderErrors } = renderSite(REPO_ROOT);
  const { errors: linkErrors, linkCount } = checkLinks(files);
  const errors = [...renderErrors, ...linkErrors];
  if (!check) writeSite(files, outDir);
  const pageCount = [...files.keys()].filter((name) => name.endsWith('.html')).length;
  if (errors.length > 0) {
    console.error(`Docs: ${errors.length} broken link(s)`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  const action = check ? 'checked' : `built into ${path.relative(process.cwd(), outDir) || '.'}`;
  console.log(`Docs: ${pageCount} pages ${action}, ${linkCount} links ok`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
