import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platform, ai } from './fixtures.js';

test('batch corridors remain separate and share a component type', async () => {
  const p = platform();
  const project = 'batch-corridors';
  const run = async (tool: string, input: unknown) => {
    const result: any = await p.execute(ai, project, tool, input);
    assert.equal(result.status, 'applied');
    return result;
  };
  await run('infra_create_alignment', { name: 'Main', horizontal: [{ x: 0, y: 0 }, { x: 100, y: 0 }], vertical: [{ station: 0, z: 10 }, { station: 100, z: 10 }] });
  await run('infra_create_component_types', { types: [{ name: 'Deck', layer: { name: 'Deck concrete', role: 'subbase', thickness: .3, leftExtent: 6, rightExtent: 6, materialId: 'M-0001' } }] });
  const corridor = (name: string, from: number, to: number) => ({ name, alignment: 'AL-001', from, to,
    sections: [from, to].map(station => ({ station, leftWidth: 6, rightWidth: 6, leftShoulder: 0, rightShoulder: 0, leftCrossfall: 0, rightCrossfall: 0 })),
    layers: [{ componentType: 'CT-001' }],
  });
  const result = await run('infra_create_road_corridors', { corridors: [corridor('First', 0, 40), corridor('Second', 60, 100)] });
  assert.deepEqual(result.summary.created.map((x: any) => x.id), ['RD-001', 'RD-002']);
  const state: any = await p.state(project, 'infra');
  assert.equal(state.roads['RD-001'].layers[0].componentType, 'CT-001');
  assert.equal(state.roads['RD-002'].layers[0].componentType, 'CT-001');
  assert.equal(state.roads['RD-001'].name, 'First');
  assert.equal(state.roads['RD-002'].name, 'Second');
});
