import { createPlatform } from '../apps/manager-mcp/src/runtime.ts';
const p = createPlatform();
const project = 'plan-image-20261013';
const state = await p.state(project, 'bim');
const walls = Object.values(state.elements).filter(e => e.kind === 'wall' && e.vertical?.mode === 'storey');
const actor = { id: 'codex', name: 'Codex', kind: 'ai', roles: ['ai_agent'] };
console.log(JSON.stringify(await p.execute(actor, project, 'bim_update_elements', {
  items: walls.map(w => ({ id: w.id, kind: 'wall', set: { top_storey: w.vertical.storey } }))
}), null, 2));
