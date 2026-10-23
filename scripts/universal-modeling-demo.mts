/** Reproducible, isolated examples. No live project state or source documents are changed. */
import fs from 'node:fs';
import path from 'node:path';
import { MemoryStores, ArtifactStore, type Actor } from '@insa/core';
import { createPlatform } from '../apps/manager-mcp/src/runtime.js';
const root = path.resolve(process.argv[2] ?? 'output/universal-modeling-demo-2026-10-23');
fs.mkdirSync(root, { recursive: true });
const p = createPlatform(new MemoryStores(), new ArtifactStore(root));
const actor: Actor = { id: 'demo', name: 'Isolated demo', kind: 'human', roles: ['bim_manager'] };
const evidence: any[] = [];
async function run(project: string, tool: string, input: unknown) {
  const result = await p.execute(actor, project, tool, input);
  evidence.push({ project, tool, input, result });
  return result as any;
}
await run('building', 'model_generate', { intent: 'Üç katlı toplam 200 m² ev ve taşıyıcı sistemi', requestId: 'building', requirements: { kind: 'building', floors: 3, totalArea: 200 } });
await run('building', 'model_export', { format: 'ifc' });
await run('building', 'model_generate', { intent: 'Binaya kavramsal temiz su ağı ekle', requestId: 'water', requirements: { kind: 'network', name: 'Domestic Cold Water', domain: 'piping', classification: 'domestic_cold_water', diameter: .025, shaft: [2, 2], routingSpaceApproved: true, terminals: [0, 1, 2].map(i => ({ storey: `UMB-L${i}`, at: [4, 2], offset: 2.5 })) } });
await run('building', 'model_generate', { intent: 'Kolon boyuna donatısı ve etriyeleri', requestId: 'rebar', requirements: { kind: 'reinforcement', hosts: ['C-0001', 'C-0002'], cover: .03, diameter: .016, stirrupDiameter: .008, spacing: .15, steelGrade: 'B500B' } });
await run('building', 'model_validate', {});
await run('building', 'model_export', { format: 'ifc' });
await run('building', 'model_export', { format: 'frag' });
await run('infrastructure', 'infra_create_alignment', { name: 'Verified example alignment', start_station: 1000, horizontal: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], vertical: [{ station: 1000, z: 10 }, { station: 3000, z: 20 }] });
await run('infrastructure', 'bim_create_materials', { materials: [{ name: 'Formation' }] });
await run('infrastructure', 'infra_create_component_types', { types: [{ name: 'Formation .30', layer: { name: 'Formation', role: 'subbase', thickness: .3, leftExtent: 3, rightExtent: 3, materialId: 'M-0001' } }] });
const section = (station: number) => ({ station, leftWidth: 3, rightWidth: 3, leftShoulder: 0, rightShoulder: 0, leftCrossfall: 0, rightCrossfall: 0 });
await run('infrastructure', 'model_generate', { intent: 'KM 1+000–3+000 arası kaynak güzergâh üzerinde koridor', requestId: 'corridor', requirements: { kind: 'corridor', definition: { name: 'Rail formation', alignment: 'AL-001', from: 1000, to: 3000, sections: [section(1000), section(3000)], layers: [{ componentType: 'CT-001' }] } } });
await run('infrastructure', 'model_validate', {});
fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
for (const project of ['building', 'infrastructure']) {
  fs.writeFileSync(path.join(root, `${project}-history.json`), JSON.stringify(await p.history(project), null, 2));
  for (const module of ['bim', 'infra']) fs.writeFileSync(path.join(root, `${project}-${module}-state.json`), JSON.stringify(await p.state(project, module), null, 2));
}
console.log(`Examples and governed export artifacts saved under ${root}`);
