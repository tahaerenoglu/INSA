/** Derived engineering inspection. No section geometry is persisted. */
import {point3d,kmLabel,GeometryError,type Alignment3D} from './alignment.js';
import {roadSectionAt,roadRing,roadExtent,roadGeometry,validateRoad,ROAD_TOLERANCE,type RoadCorridor} from './road.js';
import {signedArea} from './section.js';
import {profileIntervals} from './road-profile.js';
import {localOrigin} from './tunnel.js';

function checkStation(road:RoadCorridor,station:number){
 if(!Number.isFinite(station)||station<road.from||station>road.to)throw new GeometryError(`Station must lie inside road interval [${road.from}, ${road.to}] m; values are not clamped.`);
}
export function roadEngineeringSection(road:RoadCorridor,a:Alignment3D,station:number){
 validateRoad(road,a);checkStation(road,station);
 const section=roadSectionAt(road,station),q=point3d(a,station),right:[number,number,number]=[Math.sin(q.az),-Math.cos(q.az),0];
 const point=(offset:number,relativeElevation:number)=>({offset_m:offset,elevation_m:q.z+relativeElevation,xyz:[q.x+offset*right[0],q.y+offset*right[1],q.z+relativeElevation]});
 const layers=road.layers.map((layer,i)=>{
  if(layer.profile){const ring=layer.profile,area=signedArea(ring),active=!layer.repeat||profileIntervals(layer,road.from,road.to).some(p=>station>=p.from&&station<=p.to);let moment=0;for(let j=0;j<ring.length;j++){const p=ring[j],n=ring[(j+1)%ring.length];moment+=(p[0]+n[0])*(p[0]*n[1]-n[0]*p[1])/6;}
   return {layerId:layer.id,name:layer.name,role:layer.role,materialId:layer.materialId,vertical_thickness_m:Math.max(...ring.map(p=>p[1]))-Math.min(...ring.map(p=>p[1])),left_extent_m:-Math.min(...ring.map(p=>p[0])),right_extent_m:Math.max(...ring.map(p=>p[0])),upper:ring.map(p=>point(...p)),lower:[] as ReturnType<typeof point>[],cross_section_area_m2:active?area:0,volume_per_horizontal_m:active?area+q.k*moment:0,top_width_sloping_m:0,active,explicitProfile:true};
  }
  const ring=roadRing(road,i,station),L=-ring[0][0],R=ring[2][0];
  const xs=[...new Set([-L,0,R,-section.leftWidth,section.rightWidth,...road.layers.slice(0,i).flatMap(l=>[-roadExtent(l.leftExtent,section,true),roadExtent(l.rightExtent,section,false)])].filter(x=>x>=-L&&x<=R))].sort((x,y)=>x-y);
  // Interpolate the existing ring's authoritative upper boundary; do not derive it from rendered meshes.
  const upperZ=(x:number)=>x<0?ring[4][1]+(-x/L)*(ring[5][1]-ring[4][1]):ring[4][1]+(x/R)*(ring[3][1]-ring[4][1]);
  return {layerId:layer.id,name:layer.name,role:layer.role,materialId:layer.materialId,vertical_thickness_m:layer.thickness,left_extent_m:L,right_extent_m:R,
   upper:xs.map(x=>point(x,upperZ(x))),lower:xs.map(x=>point(x,upperZ(x)-layer.thickness)),
   cross_section_area_m2:(L+R)*layer.thickness,
   volume_per_horizontal_m:layer.thickness*(L+R+q.k*(R*R-L*L)/2),
   top_width_sloping_m:L*Math.sqrt(1+section.leftCrossfall**2)+R*Math.sqrt(1+section.rightCrossfall**2)};
 });
 const offsets=[{label:'Sol banket kenarı',x:-section.leftWidth-section.leftShoulder},{label:'Sol kaplama kenarı',x:-section.leftWidth},{label:'Merkez',x:0},{label:'Sağ kaplama kenarı',x:section.rightWidth},{label:'Sağ banket kenarı',x:section.rightWidth+section.rightShoulder}];
 const top_points=road.layers[0].profile?[{label:'Ray üstü referansı',...point(0,0)}]:offsets.map(({label,x})=>({label,...point(x,Math.abs(x)*(x<0?section.leftCrossfall:section.rightCrossfall))}));
 const minJacobian=Math.min(...layers.flatMap(l=>[1-l.left_extent_m*q.k,1+l.right_extent_m*q.k]));
 if(minJacobian<.1)throw new GeometryError('Road width folds across the alignment curvature centre.');
 return {roadId:road.id,station_m:station,station_label:kmLabel(station),centerline_xyz:[q.x,q.y,q.z],orientation:{azimuth_rad:q.az,grade:q.grade,curvature_per_m:q.k,tangent_xyz:[Math.cos(q.az)/Math.sqrt(1+q.grade**2),Math.sin(q.az)/Math.sqrt(1+q.grade**2),q.grade/Math.sqrt(1+q.grade**2)],right_xyz:right,section_plane:'horizontal transverse offset / global vertical elevation'},parameters:section,top_points,layers,
  diagnostics:{minimum_curvature_jacobian:minJacobian,station_basis:'horizontal alignment chainage in metres',thickness:'vertical',area_basis:'true vertical transverse section; volume_per_horizontal_m additionally includes curvature Jacobian',crossfall:'negative descends outward; positive ascends outward',ownership:station===road.to?'final endpoint belongs to final interval':'control intervals are half-open',warnings:[] as string[]}};
}

/** Restrict control points, then reuse the same loft and Simpson quantity algorithm. */
export function roadIntervalQuantities(road:RoadCorridor,a:Alignment3D,from:number,to:number){
 validateRoad(road,a);checkStation(road,from);checkStation(road,to);
 if(to-from<.01)throw new GeometryError('Quantity interval must be increasing and at least 0.01 m long.');
 const restricted:RoadCorridor={...road,from,to,sections:[roadSectionAt(road,from),...road.sections.filter(s=>s.station>from&&s.station<to),roadSectionAt(road,to)]};
 const geometry=roadGeometry(restricted,a,localOrigin(a),ROAD_TOLERANCE);
 return {from,to,quantities:geometry.layers.map(l=>l.quantity),precision:{station_basis:'horizontal alignment chainage in metres',geometry_tolerance_m:ROAD_TOLERANCE,volume_reconciliation_relative_tolerance:1e-9,surface_area_basis:'engineering loft triangles; interval endpoints may refine tessellation',surface_reconciliation_relative_tolerance:1e-4,thickness:'vertical',integration:'same roadGeometry Simpson integral; horizontal curvature Jacobian included'}};
}
