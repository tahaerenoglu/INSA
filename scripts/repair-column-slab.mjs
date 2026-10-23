import { createPlatform } from '../apps/manager-mcp/src/runtime.ts';
const p = createPlatform();
const project = 'plan-image-20261013';
const state = await p.state(project, 'bim');
const columns = Object.values(state.elements).filter(e => e.kind === 'profile_member' && e.category === 'structure.column' && e.placement === 'member_vertical' && e.vertical?.mode === 'storey');
const actor = { id: 'codex', name: 'Codex', kind: 'ai', roles: ['ai_agent'] };
const result = await p.execute(actor, project, 'bim_update_elements', {
  items: columns.map(c => ({ id: c.id, kind: 'column', set: { top_storey: c.vertical.storey } }))
});
console.log(JSON.stringify({ status: result.status, proposalId: result.proposalId, columns: columns.length, message: result.message }));
