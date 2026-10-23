import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platform, ai } from './fixtures.js';

test('batch tunnel creation keeps independent identities and reuses section types', async () => {
  const p = platform();
  const project = 'batch-tunnels';
  const run = async (tool: string, input: unknown) => {
    const result: any = await p.execute(ai, project, tool, input);
    assert.equal(result.status, 'applied');
    return result;
  };
  await run('infra_create_alignment', { name: 'Main', horizontal: [{ x: 0, y: 0 }, { x: 100, y: 0 }], vertical: [{ station: 0, z: 10 }, { station: 100, z: 10 }] });
  await run('infra_create_section_types', { types: [{ name: 'Shared shell', profile: { shape: 'circle', radius: 3, center_y: 0 }, layers: [{ name: 'Lining', thickness: .3 }] }] });
  const result = await run('infra_create_tunnels', { tunnels: [
    { name: 'First', alignment: 'AL-001', ranges: [{ from: 0, to: 40, section: 'TS-001' }] },
    { name: 'Second', alignment: 'AL-001', ranges: [{ from: 60, to: 100, section: 'TS-001' }] },
  ] });
  assert.deepEqual(result.summary.created.map((x: any) => x.id), ['TN-001', 'TN-002']);
  const state: any = await p.state(project, 'infra');
  assert.equal(state.tunnels['TN-001'].ranges[0].section, 'TS-001');
  assert.equal(state.tunnels['TN-002'].ranges[0].section, 'TS-001');
  assert.equal(state.tunnels['TN-001'].name, 'First');
  assert.equal(state.tunnels['TN-002'].name, 'Second');
});
