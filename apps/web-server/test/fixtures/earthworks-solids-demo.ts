import {ArtifactStore} from '@insa/core';import {createPlatform} from '../../../manager-mcp/src/runtime.js';
import {planeXml,bytes} from '../../../../packages/infra/test/terrain-fixture.js';
const human:any={id:'isolated-fixture',name:'Isolated engineering fixture',kind:'human',roles:['bim_manager']};
export async function buildSolidDemo(p:ReturnType<typeof createPlatform>,assets:ArtifactStore,project:string,kind='fill'){
 const run=(tool:string,input:any)=>p.execute(human,project,tool,input);
 await run('bim_set_project',{name:`03B-2B ${kind} — doğrulanmış katılar`});
 await run('bim_set_georeference',{crs:{name:'EPSG:5254',vertical_datum:'QA datum'},eastings:412000,northings:4561000,orthogonal_height:60});
 await run('infra_set_crs',{crs:'EPSG:5254'});await run('bim_create_materials',{materials:[{name:'Asphalt',color:'#404040',appearance:{baseColor:'#404040',roughness:.9}},{name:'Reference Concrete',color:'#bbbbbb'}]});
 await run('bim_create_storeys',{storeys:[{name:'Referans',elevation:0}]});await run('bim_create_types',{types:[{kind:'column',name:'Referans Kolon',material:'Reference Concrete',profile:{shape:'rect',b:.5,h:.5}}]});await run('bim_create_columns',{columns:[{type:'Referans Kolon',storey:'Referans',at:[10,30],height:3}]});
 const circular=kind==='curve',from=circular?70:0,to=circular?70+Math.PI*15:100;
 await run('infra_create_alignment',{name:'Engineering source alignment',horizontal:circular?[{x:412030,y:4561050},{x:412130,y:4561050,radius:30},{x:412130,y:4561150}]:[{x:412000,y:4561050},{x:412100,y:4561050}],vertical:[{station:0,z:62},{station:250,z:62}]});
 await run('infra_create_road_corridor',{name:'Road corridor',alignment:'AL-001',from,to,sections:[from,to].map(station=>({station,leftWidth:3,rightWidth:3,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0})),layers:[{name:'Asphalt',role:'wearing',materialId:'M-0001',thickness:.2,leftExtent:'pavement',rightExtent:'pavement'}]});
 const xml=planeXml(4,4,50,0,kind==='hole').replace(/(<P id="\d+">)([\d.]+) ([\d.]+) ([\d.]+)(<\/P>)/g,(_,prefix,y,x,_z,end)=>`${prefix}${y} ${x} ${kind==='tin'?60+Math.abs(Number(x)-412050)/100:60}${end}`),asset=assets.saveTerrainSource(project,bytes(xml));
 await run('infra_import_terrain',{name:'Validated existing TIN',asset:asset.id,sourceCrs:'EPSG:5254',xyUnit:'meter',zUnit:'meter',unitsConfirmed:true,verticalDatum:'QA datum'});
 const elevation=kind==='cut'||circular||kind==='vary'?59:kind==='mixed'?60:61,control=(station:number)=>({station,centerOffset:0,elevation:kind==='vary'&&station===to?61:elevation,leftWidth:circular?2:3,rightWidth:circular?4:3,leftSlope:kind==='mixed'?.1:0,rightSlope:kind==='mixed'?-.1:0});
 const input={name:'Approved explicit formation',road:'RD-001',terrain:'TR-001',from,to,unit:'meter',reference:{kind:'absolute-global',approved:true},sections:[control(from),control(to)],slopes:{left:{cutH:1.5,fillH:1.5},right:{cutH:2,fillH:1.5}},searchLimit:20};await run('infra_upsert_earthworks_design',input);
 await run('infra_upsert_earthwork_zones',{design:'EW-001',zones:(kind==='fill'?[0,100/3,200/3]:[from]).map((start,i)=>({name:`Engineering zone ${i+1}`,from:start,to:kind==='fill'?(i+1)*100/3:to,side:'both',operation:'mixed'}))});
 return input;
}
