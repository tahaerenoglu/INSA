/** Bounded structural extraction. No formulas, macros, relationships or external entities are executed. */
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { posix } from 'node:path';
const array = (x: any): any[] => x === undefined ? [] : Array.isArray(x) ? x : [x];
const text = (x: any): string => x === undefined ? '' : typeof x !== 'object' ? String(x) : x['#text'] !== undefined ? String(x['#text']) : Object.entries(x).filter(([k]) => !k.startsWith('@_')).map(([, v]) => array(v).map(text).join('')).join('');
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false, removeNSPrefix: true });
const xml = (value: string) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error('DTD/entities are not supported');
  return parser.parse(value);
};
export type Structure = { kind: string; sheets?: { name: string; cells: { reference: string; value: string; formula?: string; style?: string; type?: string }[]; mergedCells: string[]; tables: unknown[] }[]; paragraphs?: string[]; warnings: string[] };
export function extractOffice(bytes: Uint8Array, kind: 'xlsx' | 'docx'): Structure {
  let size = 0, count = 0;
  const entries = unzipSync(bytes, { filter(entry) {
    if (++count > 2000 || entry.originalSize > 10_000_000 || (size += entry.originalSize) > 25_000_000) throw new Error('Office archive expansion limit exceeded');
    return /^(xl|word)\/.*(?:\.xml|\.rels)$/.test(entry.name);
  } });
  const read = (name: string) => entries[name] ? xml(strFromU8(entries[name])) : undefined;
  if (kind === 'docx') {
    const doc = read('word/document.xml');
    if (!doc?.document?.body) throw new Error('DOCX document missing');
    const paragraphs: string[] = [];
    const visit = (value: any, depth = 0) => {
      if (depth > 80) throw new Error('Document nesting limit exceeded');
      if (!value || typeof value !== 'object') return;
      for (const [key, v] of Object.entries(value)) {
        if (key === 'p') for (const p of array(v)) { if (paragraphs.length >= 10000) throw new Error('Paragraph limit exceeded'); paragraphs.push(text(p)); }
        else for (const item of array(v)) visit(item, depth + 1);
      }
    };
    visit(doc.document.body);
    return { kind, paragraphs, warnings: ['Paragraph/table-cell text extracted; page layout, drawings and field evaluation are not supported.'] };
  }
  const workbook = read('xl/workbook.xml')?.workbook;
  if (!workbook) throw new Error('XLSX workbook missing');
  const relationships = new Map(array(read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship).filter(r => r['@_TargetMode'] !== 'External').map(r => [r['@_Id'], r['@_Target']]));
  const shared = array(read('xl/sharedStrings.xml')?.sst?.si).map(text);
  let cells = 0;
  if (array(workbook.sheets?.sheet).length > 200) throw new Error('Worksheet limit exceeded');
  const sheets = array(workbook.sheets?.sheet).map(sheet => {
    const target = relationships.get(sheet['@_id']) as string | undefined;
    if (!target || target.includes('..') || /:/.test(target)) throw new Error('Unsupported worksheet relationship');
    const name = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const ws = read(name)?.worksheet;
    if (!ws) throw new Error('Worksheet missing');
    const records = array(ws.sheetData?.row).flatMap(row => array(row.c).map(c => {
      if (++cells > 50000) throw new Error('Workbook cell limit exceeded');
      const type = c['@_t'], cached = text(c.v), value = type === 's' ? shared[Number(cached)] ?? '' : type === 'inlineStr' ? text(c.is) : cached;
      if (value.length > 32767) throw new Error('Cell value limit exceeded');
      return { reference: String(c['@_r'] ?? ''), value, ...(c.f !== undefined ? { formula: text(c.f) } : {}), ...(c['@_s'] !== undefined ? { style: String(c['@_s']) } : {}), ...(type ? { type: String(type) } : {}) };
    }));
    const relPath = posix.join(posix.dirname(name), '_rels', posix.basename(name) + '.rels');
    const tableRels = new Map(array(read(relPath)?.Relationships?.Relationship).filter(r => r['@_TargetMode'] !== 'External').map(r => [r['@_Id'], r['@_Target']]));
    const tables = array(ws.tableParts?.tablePart).map(part => {
      const target = tableRels.get(part['@_id']);
      if (typeof target !== 'string' || /[:\\]/.test(target)) throw new Error('Invalid table relationship');
      const resolved = posix.normalize(posix.join(posix.dirname(name), target));
      if (!resolved.startsWith('xl/tables/')) throw new Error('Table relationship escapes workbook');
      return read(resolved)?.table;
    }).filter(Boolean);
    return { name: String(sheet['@_name']), cells: records, mergedCells: array(ws.mergeCells?.mergeCell).map(c => String(c['@_ref'])),
      tables };
  });
  return { kind, sheets, warnings: ['Formulas are stored with cached values and are never evaluated. Units/headings are source text, not inferred engineering facts. Styles are preserved by id; external links, charts and macros are not evaluated.'] };
}
export function extractCsv(value: string): Structure {
  const rows: string[][] = [[]]; let field = '', quoted = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') { if (quoted && value[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      rows.at(-1)!.push(field); field = '';
      if (ch !== ',') { if (ch === '\r' && value[i + 1] === '\n') i++; rows.push([]); }
    } else field += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  rows.at(-1)!.push(field);
  const col = (n: number): string => n < 26 ? String.fromCharCode(65 + n) : col(Math.floor(n / 26) - 1) + col(n % 26);
  const cells = rows.flatMap((row, r) => row.map((value, c) => ({ reference: `${col(c)}${r + 1}`, value })));
  if (cells.length > 50000) throw new Error('CSV cell limit exceeded');
  return { kind: 'csv', sheets: [{ name: 'CSV', cells, mergedCells: [], tables: [] }], warnings: ['CSV fields are literal text; no formulas are executed.'] };
}
