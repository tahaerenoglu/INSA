import * as THREE from 'three';
import {stationAtDistance} from '@insa/infra/train-motion';
import type {CivilNavigationData} from './civil-navigation-view';
/** Camera sampling only: source stations, elevations and travelled metres remain canonical-derived. */
export function trainCameraPose(data:CivilNavigationData,positions:number[],distance:number,scale:number){
 const ds=data.distances!,stations=data.stations!,train=data.train!,total=ds.at(-1)!;
 function sample(d:number){d=THREE.MathUtils.clamp(d,0,total);let lo=0,hi=ds.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(ds[mid]<=d)lo=mid;else hi=mid;}const f=(d-ds[lo])/(ds[hi]-ds[lo]||1),a=new THREE.Vector3().fromArray(positions,lo*3),b=new THREE.Vector3().fromArray(positions,hi*3);return {point:a.clone().lerp(b,f),direction:b.sub(a).normalize(),elevation:data.elevations![lo]+(data.elevations![hi]-data.elevations![lo])*f,grade:(data.elevations![hi]-data.elevations![lo])/(stations[hi]-stations[lo])};}
 const here=sample(distance),ahead=sample(Math.min(total,distance+train.look_ahead)),up=new THREE.Vector3(0,1,0),offset=(p:ReturnType<typeof sample>)=>p.point.clone().addScaledVector(new THREE.Vector3().crossVectors(p.direction,up).normalize(),train.track_offset*scale).addScaledVector(up,train.eye_height*scale),eye=offset(here),target=distance+train.look_ahead>total?offset(ahead).addScaledVector(ahead.direction,(distance+train.look_ahead-total)*scale):offset(ahead);
 return {eye,target,station:stationAtDistance({stations,distances:ds},distance),elevation:here.elevation,grade:here.grade};
}
