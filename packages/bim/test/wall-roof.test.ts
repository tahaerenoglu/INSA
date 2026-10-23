import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Platform, MemoryStores } from '@insa/core';
import { bimModule, toIfc, quantities, wallRoof, type BimState } from '../src/index.js';
test('wall follows roof underside in representation, quantities and actual web-ifc tessellated solid; dependent edits are atomic', async () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const actor: any = { id: 'test', name: 'Test', kind: 'human', roles: ['bim_manager'] };
  const run = (tool: string, input: unknown) => p.execute(actor, 'roof', tool, input);
  await run('bim_create_storeys', { storeys: [{ name: 'Base', elevation: 0 }] });
  await run('bim_create_types', { types: [{ kind: 'wall', name: 'W', layers: [{ material: 'Concrete', thickness: .2 }] }, { kind: 'roof', name: 'R', layers: [{ material: 'Concrete', thickness: .2 }] }] });
  await run('bim_create_walls', { walls: [{ storey: 'Base', type: 'W', start: [0, 0], end: [5, 0], height: 3 }] });
  await run('bim_create_boundaries', { boundaries: [{ category: 'architecture.roof', type: 'R', storey: 'Base', outline: [[0, -1], [5, -1], [5, 1], [0, 1]], offset: 3 + .2 / Math.cos(Math.PI / 9), slope: { azimuth: 0, pitch: 20 } }] });
  await run('bim_attach_walls_to_roof', { roof: 'RF-0001', walls: ['W-0001'] });
  const s = await p.state<BimState>('roof', 'bim'), wall: any = s.elements['W-0001'];
  assert.ok(Math.abs(wallRoof(s, wall)!.start - 3) < 1e-9);
  const expectedVolume = 5 * .2 * (3 + 2.5 * Math.tan(Math.PI / 9));
  assert.ok(Math.abs(quantities(s, wall).gross_volume - expectedVolume) < 1e-8);
  const require = createRequire(import.meta.url), { IfcAPI } = require('web-ifc'), api = new IfcAPI();
  api.SetWasmPath(path.dirname(require.resolve('web-ifc')) + path.sep, true); await api.Init();
  const model = api.OpenModel(new TextEncoder().encode(toIfc(s, { projectKey: 'roof' }))), meshes = api.LoadAllGeometry(model);
  let volume = 0;
  try {
    for (let i = 0; i < meshes.size(); i++) {
      const mesh = meshes.get(i);
      if (api.GetLine(model, mesh.expressID).Tag?.value !== wall.id) continue;
      for (let j = 0; j < mesh.geometries.size(); j++) {
        const part = mesh.geometries.get(j), geometry = api.GetGeometry(model, part.geometryExpressID), vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize()), indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        let signed = 0;
        for (let k = 0; k < indices.length; k += 3) {
          const a = indices[k] * 6, b = indices[k + 1] * 6, c = indices[k + 2] * 6;
          signed += (vertices[a] * (vertices[b + 1] * vertices[c + 2] - vertices[b + 2] * vertices[c + 1]) + vertices[a + 1] * (vertices[b + 2] * vertices[c] - vertices[b] * vertices[c + 2]) + vertices[a + 2] * (vertices[b] * vertices[c + 1] - vertices[b + 1] * vertices[c])) / 6;
        }
        volume += Math.abs(signed); geometry.delete();
      }
    }
  } finally { api.CloseModel(model); }
  assert.ok(Math.abs(volume - expectedVolume) < 1e-4, `Tessellated volume ${volume}, analytic ${expectedVolume}`);
  const seq = await p.seq('roof');
  await assert.rejects(run('bim_update_elements', { items: [{ id: 'RF-0001', kind: 'boundary', set: { offset: -1 } }] }), (e: any) => e.reason === 'DEPENDENT_ELEMENT_INVALID');
  assert.equal(await p.seq('roof'), seq);
});
