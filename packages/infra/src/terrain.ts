/** Engineering LandXML TIN: source connectivity preserved, no triangulation or smoothing. */
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {createHash} from 'node:crypto';import {DomainError,canonicalJson,type ArtifactStore} from '@insa/core';
export const TERRAIN_LIMITS={bytes:5*1024*1024,points:20000,faces:40000,gridEntries:1000000,pairChecks:2000000};
export type TerrainUnit='meter'|'foot'|'USSurveyFoot';
export const terrainUnitScale=(u:TerrainUnit)=>u==='meter'?1:u==='foot'?.3048:1200/3937;
export interface TerrainResource {id:string;name:string;category:'terrain_surface';engine:'landxml_tin';asset:string;sourceHash:string;sourceFormat:'LandXML-1.2';surfaceName:string;sourceCrs:string;xyUnit:TerrainUnit;zUnit:TerrainUnit;unitsConfirmed:true;verticalDatum:{name:string|null;status:'known'|'unresolved'|'assumed';confirmed:boolean};projectTransform:'bim.project.georef';revision:number;geometrySignature:string;materialId?:string;statistics:TerrainStats;diagnostics:string[];}
export interface TerrainStats {source_points:number;used_points:number;source_faces:number;triangles:number;invisible_faces:number;winding_flips:number;boundary_edges:number;boundary_loops:number;holes:number;bounds:{min:[number,number,number];max:[number,number,number]};projected_area_m2:number;surface_area_m2:number;}
interface Source {surfaceName:string;declaredCrs:string|null;declaredDatum:string|null;linearUnit:TerrainUnit;elevationAttributeUnit:string|null;points:{id:string;xyz:[number,number,number]}[];faces:{sourceIndex:number;ids:[string,string,string];visible:boolean}[];warnings:string[];}
export interface PreparedTerrain {positions:number[];indices:number[];source:Source;faceSources:number[];statistics:TerrainStats;grid:Map<string,number[]>;gridSize:number;boundaryLoops:number[][];}
const fail=(message:string):never=>{throw new DomainError(message,'INVALID_TERRAIN');};
const hasTag=(v:any,key:string):boolean=>v!==null&&typeof v==='object'&&(Object.hasOwn(v,key)||Object.values(v).some(x=>hasTag(x,key)));
const list=(v:any)=>v===undefined?[]:Array.isArray(v)?v:[v];
const unit=(text:string):TerrainUnit=>{const map:Record<string,TerrainUnit>={meter:'meter',foot:'foot',feet:'foot',USSurveyFoot:'USSurveyFoot',usSurveyFoot:'USSurveyFoot'};return Object.hasOwn(map,text)?map[text]:fail('Unsupported LandXML linear unit. Supported: meter, foot, USSurveyFoot.');};
const metadata=(value:any,label:string):string=>typeof value==='string'&&value.trim()&&value.length<=120?value:fail(`${label} must be nonempty and at most 120 characters.`);
const text=(v:any):string=>typeof v==='string'?v:v?.['#text']??'';
const safeId=(v:unknown)=>typeof v==='string'&&/^[1-9]\d{0,15}$/.test(v)?v:fail('LandXML P id must be a unique positive integer reference.');
export function parseLandXml(data:Uint8Array,surfaceName?:string):Source {
 if(!data.length||data.length>TERRAIN_LIMITS.bytes)fail('Terrain source exceeds 5 MiB limit or is empty.');
 let xml:string;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{fail('LandXML source must be UTF-8.');}
 if(/<!DOCTYPE|<!ENTITY/i.test(xml!)||/\x00/.test(xml!))fail('XML DTD/entities and NUL bytes are forbidden; no external resources are accessed.');
 if(/<\?xml[^>]*encoding\s*=\s*["'](?!utf-8["'])/i.test(xml!))fail('Only UTF-8 XML encoding is supported.');
 let depth=0;for(const tag of xml!.replace(/<!--[\s\S]*?-->/g,'').matchAll(/<[^>]+>/g)){const t=tag[0];if(t.startsWith('<?')||t.startsWith('<!'))continue;if(t.startsWith('</'))depth--;else if(!t.endsWith('/>'))depth++;if(depth>32)fail('XML nesting exceeds 32 levels.');}
 const valid=XMLValidator.validate(xml!);if(valid!==true)fail(`Malformed XML: ${valid.err.msg} at line ${valid.err.line}.`);
 let doc:any;try{doc=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,removeNSPrefix:true,processEntities:false,isArray:(name)=>['Surface','P','F'].includes(name)}).parse(xml!);}catch{fail('Malformed LandXML document.');}
 const root=doc?.LandXML;if(!root||root['@_version']!=='1.2')fail('Only LandXML version 1.2 is supported.');
 const units=root.Units?.Metric??root.Units?.Imperial;if(!units||Array.isArray(units)||root.Units?.Metric&&root.Units?.Imperial)fail('LandXML must declare exactly one Metric or Imperial Units block.');
 const linearUnit=unit(units['@_linearUnit']),surfaces=list(root.Surfaces?.Surface);if(!surfaces.length||surfaces.length>64)fail('LandXML needs 1–64 named surfaces.');for(const s of surfaces)metadata(s['@_name'],'Surface name');if(new Set(surfaces.map(s=>s['@_name'])).size!==surfaces.length)fail('Duplicate LandXML surface names are ambiguous.');
 const surface=surfaceName?surfaces.find(s=>s['@_name']===surfaceName):surfaces.length===1?surfaces[0]:undefined;if(!surface)fail(`Select one surface by name: ${surfaces.map(s=>s['@_name']).join(', ')}.`);
 const definition=surface.Definition;if(definition?.['@_surfType']!=='TIN')fail('Surface Definition must explicitly be TIN with Pnts and triangle Faces.');
 if(hasTag(surface,'Boundaries'))fail('Explicit LandXML boundary trimming is unsupported; supply the final clipped TIN faces. Boundaries will not be silently filled.');
 const points=list(definition.Pnts?.P).map(p=>{const values=text(p).trim().split(/\s+/).map(Number);if(values.length!==3||values.some(v=>!Number.isFinite(v)))fail('Each LandXML P must contain finite northing easting elevation.');return {id:safeId(p['@_id']),xyz:[values[1],values[0],values[2]] as [number,number,number]};});
 const faces=list(definition.Faces?.F).map((f,i)=>{const ids=text(f).trim().split(/\s+/);if(ids.length!==3)fail(`Face ${i+1} must reference exactly three points.`);if(f?.['@_i']!==undefined&&!['0','1'].includes(f['@_i']))fail(`Face ${i+1} has an invalid invisible flag.`);return {sourceIndex:i+1,ids:ids.map(safeId) as [string,string,string],visible:f?.['@_i']!=='1'};});
 if(points.length<3||points.length>TERRAIN_LIMITS.points||!faces.length||faces.length>TERRAIN_LIMITS.faces)fail('TIN needs 3–20000 points and 1–40000 source faces.');
 const cs=root.CoordinateSystem;if(Array.isArray(cs))fail('Multiple coordinate systems are unsupported.');
 if(cs?.['@_epsgCode']&&!/^\d{1,6}$/.test(cs['@_epsgCode']))fail('Invalid source EPSG identifier.');const declaredCrs=cs?.['@_epsgCode']?`EPSG:${cs['@_epsgCode']}`:cs?.['@_name']?metadata(cs['@_name'],'Source CRS'):null;
 return {surfaceName:surface['@_name']??fail('Surface needs a name.'),declaredCrs,declaredDatum:cs?.['@_verticalDatum']?metadata(cs['@_verticalDatum'],'Vertical datum'):null,linearUnit,elevationAttributeUnit:units['@_elevationUnit']??null,points,faces,warnings:[...(hasTag(surface,'Breaklines')?['Breakline metadata is retained in original XML; supplied face connectivity is authoritative.']:[])]};
}
const orient=(a:number[],b:number[],c:number[]) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const triangle=(p:number[],ids:number[])=>ids.map(i=>p.slice(3*i,3*i+3));
function positiveOverlap(a:number[][],b:number[][]){for(const poly of [a,b])for(let i=0;i<3;i++){const p=poly[i],q=poly[(i+1)%3],nx=-(q[1]-p[1]),ny=q[0]-p[0],projection=(r:number[][])=>r.map(v=>(v[0]-p[0])*nx+(v[1]-p[1])*ny),A=projection(a),B=projection(b);if(Math.max(...A)<=Math.min(...B)+1e-9||Math.max(...B)<=Math.min(...A)+1e-9)return false;}return true;}
function tJunction(a:number[][],b:number[][]){for(const p of a)for(let i=0;i<3;i++){const v=b[i],w=b[(i+1)%3],d=Math.hypot(w[0]-v[0],w[1]-v[1]);if(Math.abs(orient(v,w,p))<=1e-8*d){const t=((p[0]-v[0])*(w[0]-v[0])+(p[1]-v[1])*(w[1]-v[1]))/(d*d);if(t>1e-8&&t<1-1e-8)return true;}}return false;}
export function prepareTerrain(source:Source,xyUnit:TerrainUnit,zUnit:TerrainUnit):PreparedTerrain {
 if(xyUnit!==source.linearUnit)fail(`Declared XY unit ${xyUnit} conflicts with source ${source.linearUnit}.`);
 const positions=source.points.flatMap(p=>[p.xyz[0]*terrainUnitScale(xyUnit),p.xyz[1]*terrainUnitScale(xyUnit),p.xyz[2]*terrainUnitScale(zUnit)]),refs=new Map<string,number>(),xy=new Set<string>();
 source.points.forEach((p,i)=>{if(refs.has(p.id))fail(`Duplicate point reference ${p.id}.`);refs.set(p.id,i);const [x,y,z]=positions.slice(i*3,i*3+3);if(Math.abs(x)>1e8||Math.abs(y)>1e8||Math.abs(z)>100000)fail(`Point ${p.id} exceeds supported coordinate/elevation limits.`);const key=`${x},${y}`;if(xy.has(key))fail(`Duplicate XY location at point ${p.id}; terrain must be a single-valued height field.`);xy.add(key);});
 const indices:number[]=[],faceSources:number[]=[],seen=new Set<string>();let windingFlips=0;
 for(const f of source.faces){const ids=f.ids.map(id=>refs.get(id)??fail(`Face ${f.sourceIndex} references missing point ${id}.`)),key=ids.slice().sort((a,b)=>a-b).join(',');if(new Set(ids).size!==3||seen.has(key))fail(`Duplicate/invalid face ${f.sourceIndex}.`);seen.add(key);const tri=triangle(positions,ids),area=orient(...tri as [number[],number[],number[]]);if(Math.abs(area)<1e-8)fail(`Face ${f.sourceIndex} has zero or unsupported tiny projected area.`);if(!f.visible)continue;if(area<0){[ids[1],ids[2]]=[ids[2],ids[1]];windingFlips++;}indices.push(...ids);faceSources.push(f.sourceIndex);}
 if(!indices.length)fail('TIN has no visible surface faces.');
 const used=new Set(indices),min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];for(const i of used)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i*3+k]);max[k]=Math.max(max[k],positions[i*3+k]);}
 if(max[0]-min[0]>1e6||max[1]-min[1]>1e6)fail('Terrain extent exceeds 1000 km.');
 const gridSize=Math.max(1,Math.ceil(Math.sqrt(indices.length/3))),grid=new Map<string,number[]>(),edges=new Map<string,{a:number;b:number;faces:number[]}>();let projected=0,surfaceArea=0,entries=0,pairChecks=0;
 const cell=(x:number,y:number)=>[Math.max(0,Math.min(gridSize-1,Math.floor((x-min[0])/(max[0]-min[0])*gridSize))),Math.max(0,Math.min(gridSize-1,Math.floor((y-min[1])/(max[1]-min[1])*gridSize)))];
 for(let f=0;f<indices.length/3;f++){
  const ids=indices.slice(f*3,f*3+3),tri=triangle(positions,ids),[a,b,c]=tri;projected+=orient(a,b,c)/2;const u=b.map((v,k)=>v-a[k]),v=c.map((v,k)=>v-a[k]);surfaceArea+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;
  for(let i=0;i<3;i++){const A=ids[i],B=ids[(i+1)%3],key=[A,B].sort((a,b)=>a-b).join(','),edge=edges.get(key);if(edge){if(edge.faces.length===2||edge.a===A)fail(`Non-manifold/inconsistent edge at source face ${faceSources[f]}.`);edge.faces.push(f);}else edges.set(key,{a:A,b:B,faces:[f]});}
  const lo=cell(Math.min(...tri.map(p=>p[0])),Math.min(...tri.map(p=>p[1]))),hi=cell(Math.max(...tri.map(p=>p[0])),Math.max(...tri.map(p=>p[1]))),candidates=new Set<number>();
  for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++){if(++entries>TERRAIN_LIMITS.gridEntries)fail('TIN exceeds spatial indexing budget; split the source surface.');const key=`${x},${y}`,bucket=grid.get(key)??[];for(const other of bucket)candidates.add(other);bucket.push(f);grid.set(key,bucket);}
  for(const other of candidates){if(++pairChecks>TERRAIN_LIMITS.pairChecks)fail('TIN exceeds overlap validation budget; split the source surface.');const otherTri=triangle(positions,indices.slice(other*3,other*3+3));if(positiveOverlap(tri,otherTri))fail(`Overlapping faces ${faceSources[other]} and ${faceSources[f]}.`);if(tJunction(tri,otherTri)||tJunction(otherTri,tri))fail(`Non-conforming T-junction at faces ${faceSources[other]} and ${faceSources[f]}.`);}
 }
 const boundary=[...edges.values()].filter(e=>e.faces.length===1),out=new Map<number,number>(),incoming=new Set<number>();for(const e of boundary){if(out.has(e.a)||incoming.has(e.b))fail('Non-manifold boundary vertex (surface patches may not meet at a single point).');out.set(e.a,e.b);incoming.add(e.b);}
 const boundaryLoops:number[][]=[];const remaining=new Set(out.keys());while(remaining.size){const start=remaining.values().next().value!,loop:number[]=[];let i=start;do{if(!remaining.delete(i))fail('Invalid surface boundary loop.');loop.push(i);i=out.get(i)??fail('Open terrain boundary.');}while(i!==start);boundaryLoops.push(loop);}
 const holes=boundaryLoops.filter(loop=>{const origin=positions.slice(loop[0]*3,loop[0]*3+3);let area=0;for(let i=1;i<loop.length-1;i++)area+=orient(origin,positions.slice(loop[i]*3,loop[i]*3+3),positions.slice(loop[i+1]*3,loop[i+1]*3+3));return area<0;}).length;
 return {positions,indices,source,faceSources,grid,gridSize,boundaryLoops,statistics:{source_points:source.points.length,used_points:used.size,source_faces:source.faces.length,triangles:indices.length/3,invisible_faces:source.faces.filter(f=>!f.visible).length,winding_flips:windingFlips,boundary_edges:boundary.length,boundary_loops:boundaryLoops.length,holes,bounds:{min,max},projected_area_m2:projected,surface_area_m2:surfaceArea}};
}
export function terrainElevation(t:PreparedTerrain,x:number,y:number){
 if(!Number.isFinite(x)||!Number.isFinite(y))fail('Terrain query XY must be finite source/map metres.');const {min,max}=t.statistics.bounds;if(x<min[0]||x>max[0]||y<min[1]||y>max[1])return {status:'no-data' as const,x,y,z:null};
 const n=t.gridSize,cx=Math.min(n-1,Math.floor((x-min[0])/(max[0]-min[0])*n)),cy=Math.min(n-1,Math.floor((y-min[1])/(max[1]-min[1])*n));
 for(const f of t.grid.get(`${cx},${cy}`)??[]){const ids=t.indices.slice(f*3,f*3+3),[a,b,c]=triangle(t.positions,ids),p=[x,y],area=orient(a,b,c),w=[orient(b,c,p)/area,orient(c,a,p)/area,orient(a,b,p)/area];if(w.every(v=>v>=-1e-10&&v<=1+1e-10)){const clipped=w.map(v=>Math.max(0,Math.min(1,v))),total=clipped.reduce((a,b)=>a+b,0),weights=clipped.map(v=>v/total);return {status:'data' as const,x,y,z:weights[0]*a[2]+weights[1]*b[2]+weights[2]*c[2],sourceFace:t.faceSources[f],sourcePoints:ids.map(i=>t.source.points[i].id),weights};}}
 return {status:'no-data' as const,x,y,z:null};
}
/** Exact piecewise-planar section, using the existing XY grid. Offsets are horizontal metres. */
export function terrainProfile(t:PreparedTerrain,origin:[number,number],direction:[number,number],from:number,to:number){
 if(![...origin,...direction,from,to].every(Number.isFinite)||to<=from||to-from>2000||Math.abs(Math.hypot(...direction)-1)>1e-9)fail('Terrain profile requires a unit XY direction and increasing extent up to 2000 m.');
 const started=performance.now(),{min,max}=t.statistics.bounds,n=t.gridSize;let lo=from,hi=to;
 for(let k=0;k<2;k++){if(Math.abs(direction[k])<1e-14){if(origin[k]<min[k]||origin[k]>max[k])return {segments:[],noData:[{from,to}],metrics:{candidateTriangles:0,intersectedTriangles:0,preparationMs:performance.now()-started}};}else{const a=(min[k]-origin[k])/direction[k],b=(max[k]-origin[k])/direction[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}
 const candidates=new Set<number>(),cuts=[lo,hi];
 if(hi>lo){for(let k=0;k<2;k++)if(Math.abs(direction[k])>1e-14)for(let i=1;i<n;i++){const offset=(min[k]+(max[k]-min[k])*i/n-origin[k])/direction[k];if(offset>lo&&offset<hi)cuts.push(offset);}cuts.sort((a,b)=>a-b);
  // Adjacent cells cover sections exactly on a grid boundary and numerical endpoint roundoff.
  for(let i=0;i<cuts.length-1;i++){const d=(cuts[i]+cuts[i+1])/2,c=origin.map((v,k)=>Math.floor((v+d*direction[k]-min[k])/(max[k]-min[k])*n));for(let x=Math.max(0,c[0]-1);x<=Math.min(n-1,c[0]+1);x++)for(let y=Math.max(0,c[1]-1);y<=Math.min(n-1,c[1]+1);y++)for(const f of t.grid.get(`${x},${y}`)??[])candidates.add(f);}}
 const raw:{from:number;to:number;zFrom:number;zTo:number;sourceFace:number;sourcePoints:string[]}[]=[];
 for(const f of [...candidates].sort((a,b)=>t.faceSources[a]-t.faceSources[b])){const ids=t.indices.slice(f*3,f*3+3),[a,b,c]=triangle(t.positions,ids),area=orient(a,b,c),weights=(d:number)=>{const p=[origin[0]+direction[0]*d,origin[1]+direction[1]*d];return [orient(b,c,p)/area,orient(c,a,p)/area,orient(a,b,p)/area];},w0=weights(lo),w1=weights(hi);let left=lo,right=hi;
  for(let k=0;k<3;k++){const slope=(w1[k]-w0[k])/(hi-lo);if(Math.abs(slope)<1e-14){if(w0[k]<-1e-10){right=left;break;}}else{const edge=lo-w0[k]/slope;if(slope>0)left=Math.max(left,edge);else right=Math.min(right,edge);}}
  if(right-left>1e-8){const z=(d:number)=>weights(d).reduce((sum,w,k)=>sum+w*[a,b,c][k][2],0);raw.push({from:left,to:right,zFrom:z(left),zTo:z(right),sourceFace:t.faceSources[f],sourcePoints:ids.map(i=>t.source.points[i].id)});}}
 const breaks=[...new Set([from,to,...raw.flatMap(s=>[s.from,s.to])])].sort((a,b)=>a-b),segments:typeof raw=[],noData:{from:number;to:number}[]=[];
 // Sweep interval ownership deterministically, including a section coincident with a shared edge.
 const ordered=raw.slice().sort((a,b)=>a.from-b.from),active:typeof raw=[];let next=0;
 for(let i=0;i<breaks.length-1;i++){const a=breaks[i],b=breaks[i+1];if(b-a<=1e-8)continue;const mid=(a+b)/2;while(next<ordered.length&&ordered[next].from<=mid)active.push(ordered[next++]);for(let j=active.length-1;j>=0;j--)if(active[j].to<mid)active.splice(j,1);const owner=active.reduce<typeof raw[number]|undefined>((best,s)=>!best||s.sourceFace<best.sourceFace?s:best,undefined);if(owner){const z=(d:number)=>owner.zFrom+(d-owner.from)/(owner.to-owner.from)*(owner.zTo-owner.zFrom);segments.push({...owner,from:a,to:b,zFrom:z(a),zTo:z(b)});}else{const prev=noData.at(-1);if(prev&&Math.abs(prev.to-a)<1e-8)prev.to=b;else noData.push({from:a,to:b});}}
 if(segments.length>4000)fail('Section response exceeds 4000 terrain segments; reduce comparison extent.');
 return {segments,noData,metrics:{candidateTriangles:candidates.size,intersectedTriangles:raw.length,preparationMs:performance.now()-started}};
}
const cache=new Map<string,PreparedTerrain>();
export function loadTerrain(assets:ArtifactStore,project:string,resource:TerrainResource){const bytes=assets.readTerrainSource(project,resource.asset),key=canonicalJson([project,resource.sourceHash,resource.surfaceName,resource.xyUnit,resource.zUnit]);let terrain=cache.get(key);if(!terrain){terrain=prepareTerrain(parseLandXml(bytes,resource.surfaceName),resource.xyUnit,resource.zUnit);if(cache.size>=4)cache.delete(cache.keys().next().value!);cache.set(key,terrain);}return terrain;}
export const terrainSignature=(sourceHash:string,surfaceName:string,xyUnit:TerrainUnit,zUnit:TerrainUnit)=>createHash('sha256').update(canonicalJson([sourceHash,surfaceName,xyUnit,zUnit,'TIN-v1'])).digest('hex');
