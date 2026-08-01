'use strict';
//
// Dependency-free Markdown -> HTML renderer, scoped to the Delesign brief subset.
//
// WHY THIS EXISTS: Delesign's long-form project fields (description, script,
// inspiration) are CKEditor 5 rich-text editors. They render the submitted
// string as HTML. If we POST raw Markdown, the control characters (#, **, |,
// >, ---) show literally and single newlines collapse to whitespace, so the
// brief renders as unreadable run-on soup (observed live on project 69964).
//
// This converter turns the brief's Markdown subset into CKEditor-friendly HTML:
//   headings (#..######), bold (**/__), italic (*/_), inline code (`),
//   links [t](u), blockquotes (>), horizontal rules (---/***),
//   bullet/numbered lists, GFM pipe tables, blank-line paragraphs.
//
// Intentionally NOT a full CommonMark/GFM implementation — the brief structure
// is known and bounded. Unit-tested in __tests__/md-to-html.test.js.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// URL scheme allowlist. Markdown links become <a href>, so an unsafe scheme
// (javascript:, data:, vbscript:, …) would be an injection vector. Allow only
// http/https/mailto and relative URLs; reject anything else.
function safeHref(url) {
  const s = String(url).trim();
  if (/^(https?:|mailto:)/i.test(s)) return s;          // allowed schemes
  if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return null;     // any other scheme → reject
  return s;                                              // no scheme → relative, allowed
}
function attrEscape(s) {
  // value already HTML-escaped for &<>; also neutralize quotes that could break the attribute
  return String(s).replace(/"/g, '%22').replace(/'/g, '%27');
}

// Inline formatting. Applied to RAW (un-escaped) text; escapes first so brief
// text containing &, <, > is safe, then promotes Markdown spans to tags.
// Order matters: code first (protects its contents), then links, bold, italic.
function inline(text) {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = safeHref(url);
    return href ? `<a href="${attrEscape(href)}">${label}</a>` : label; // unsafe scheme → render label as plain text
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_\w])_([^_\s][^_]*?)_/g, '$1<em>$2</em>');
  return t;
}

// Map Markdown heading depth to CKEditor-safe levels (h2..h4); h1 is reserved
// for the page/project title in most CKEditor builds.
function headingLevel(hashes) {
  const n = hashes.length;
  if (n <= 1) return 2;
  if (n === 2) return 3;
  return 4;
}

function isTableSep(line) {
  if (line == null) return false;
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes('-') && line.includes('|');
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function mdToHtml(md) {
  const lines = String(md == null ? '' : md).replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') { flushPara(); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushPara(); html.push('<hr>'); i++; continue; }

    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); const lvl = headingLevel(h[1]); html.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }

    // GFM table: a row line immediately followed by a separator line
    if (trimmed.includes('|') && isTableSep(lines[i + 1])) {
      flushPara();
      const header = splitRow(trimmed);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        body.push(splitRow(lines[i]));
        i++;
      }
      let tbl = '<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>';
      tbl += '<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
      html.push(tbl);
      continue;
    }

    // Blockquote (consecutive > lines)
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      const inner = [];
      let qp = [];
      const fq = () => { if (qp.length) { inner.push(`<p>${qp.map(inline).join('<br>')}</p>`); qp = []; } };
      let qItems = null;
      const fqList = () => { if (qItems && qItems.length) { inner.push('<ul>' + qItems.map((it) => `<li>${inline(it)}</li>`).join('') + '</ul>'); qItems = null; } };
      for (const ql of quote) {
        const qt = ql.trim();
        if (qt === '') { fq(); fqList(); }
        else if (/^[-*+]\s+/.test(qt)) { fq(); (qItems = qItems || []).push(qt.replace(/^[-*+]\s+/, '')); }
        else { fqList(); qp.push(ql); }
      }
      fq(); fqList();
      html.push(`<blockquote>${inner.join('')}</blockquote>`);
      continue;
    }

    // Bullet list
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      html.push('<ul>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i++;
      }
      html.push('<ol>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ol>');
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return html.join('\n');
}

module.exports = { mdToHtml, escapeHtml };
