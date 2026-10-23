import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});const run=(t,i)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',t,i);
if(!source.types['BT-0004'])await run('bim_create_types',{types:[{kind:'beam',name:'Merdiven Küpeştesi Ø40 mm',material:'Cephe Alüminyumu',profile:{shape:'circle',d:.04}},{kind:'column',name:'Merdiven Korkuluk Dikmesi Ø25 mm',material:'Cephe Alüminyumu',profile:{shape:'circle',d:.025}}]});
const members=[];
for(const e of Object.values(source.elements).filter(e=>e.kind==='stair')){
 const dx=e.end[0]-e.start[0],dy=e.end[1]-e.start[1],len=Math.hypot(dx,dy),u=[dx/len,dy/len],normal=[-u[1],u[0]],n=e.riserCount-1,rh=e.height/e.riserCount,td=len/n;
 for(const side of [-1,1]){
  const at=t=>[e.start[0]+u[0]*len*t+normal[0]*side*(e.width/2-.025),e.start[1]+u[1]*len*t+normal[1]*side*(e.width/2-.025)];
  const z=t=>e.baseOffset+rh+(e.height-rh)*t+1;
  members.push({category:'structure.brace',storey:e.storey,type:'BT-0004',start:at(0),end:at(1),start_offset:z(0),end_offset:z(1),name:`${e.id} — Eğimli Küpeşte`});
  for(let k=0;k<n;k++)for(let j=0;j<3;j++){const t=(k+(j+.5)/3)/n,base=e.baseOffset+(k+1)*rh;members.push({category:'structure.column',storey:e.storey,type:'CT-0003',at:at(t),base_offset:base,height:z(t)-base-.02,name:`${e.id} — Korkuluk Dikmesi`});}
 }
}
const horizontal=(storey,a,b,base,name)=>{
 members.push({category:'structure.brace',storey,type:'BT-0004',start:a,end:b,start_offset:base+1,end_offset:base+1,name});
 const len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(len/.1);for(let k=0;k<=n;k++)members.push({category:'structure.column',storey,type:'CT-0003',at:[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],base_offset:base,height:.98,name:`${name} — Dikme`});
};
for(let i=0;i<10;i++){const storey=i===0?'Zemin Kat':`${i}. Kat`;
 horizontal(storey,[5.225,3.465],[5.225,4.615],1.5,'Ara Sahanlık Sol Korkuluk');horizontal(storey,[7.775,3.465],[7.775,4.615],1.5,'Ara Sahanlık Sağ Korkuluk');horizontal(storey,[5.25,4.615],[7.75,4.615],1.5,'Ara Sahanlık Arka Korkuluk');
}
for(let i=1;i<=10;i++){
 const storey=`${i}. Kat`;
 horizontal(storey,[5.125,1.225],[5.125,4.715],0,'Kat Merdiven Boşluğu Sol');
 horizontal(storey,[7.875,1.225],[7.875,4.715],0,'Kat Merdiven Boşluğu Sağ');
 horizontal(storey,[5.15,4.715],[7.85,4.715],0,'Kat Merdiven Boşluğu Arka');
 horizontal(storey,[5.15,1.175],[6.55,1.175],0,'Kat Merdiven Boşluğu Ön');
}
await run('bim_create_profile_members',{members});const issues=modelIssues(await p.state('fixture','bim'));if(issues.length)throw Error(JSON.stringify(issues));console.log(JSON.stringify({members:members.length,issues}));
if(process.argv.includes('--propose')){const r=await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,'bim_create_profile_members',{members});console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));}
