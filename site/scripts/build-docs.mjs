/**
 * Compile site/docs/*.md into a SvelteKit-style static shell at site/docs/dist/.
 * Mounted by FilePress at /docs via `paths: [{ url: '/docs', dir: 'docs/dist' }]`.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(root, '..', 'docs');
const outDir = join(docsRoot, 'dist');
const nav = JSON.parse(readFileSync(join(docsRoot, '_nav.json'), 'utf8'));

function slugify(text) {
	return String(text)
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}\s-]+/gu, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-');
}

function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function inlineFormat(text) {
	let s = escapeHtml(text);
	s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
	s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	return s;
}

/** Minimal Markdown → HTML (headings, fences, tables, lists, quotes, paragraphs). */
function renderMarkdown(md) {
	const lines = md.replace(/\r\n/g, '\n').split('\n');
	const html = [];
	const toc = [];
	let i = 0;
	let inCode = false;
	let codeLang = '';
	let codeBuf = [];
	let listType = null;
	let para = [];

	const flushPara = () => {
		if (para.length === 0) return;
		html.push(`<p>${inlineFormat(para.join(' '))}</p>`);
		para = [];
	};
	const flushList = () => {
		if (!listType) return;
		html.push(`</${listType}>`);
		listType = null;
	};

	while (i < lines.length) {
		const line = lines[i];

		if (inCode) {
			if (line.startsWith('```')) {
				html.push(
					`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
				);
				inCode = false;
				codeBuf = [];
				codeLang = '';
			} else {
				codeBuf.push(line);
			}
			i += 1;
			continue;
		}

		if (line.startsWith('```')) {
			flushPara();
			flushList();
			inCode = true;
			codeLang = line.slice(3).trim();
			i += 1;
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			flushPara();
			flushList();
			const level = heading[1].length;
			const text = heading[2].trim();
			const id = slugify(text);
			html.push(`<h${level} id="${id}">${inlineFormat(text)}</h${level}>`);
			if (level >= 2) toc.push({ level, id, text });
			i += 1;
			continue;
		}

		if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1])) {
			flushPara();
			flushList();
			const rows = [];
			while (i < lines.length && /^\|/.test(lines[i])) {
				const row = lines[i];
				i += 1;
				if (/^\|?\s*-+/.test(row)) continue;
				rows.push(
					row
						.replace(/^\|/, '')
						.replace(/\|$/, '')
						.split('|')
						.map((c) => c.trim()),
				);
			}
			if (rows.length > 0) {
				const [head, ...body] = rows;
				html.push('<table><thead><tr>');
				for (const c of head) html.push(`<th>${inlineFormat(c)}</th>`);
				html.push('</tr></thead><tbody>');
				for (const row of body) {
					html.push('<tr>');
					for (const c of row) html.push(`<td>${inlineFormat(c)}</td>`);
					html.push('</tr>');
				}
				html.push('</tbody></table>');
			}
			continue;
		}

		const ul = /^[-*]\s+(.+)$/.exec(line);
		const ol = /^\d+\.\s+(.+)$/.exec(line);
		if (ul || ol) {
			flushPara();
			const type = ul ? 'ul' : 'ol';
			if (listType !== type) {
				flushList();
				listType = type;
				html.push(`<${type}>`);
			}
			html.push(`<li>${inlineFormat((ul || ol)[1])}</li>`);
			i += 1;
			continue;
		}

		if (/^>\s?/.test(line)) {
			flushPara();
			flushList();
			const quote = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				quote.push(lines[i].replace(/^>\s?/, ''));
				i += 1;
			}
			html.push(`<blockquote><p>${inlineFormat(quote.join(' '))}</p></blockquote>`);
			continue;
		}

		if (/^\s*$/.test(line)) {
			flushPara();
			flushList();
			i += 1;
			continue;
		}

		flushList();
		para.push(line.trim());
		i += 1;
	}
	flushPara();
	flushList();
	if (inCode) {
		html.push(`<pre><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`);
	}
	return { html: html.join('\n'), toc };
}

function parseFrontmatter(raw) {
	if (!raw.startsWith('---')) return { meta: {}, body: raw };
	const end = raw.indexOf('\n---', 3);
	if (end < 0) return { meta: {}, body: raw };
	const fm = raw.slice(3, end).trim();
	const body = raw.slice(end + 4).replace(/^\n/, '');
	const meta = {};
	for (const line of fm.split('\n')) {
		const m = /^(\w+):\s*(.*)$/.exec(line.trim());
		if (!m) continue;
		meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
	return { meta, body };
}

function flatItems() {
	return nav.sections.flatMap((s) => s.items);
}

function pageHref(id) {
	return id === 'introduction' ? '/docs/' : `/docs/${id}`;
}

function renderPage(item, bodyHtml, toc, prev, next) {
	const title = item.title;
	const sidebar = nav.sections
		.map((section) => {
			const links = section.items
				.map((it) => {
					const current = it.id === item.id ? ' aria-current="page"' : '';
					return `<li><a href="${pageHref(it.id)}"${current}>${escapeHtml(it.title)}</a></li>`;
				})
				.join('\n');
			return `<div class="docs-nav-section"><h2>${escapeHtml(section.title)}</h2><ul>${links}</ul></div>`;
		})
		.join('\n');

	const tocHtml =
		toc.length === 0
			? ''
			: `<nav class="docs-toc" aria-label="On this page">
		<h2>On this page</h2>
		<ul>
			${toc
				.map(
					(t) =>
						`<li><a class="${t.level === 3 ? 'toc-h3' : ''}" href="#${t.id}">${escapeHtml(t.text)}</a></li>`,
				)
				.join('\n')}
		</ul>
	</nav>`;

	const prevHtml = prev
		? `<a class="prev" href="${pageHref(prev.id)}"><span class="label">Previous</span><span>${escapeHtml(prev.title)}</span></a>`
		: '<span></span>';
	const nextHtml = next
		? `<a class="next" href="${pageHref(next.id)}"><span class="label">Next</span><span>${escapeHtml(next.title)}</span></a>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${escapeHtml(title)} · DictaWhisper docs</title>
	<meta name="description" content="DictaWhisper documentation — ${escapeHtml(title)}" />
	<link rel="stylesheet" href="/docs/assets/docs.css" />
</head>
<body>
	<header class="docs-top">
		<button type="button" class="docs-menu-btn" data-docs-menu aria-label="Toggle docs menu">Menu</button>
		<a class="docs-brand" href="/docs/">DictaWhisper <span>docs</span></a>
		<nav class="docs-top-links">
			<a href="/">Home</a>
			<a href="/install">Install</a>
			<a href="https://github.com/Catalyst-Forge-LLC/dictawhisper">GitHub</a>
		</nav>
	</header>
	<div class="docs-shell">
		<aside class="docs-sidebar" aria-label="Docs">
			${sidebar}
		</aside>
		<main class="docs-main">
			<article class="docs-article">
				<h1>${escapeHtml(title)}</h1>
				${bodyHtml}
			</article>
			<nav class="docs-pager" aria-label="Paginate">
				${prevHtml}
				${nextHtml}
			</nav>
		</main>
		${tocHtml}
	</div>
	<script src="/docs/assets/docs.js" type="module"></script>
</body>
</html>
`;
}

function main() {
	if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
	mkdirSync(join(outDir, 'assets'), { recursive: true });
	cpSync(join(docsRoot, 'assets'), join(outDir, 'assets'), { recursive: true });

	const items = flatItems();
	const mdFiles = new Set(
		readdirSync(docsRoot)
			.filter((f) => f.endsWith('.md'))
			.map((f) => f.replace(/\.md$/, '')),
	);

	for (let idx = 0; idx < items.length; idx += 1) {
		const item = items[idx];
		const src = join(docsRoot, `${item.id}.md`);
		if (!existsSync(src)) {
			throw new Error(`docs: missing ${item.id}.md (listed in _nav.json)`);
		}
		mdFiles.delete(item.id);
		const raw = readFileSync(src, 'utf8');
		const { meta, body } = parseFrontmatter(raw);
		const title = meta.title || item.title;
		const pageItem = { ...item, title };
		const { html, toc } = renderMarkdown(body);
		const prev = idx > 0 ? items[idx - 1] : null;
		const next = idx < items.length - 1 ? items[idx + 1] : null;
		const page = renderPage(pageItem, html, toc, prev, next);
		if (item.id === 'introduction') {
			writeFileSync(join(outDir, 'index.html'), page);
		} else {
			mkdirSync(join(outDir, item.id), { recursive: true });
			writeFileSync(join(outDir, item.id, 'index.html'), page);
		}
	}

	if (mdFiles.size > 0) {
		console.warn(`docs: unused markdown files: ${[...mdFiles].join(', ')}`);
	}
	console.log(`docs: built ${items.length} pages → ${outDir}`);
}

main();
