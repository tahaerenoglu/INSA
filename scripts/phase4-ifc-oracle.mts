/** Parse the real HTTP exports with web-ifc, independently of INSA's writer state. */
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),IFC=require('web-ifc'),api=new IFC.IfcAPI(),out='output/phase4-live-qa-2026-10-23';api.SetWasmPath(path.dirname(require.resolve('web-ifc'))+path.sep,true);await api.Init();
const acceptance=JSON.parse(fs.readFileSync(path.join(out,'acceptance.json'),'utf8')),results:any[]=[];
for(const [name,file]of [['density','density.ifc'],['assembly',acceptance.projects.assembly+'.ifc']]){
 const model=api.OpenModel(new Uint8Array(fs.readFileSync(path.join(out,file))));
 try{const ids=(type:number)=>{const vector=api.GetLineIDsWithType(model,type);return Array.from({length:vector.size()},(_,i)=>vector.get(i));};
  const products=ids(name==='density'?IFC.IFCVALVE:IFC.IFCELEMENTASSEMBLY).concat(name==='density'?ids(IFC.IFCSOLARDEVICE):[]),guids=products.map(id=>api.GetLine(model,id).GlobalId.value);
  assert.equal(new Set(guids).size,name==='density'?5000:2);
  const relations=ids(IFC.IFCRELDEFINESBYTYPE).map(id=>api.GetLine(model,id));
  if(name==='density'){assert.equal(ids(IFC.IFCVALVE).length,2500);assert.equal(ids(IFC.IFCSOLARDEVICE).length,2500);assert.equal(relations.length,2);assert.deepEqual(relations.map(r=>r.RelatedObjects.length).sort(),[2500,2500]);}
  else{assert.equal(ids(IFC.IFCELEMENTASSEMBLYTYPE).length,1);const parents=new Map<number,number>();for(const id of ids(IFC.IFCRELAGGREGATES)){const relation=api.GetLine(model,id);for(const child of relation.RelatedObjects){assert.equal(parents.has(child.value),false,'one IFC decomposition parent per product');parents.set(child.value,relation.RelatingObject.value);}}}
  results.push({name,independentParser:'web-ifc',products:products.length,uniqueGuids:new Set(guids).size,typeRelations:relations.length});
 }finally{api.CloseModel(model);}
}
fs.writeFileSync(path.join(out,'ifc-oracle.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
