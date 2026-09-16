import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Tables carry course/credit data on many catalogs; keep them as pipe tables.
turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const $ = cheerio.load((node as unknown as { outerHTML: string }).outerHTML ?? '');
    const rows: string[][] = [];
    $('tr').each((_i, tr) => {
      const cells: string[] = [];
      $(tr)
        .find('th,td')
        .each((_j, cell) => {
          cells.push($(cell).text().replace(/\s+/g, ' ').trim());
        });
      if (cells.some((cell) => cell.length)) rows.push(cells);
    });
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
    const [head, ...body] = rows;
    return [
      `| ${pad(head).join(' | ')} |`,
      `| ${Array(width).fill('---').join(' | ')} |`,
      ...body.map((r) => `| ${pad(r).join(' | ')} |`),
    ].join('\n');
  },
});

const STRIP = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'nav',
  'footer',
  'header',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '.skip-link',
  '.sr-only',
  '#skip',
].join(',');

/** Prefer the densest obvious content container, falling back to <body>. */
const CONTENT_SELECTORS = [
  'main',
  '[role="main"]',
  '#content',
  '#main-content',
  '#main',
  '.content',
  'article',
];

export function htmlToMarkdown(html: string, options: { maxLength?: number } = {}): string {
  const maxLength = options.maxLength ?? 200_000;
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return '';
  }

  $(STRIP).remove();

  let root: cheerio.Cheerio<never> = $('body') as unknown as cheerio.Cheerio<never>;
  let best = 0;
  for (const selector of CONTENT_SELECTORS) {
    const el = $(selector).first();
    if (!el.length) continue;
    const length = el.text().trim().length;
    if (length > best && length > 200) {
      best = length;
      root = el as unknown as cheerio.Cheerio<never>;
    }
  }

  const source = root.html() ?? $.html();
  let markdown: string;
  try {
    markdown = turndown.turndown(source);
  } catch {
    markdown = $(source).text();
  }

  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
    .slice(0, maxLength);
}

export function extractLinks(html: string, baseUrl: string): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return out;
  }
  $('a[href]').each((_i, el) => {
    const raw = $(el).attr('href');
    if (!raw) return;
    try {
      const href = new URL(raw, baseUrl).toString();
      out.push({ href, text: $(el).text().replace(/\s+/g, ' ').trim() });
    } catch {
      /* unparseable href */
    }
  });
  return out;
}
