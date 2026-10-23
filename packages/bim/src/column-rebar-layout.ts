/** Explicit parametric intent; regenerates existing bar-set identities inside the owning BIM transaction. */
import {DomainError,canonicalJson} from '@insa/core';
import type {BimState,Reinforcement,ColumnRebarLayout,RebarType} from './model.js';
export function columnRebarGeometry(s:BimState,hostId:string,cover:number,intent:ColumnRebarLayout){
 const host=s.elements[hostId],main=s.types[intent.mainType],tie=s.types[intent.tieType];
 if(!host||host.kind!=='profile_member'||host.placement!=='member_vertical'||host.category!=='structure.column'||host.direction==='down')throw new DomainError('Parametric rebar requires an upright column.','UNSUPPORTED_GEOMETRY');
 const t=s.types[host.type];
 if(!t||!('profile'in t)||t.profile.shape!=='rect')throw new DomainError('Parametric column rebar requires a rectangular section.','UNSUPPORTED_GEOMETRY');
 if(main?.kind!=='rebar'||tie?.kind!=='rebar'||!Number.isFinite(intent.spacing)||intent.spacing<=0||!['longitudinal','stirrups'].includes(intent.role))throw new DomainError('Invalid parametric reinforcement types or spacing.','INVALID_INPUT');
 const radius=main.diameter/2,tr=tie.diameter/2,tx=t.profile.b/2-cover-tr,ty=t.profile.h/2-cover-tr;
 const z0=host.baseOffset+cover+Math.max(radius,tr),z1=host.baseOffset+host.height-cover-Math.max(radius,tr),bend=Math.max(tie.diameter*2,radius+tr),mx=tx-bend,my=ty-bend;
 if(mx<=radius||my<=radius||tx<=2*bend||ty<=2*bend||z1<=z0||intent.spacing<tie.diameter)throw new DomainError('Cover, diameters and spacing do not fit the column.','INVALID_GEOMETRY');
 const a=host.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),v=(x:number,y:number,z:number):[number,number,number]=>[host.at[0]+x*c-y*sn,host.at[1]+x*sn+y*c,z];
 const count=Math.floor((z1-z0)/intent.spacing+1e-9)+1;if(count>500)throw new DomainError('Stirrup set exceeds 500 bars.','INVALID_GEOMETRY');
 return intent.role==='longitudinal'?{layers:[[-mx,-my],[mx,-my],[mx,my],[-mx,my]].map(([x,y])=>({path:[v(x,y,z0),v(x,y,z1)],count:1,spacing:.2,direction:[0,1,0] as [number,number,number]}))}:
 {layers:[{path:[v(-tx,-ty,z0),v(tx,-ty,z0),v(tx,ty,z0),v(-tx,ty,z0),v(-tx,-ty,z0)],count,spacing:intent.spacing,direction:[0,0,1] as [number,number,number]}],bendRadius:bend};
}
export function regenerateColumnRebar(s:BimState,before:BimState){
 const changes:{id:string;changes:Record<string,unknown>}[]=[];
 for(const e of Object.values(s.elements))if(e.kind==='reinforcement'&&e.layout){
  const old=before.elements[e.id] as Reinforcement|undefined,host=s.elements[e.host],priorHost=before.elements[e.host];
  const affected=!old||canonicalJson(e)!==canonicalJson(old)||canonicalJson(host)!==canonicalJson(priorHost)||
    [e.layout.mainType,e.layout.tieType,...(host&&'type'in host?[host.type]:[])].some(id=>canonicalJson(s.types[id])!==canonicalJson(before.types[id]));
  if(!affected)continue;
  const geometry=columnRebarGeometry(s,e.host,e.cover,e.layout);
  if(e.type!==(e.layout.role==='longitudinal'?e.layout.mainType:e.layout.tieType))throw new DomainError('Parametric set type must match its layout role.','INVALID_INPUT');
  const desired={...geometry,storey:host.storey,geometryValidation:'rectangular_column' as const};
  if(Object.entries(desired).some(([k,v])=>canonicalJson((e as any)[k])!==canonicalJson(v))){Object.assign(e,desired);changes.push({id:e.id,changes:desired});}
 }
 return changes;
}
