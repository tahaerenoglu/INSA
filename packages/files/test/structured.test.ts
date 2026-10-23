import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Platform, MemoryStores, ArtifactStore } from '@insa/core';
import { filesModule } from '../src/index.js';
import { extractOffice, extractCsv } from '../src/structured.js';
const xlsx = () => zipSync({
  'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Metraj" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/sharedStrings.xml': strToU8('<sst><si><t>Length (m)</t></si></sst>'),
  'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>12.5</v></c></row><row r="2"><c r="B2" s="1"><f>B1*2</f><v>25</v></c></row></sheetData><mergeCells><mergeCell ref="A1:A2"/></mergeCells></worksheet>'),
});
test('F: XLSX upload -> governed registration -> structural evidence query preserves sheet/cell/formula/cache/merge and source revision', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insa-structured-'));
  t.after(() => { assert.ok(path.basename(dir).startsWith('insa-structured-')); fs.rmSync(dir, { recursive: true, force: true }); });
  const p = new Platform({ modules: [filesModule], stores: new MemoryStores(), artifacts: new ArtifactStore(dir) });
  const actor: any = { id: 'author', name: 'Author', kind: 'human', roles: ['bim_manager'] };
  const bytes = xlsx();
  const staged: any = await p.execute(actor, 'documents', 'files_upload', { filename: 'source.xlsx', base64: Buffer.from(bytes).toString('base64') });
  assert.equal(staged.result.extraction.status, 'text_ready');
  await p.execute(actor, 'documents', 'files_register', { asset: staged.result.asset, filename: 'source.xlsx' });
  const result: any = await p.execute(actor, 'documents', 'files_read_structure', { file: 'F-0001' });
  assert.equal(result.result.sheets[0].name, 'Metraj');
  assert.deepEqual(result.result.sheets[0].mergedCells, ['A1:A2']);
  const cell = result.result.sheets[0].cells.find((c: any) => c.reference === 'B2');
  assert.equal(cell.formula, 'B1*2'); assert.equal(cell.value, '25');
  assert.equal(cell.citation, 'F-0001 v1 Metraj!B2');
  const search: any = await p.execute(actor, 'documents', 'files_search', { query: 'Length' });
  assert.ok(JSON.stringify(search).includes('Length'));
  assert.deepEqual(p.requireArtifacts().readProjectFile('documents', staged.result.asset), Buffer.from(bytes));
  await assert.rejects(p.execute(actor, 'other', 'files_read_structure', { file: 'F-0001' }));
});
test('DOCX paragraphs/table text and quoted CSV fields are evidence; entity declarations are refused', () => {
  const data = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Dimension 300 mm</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cover 30 mm</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>') });
  assert.deepEqual(extractOffice(data, 'docx').paragraphs, ['Dimension 300 mm', 'Cover 30 mm']);
  const csv = extractCsv('name,value\n"pipe, branch","12\n34"');
  assert.equal(csv.sheets![0].cells.find(c => c.reference === 'A2')!.value, 'pipe, branch');
  assert.equal(csv.sheets![0].cells.find(c => c.reference === 'B2')!.value, '12\n34');
  const hostile = zipSync({ 'word/document.xml': strToU8('<!DOCTYPE a [<!ENTITY secret SYSTEM "file:///secret">]><document><body/></document>') });
  assert.throws(() => extractOffice(hostile, 'docx'), /DTD/);
});
