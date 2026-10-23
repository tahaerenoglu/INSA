import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {FileStores,ArtifactStore} from '@insa/core';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
import {parseDxf} from '../packages/infra/src/cad-source.ts';
import {cadOverlay} from '../apps/web/src/CadInterpretation.tsx';
import {batchedCadOverlay} from '../apps/web/src/cad-source-overlay.ts';
import {InfrastructureView} from '../apps/web/src/infrastructure-view.ts';
const base='test-results/real-dxf02',project='real-railway-dxf-acceptance',root=`${base}/data`,assets=new ArtifactStore(root),p=createPlatform(new FileStores(root),assets),old=createPlatform(new FileStores('test-results/real-dxf/data'),new ArtifactStore('test-results/real-dxf/data'));
const state=await p.state(project,'infra'),previous=await old.state(project,'infra'),bim=await p.state(project,'bim'),drawing=Object.values(state.cadDrawings)[0],bytes=assets.readCadSource(project,drawing.asset),sourceHash=createHash('sha256').update(bytes).digest('hex');
assert.equal(sourceHash,drawing.sourceHash);assert.deepEqual(state.cadDrawings,previous.cadDrawings);assert.deepEqual(state.cadRegions,previous.cadRegions);assert.deepEqual(state.alignments,{});assert.deepEqual(bim.elements,{});
const human={id:'source-verifier',name:'Source verifier',kind:'human',roles:['bim_manager']},seq=await p.seq(project),q=await p.execute(human,project,'infra_query_cad',{drawing:drawing.id,inspection:{layer:'0_Prj_Eksen',candidate:'AX-01'}});
assert.equal(await p.seq(project),seq);const c=q.result.inspection.selected;assert.equal(c.reviewStatus,'current');assert.equal(c.review.unitDecision,'unresolved');assert.equal(c.review.contexts.length,2);assert.equal(c.review.associations.length,2);assert.equal(c.readiness.eligible,false);
await p.createSnapshot(project);const reopened=createPlatform(new FileStores(root),assets);assert.deepEqual(await reopened.state(project,'infra'),state);
fs.writeFileSync(`${base}/persistence-actual.json`,JSON.stringify({sourceHash,sourceBytes:bytes.length,sourceDrawingUnchanged:true,regionsUnchanged:true,readOnlySeqUnchanged:true,snapshotReopenEqual:true,review:c.review,readiness:c.readiness,canonicalAlignments:0,bimElements:0},null,2));
const doc=parseDxf(bytes),document={...doc,entities:doc.entities.filter(e=>['0_Prj_Eksen','0_Prj_Km'].includes(e.layer))},input={document,sourceAsset:drawing.asset,project};
const results={};for(const [name,make]of [['legacy',cadOverlay],['batched',batchedCadOverlay]]){const start=performance.now(),scene=make(input),view=new InfrastructureView();view.update(scene);let positionBytes=0;for(const o of view.group.children)positionBytes+=o.geometry.getAttribute('position').array.byteLength;results[name]={objects:view.group.children.length,sourceParts:scene.objects.reduce((n,o)=>n+(o.parts?.length??1),0),positionBufferBytes:positionBytes,constructMs:performance.now()-start};view.dispose();}
fs.writeFileSync(`${base}/performance-actual.json`,JSON.stringify({scope:'same current DXF, axis + kilometre layers; BufferAttribute bytes, not total VRAM; one local construction timing, not FPS',...results},null,2));console.log(JSON.stringify({persistence:'passed',sourceHash,reviewRevision:c.review.revision,performance:results}));
