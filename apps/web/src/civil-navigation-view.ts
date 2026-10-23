import {formatCivilStation,pickedCivilStation} from './civil-station';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBF from '@thatopen/components-front';
import {Line2} from 'three/examples/jsm/lines/Line2.js';
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js';

type P=[number,number,number];
export interface CivilNavigationData {train?:import('@insa/infra/train-motion').TrainSimulation;serverTime?:number;distances?:number[];elevations?:number[];metresToViewer?:number;revision:string;alignment:string;station:number;enabled:boolean;labels:boolean;camera_distance:number;diagnostic?:string;point?:P;tangent?:P;positions?:number[];stations?:number[];stationLabels?:{station:number;point:P}[];}

/** Adapter to existing world; geometry and authoritative station samples come from INSA. */
export class CivilNavigationView {
 private native:ReturnType<OBF.CivilNavigators['create']>|null=null;
 private root=new THREE.Group();private group=new THREE.Group();private line?:Line2;private key='';private labels:string[]=[];private removeEvents=()=>{};
 private markers:OBF.Marker;
 constructor(private components:OBC.Components,private world:OBC.World){this.markers=components.get(OBF.Marker);}
 async update(project:string|undefined,data:CivilNavigationData|null|undefined,transform:THREE.Matrix4){
  const {serverTime,...stable}=data??{};const key=JSON.stringify([project,stable,transform.elements]);if(this.key===key)return;this.clear();this.key=key;
  if(!data?.enabled||!data.point||!data.tangent||!data.positions||!data.stations)return;
  const vector=(p:P)=>new THREE.Vector3(...p).applyMatrix4(transform),positions:number[]=[];
  for(let i=0;i<data.positions.length;i+=3)positions.push(...vector(data.positions.slice(i,i+3) as P).toArray());
  const geometry=new LineGeometry();geometry.setPositions(positions);const material=new LineMaterial({color:0x146faa,linewidth:4,depthTest:false});
  const size=this.world.renderer!.getSize();material.resolution.copy(size);
  this.line=new Line2(geometry,material);this.line.computeLineDistances();this.line.userData.points=positions;this.group.userData.initialStation=data.stations[0];this.group.add(this.line);this.root.add(this.group);this.root.visible=!data.train||data.train.status==='stopped';this.world.scene.three.add(this.root);
  const manager=this.components.get(OBF.CivilNavigators),navigator=manager.create('insa-canonical');this.native=navigator;navigator.world=this.world;
  // Native cursor/label distance accumulation is 3D. Use canonical station samples instead.
  navigator.enabled=false;navigator.alignments.push(this.root);navigator.updateAlignments();navigator.highlight(this.group);manager.highlightMaterial.resolution.copy(size);
  const show=(point:THREE.Vector3,normal:THREE.Vector3,station:number,type:'select'|'hover',approximate=false)=>{navigator.setMarkerAtPoint({point,normal,curve:this.line! as unknown as THREE.Line,alignment:this.group},type);navigator.setCursorValue(`${approximate?'≈ ':''}Km ${formatCivilStation(station)}`,type);};
  const target=vector(data.point),normal=new THREE.Vector3(...data.tangent).transformDirection(transform);show(target,normal,data.station,'select');
  for(const label of data.stationLabels??[]){const el=document.createElement('span');el.textContent=formatCivilStation(label.station);el.style.cssText='background:#fff;color:#174467;border:1px solid #9bb4c7;border-radius:3px;padding:2px 4px;font-size:11px;pointer-events:none';const id=this.markers.create(this.world,el,vector(label.point),true);if(id)this.labels.push(id);}
  const caster=new OBF.CivilRaycaster(this.components);caster.world=this.world;caster.alignments.push(this.root);caster.update();let down=[0,0];
  const pick=(type:'select'|'hover')=>{if(data.train&&data.train.status!=='stopped')return;const hit=caster.castRay();if(!hit)return;const station=pickedCivilStation(hit.point,positions,data.stations!);show(hit.point,hit.normal,station,type,true);if(type==='select')void this.focus(hit.point,hit.normal,data.camera_distance);};
  const dom=this.world.renderer!.three.domElement,start=(e:PointerEvent)=>{down=[e.clientX,e.clientY];},end=(e:PointerEvent)=>{if(e.button===0&&Math.hypot(e.clientX-down[0],e.clientY-down[1])<4)pick('select');},move=()=>pick('hover');
  const resize=()=>{const size=this.world.renderer!.getSize();material.resolution.copy(size);manager.highlightMaterial.resolution.copy(size);};this.world.renderer!.onResize.add(resize);
  dom.addEventListener('pointerdown',start);dom.addEventListener('pointerup',end);dom.addEventListener('pointermove',move);
  this.removeEvents=()=>{dom.removeEventListener('pointerdown',start);dom.removeEventListener('pointerup',end);dom.removeEventListener('pointermove',move);this.world.renderer?.onResize.remove(resize);caster.dispose();};
  (window as any).__insaCivilNavigation={project,alignment:data.alignment,station:data.station,point:target.toArray(),source:'OBF.CivilNavigators',labels:this.labels.length};
  if(!data.train||data.train.status==='stopped')await this.focus(target,normal,data.camera_distance);
 }
 private async focus(point:THREE.Vector3,tangent:THREE.Vector3,distance:number){const right=new THREE.Vector3().crossVectors(tangent,new THREE.Vector3(0,1,0)).normalize(),eye=point.clone().addScaledVector(right,distance*.65).addScaledVector(tangent,-distance*.55);eye.y+=distance*.5;const camera=this.world.camera.three as THREE.PerspectiveCamera|THREE.OrthographicCamera;camera.far=Math.max(camera.far,distance*20);camera.updateProjectionMatrix();await this.world.camera.controls?.setLookAt(eye.x,eye.y,eye.z,point.x,point.y,point.z,false);}
 clear(){this.removeEvents();this.removeEvents=()=>{};if(this.native){this.native.world=null;this.components.get(OBF.CivilNavigators).delete('insa-canonical');this.native=null;}for(const id of this.labels)this.markers.delete(id);this.labels=[];this.root.removeFromParent();this.root.clear();if(this.line){this.line.geometry.dispose();(this.line.material as LineMaterial).dispose();this.line=undefined;}this.group.clear();if(typeof window!=='undefined')(window as any).__insaCivilNavigation=null;}
 dispose(){this.clear();this.key='';}
}
