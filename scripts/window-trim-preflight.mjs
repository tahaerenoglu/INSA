import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,modelIssues,thickness} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const source=await createPlatform().state('temiz-proje-20261013','bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const run=(tool,input)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
if(!Object.values(source.families).some(f=>f.name==='Pencere Ahşap Çıta'))await run('bim_create_families',{families:[{name:'Pencere Ahşap Çıta',category:'architecture.generic_model',parameters:[['width',.05],['depth',.02],['height',.05]].map(([key,value])=>({key,name:key,scope:'type',dataType:'length',required:true,default:value})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}}]});
const windows=Object.values(source.elements).filter(e=>e.kind==='hosted_component'&&source.types[e.type].kind==='window');
const types=[],components=[],seen=new Set();
for(const win of windows){
 const op=source.elements[win.opening],wall=source.elements[win.host],wt=source.types[wall.type];
 const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],len=Math.hypot(dx,dy),u=[dx/len,dy/len],side=wall.exterior==='left'?1:-1,n=[-u[1]*side,u[0]*side];
 const face=thickness(wt)/2+.01,center=[wall.start[0]+u[0]*op.along+n[0]*face,wall.start[1]+u[1]*op.along+n[1]*face],rotation=Math.atan2(u[1],u[0])*180/Math.PI;
 const specs=[['Alt',op.width+.1,.05,0,op.sill-.05],['Üst',op.width+.1,.05,0,op.sill+op.height],['Sol',.05,op.height,-(op.width+.05)/2,op.sill],['Sağ',.05,op.height,(op.width+.05)/2,op.sill]];
 for(const [label,width,height,along,z]of specs){
  const name=`Ahşap Çıta ${Math.round(width*1000)} × 20 × ${Math.round(height*1000)} mm`;
  if(!seen.has(name)){seen.add(name);types.push({kind:'component',name,family:'Pencere Ahşap Çıta',parameters:{width,depth:.02,height},material:'M-0006'});}
  components.push({storey:win.storey,type:name,name:`${win.id} — ${label} Ahşap Çıta`,x:center[0]+u[0]*along,y:center[1]+u[1]*along,offset:wall.baseOffset+z,rotation});
 }
}
await run('bim_create_types',{types});await run('bim_create_components',{components});const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
fs.mkdirSync('test-results/window-trim',{recursive:true});fs.writeFileSync('test-results/window-trim/inputs.json',JSON.stringify({project:'temiz-proje-20261013',types,components},null,2));
console.log(JSON.stringify({windows:windows.length,trimPieces:components.length,types:types.length,issues}));
