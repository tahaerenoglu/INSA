import * as THREE from 'three';
export const formatCivilStation=(s:number)=>`${Math.floor(s/1000)}+${(s%1000).toFixed(3).padStart(7,'0')}`;
/** Maps a displayed polyline pick to its engineering station, never 3D distance from origin. */
export function pickedCivilStation(point:THREE.Vector3,points:number[],stations:number[]){let best=Infinity,station=stations[0];const a=new THREE.Vector3(),b=new THREE.Vector3(),q=new THREE.Vector3(),d=new THREE.Vector3();for(let i=0;i<stations.length-1;i++){a.fromArray(points,i*3);b.fromArray(points,i*3+3);d.subVectors(b,a);const f=THREE.MathUtils.clamp(q.subVectors(point,a).dot(d)/(d.lengthSq()||1),0,1);q.copy(a).addScaledVector(d,f);const distance=q.distanceToSquared(point);if(distance<best){best=distance;station=stations[i]+f*(stations[i+1]-stations[i]);}}return station;}

