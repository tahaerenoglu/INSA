import {TrainView} from './train-view';
import {GoogleMapView} from './google-map-view';
import type {MapReference} from './google-map-transform';
import {CivilNavigationView} from './civil-navigation-view';
/**
 * 3D viewer on ThatOpen Components (APIs verified against the installed
 * @thatopen/components 3.4 / components-front 3.4 / fragments 3.4 typings).
 * Selection is ID-based: viewer localId <-> IFC GlobalId <-> platform element id.
 */
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import { MaterialAppearanceView } from "./material-appearance";
import {InfrastructureView,type InfraScene} from './infrastructure-view';

export class Viewer {
  private components = new OBC.Components();
  private world!: OBC.SimpleWorld<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>;
  private fragments!: OBC.FragmentsManager;
  private highlighter!: OBF.Highlighter;
  private modelId: string | null = null;
  private firstLoad = true;
  private disposed = false;
  private loadVersion = 0;
  private loadQueue: Promise<void> = Promise.resolve();
  private resolveReady!: () => void;
  private ready = new Promise<void>((resolve) => { this.resolveReady = resolve; });
  private appearances:MaterialAppearanceView|null=null;
  private appearanceQueue:Promise<void>=Promise.resolve();
  private removeAppearanceClick:()=>void=()=>{};
  onSelect: (globalId: string | null) => void = () => {};
  onInfraSelect:(id:string|null)=>void=()=>{};
  private infrastructure=new InfrastructureView();
  private civilNavigation?:CivilNavigationView;
  private train?:TrainView;
  private googleMap?:GoogleMapView;
  private measurementMode=false;
  private measurementSnapping=true;
  private measurementStart:THREE.Vector3|null=null;
  private pendingMeasurementMarker:THREE.Mesh|null=null;
  private measurementGroup=new THREE.Group();
  onMeasurement:(distance:number|null,awaitingSecondPoint?:boolean)=>void=()=>{};
  private infrastructureVersion=0;
  onAppearanceWarnings:(warnings:string[])=>void=()=>{};

  async init(container: HTMLElement) {
    const worlds = this.components.get(OBC.Worlds);
    this.world = worlds.create<OBC.SimpleScene, OBC.OrthoPerspectiveCamera, OBC.SimpleRenderer>();
    this.world.scene = new OBC.SimpleScene(this.components);
    this.world.scene.setup();
    this.world.scene.three.background = new THREE.Color(0xf3f5f7);
    this.world.renderer = new OBF.RendererWith2D(this.components, container);
    const overlay=(this.world.renderer as OBF.RendererWith2D).three2D.domElement;overlay.style.pointerEvents='none';container.appendChild(overlay);
    this.world.camera = new OBC.OrthoPerspectiveCamera(this.components);
    await this.world.camera.controls.setLookAt(22, 18, 22, 6, 0, 4);
    this.components.init();
    this.civilNavigation=new CivilNavigationView(this.components,this.world);
    this.train=new TrainView(this.components,this.world);
    this.googleMap=new GoogleMapView(this.components,this.world);
    this.world.scene.three.add(this.infrastructure.group);
    this.world.scene.three.add(this.measurementGroup);
    this.components.get(OBC.Grids).create(this.world);

    this.fragments = this.components.get(OBC.FragmentsManager);
    this.fragments.init("/fragments-worker.mjs"); // served locally, version-matched
    this.world.camera.controls.addEventListener("rest", () => void this.fragments.core.update(true));
    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three);
      this.world.scene.three.add(model.object);
      void this.fragments.core.update(true);
    });

    this.components.get(OBC.Raycasters).get(this.world);
    this.highlighter = this.components.get(OBF.Highlighter);
    this.highlighter.setup({ world: this.world,autoHighlightOnClick:false });
    this.highlighter.zoomToSelection = false;
    this.highlighter.events.select.onHighlight.add(async (map) => {
      const [modelId, ids] = Object.entries(map)[0] ?? [];
      const localId = ids ? [...ids][0] : undefined;
      const model = modelId ? this.fragments.list.get(modelId) : undefined;
      if (!model || localId === undefined) return;
      const [guid] = await model.getGuidsByLocalIds([localId]);
      this.appearances?.highlight(guid??null);
      this.onSelect(guid ?? null);
    });
    this.highlighter.events.select.onClear.add(() => {this.appearances?.highlight(null);this.onSelect(null);});
    this.resolveReady();
    const raycaster=new THREE.Raycaster();let down:[number,number]=[0,0];
    raycaster.params.Line.threshold=.3;
    const start=(e:PointerEvent)=>{down=[e.clientX,e.clientY];};
    let pickVersion=0;
    const end=async(e:PointerEvent)=>{
      if(e.button!==0||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;
      const version=++pickVersion;
      const rect=container.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),this.world.camera.three);
      const hit=this.appearances?raycaster.intersectObject(this.appearances.group,true).find(h=>h.object.userData.guid):undefined;
      const model=this.modelId?this.fragments.list.get(this.modelId):undefined,dom=this.world.renderer?.three?.domElement;
      const native=model&&dom?await model.raycast({camera:this.world.camera.three,mouse:new THREE.Vector2(e.clientX,e.clientY),dom,...(this.measurementMode&&this.measurementSnapping?{snappingClasses:[FRAGS.SnappingClass.POINT,FRAGS.SnappingClass.LINE]}:{})}).catch(()=>null):null;
      if(this.disposed||version!==pickVersion||model?.modelId!==(this.modelId??undefined))return;
      const infraHit=raycaster.intersectObject(this.infrastructure.group,true).find(h=>h.object.visible&&h.object.userData.infraId);
      if(this.measurementMode){
        const closestInfra=infraHit&&infraHit.distance<Math.min(hit?.distance??Infinity,native?.distance??Infinity);
        const closestAppearance=hit&&hit.distance<(native?.distance??Infinity);
        const selectedHit=closestInfra?infraHit:closestAppearance?hit:undefined;
        let point=closestInfra||closestAppearance?selectedHit?.point.clone():native?.point.clone();
        if(selectedHit&&this.measurementSnapping)point=snapMeshIntersection(selectedHit,e.clientX,e.clientY,rect,this.world.camera.three)??point;
        if(point)this.addMeasurementPoint(point);
        return;
      }
      if(infraHit&&infraHit.distance<Math.min(hit?.distance??Infinity,native?.distance??Infinity)){await this.highlighter.clear('select');this.appearances?.highlight(null);const sourceId=this.infrastructure.pick(infraHit);if(sourceId){this.infrastructure.select(sourceId);this.onInfraSelect(sourceId);}return;}
      this.infrastructure.select(null);
      let guid=hit?.object.userData.guid as string|undefined;
      if(native&&(!hit||native.distance<hit.distance)){const ids=await model!.getGuidsByLocalIds([native.localId]);guid=ids[0]??undefined;}
      if(guid)await this.select(guid,false);else await this.clearSelection();
    };
    container.addEventListener('pointerdown',start);container.addEventListener('pointerup',end);
    this.removeAppearanceClick=()=>{container.removeEventListener('pointerdown',start);container.removeEventListener('pointerup',end);};
  }

  /** Replaces the model with a new version (the camera is kept after the first load). */
  async load(bytes: Uint8Array, key: string) {
    const version = ++this.loadVersion;
    const replace = async () => {
      await this.ready;
      if (this.disposed || version !== this.loadVersion) return;
      const id = `${key}-${version}`;
      const model = await this.fragments.core.load(bytes, { modelId: id });
      if (this.disposed || version !== this.loadVersion) {
        this.world.scene.three.remove(model.object);
        if (!this.disposed) await this.fragments.core.disposeModel(id);
        return;
      }
      await this.highlighter.clear("select");
      const oldId = this.modelId;
      await this.appearanceQueue;
      if(this.appearances){this.world.scene.three.remove(this.appearances.group);this.appearances.dispose();this.appearances=null;}
      this.modelId = id;
      if (oldId) {
        const old = this.fragments.list.get(oldId);
        if (old) this.world.scene.three.remove(old.object);
        await this.fragments.core.disposeModel(oldId);
      }
      await this.fragments.core.update(true);
      if (this.firstLoad) { this.firstLoad = false; await this.world.camera.fitToItems(); }
    };
    const pending = this.loadQueue.then(replace);
    this.loadQueue = pending.catch(() => {});
    return pending;
  }

  /** Highlights (and optionally zooms to) an element by its IFC GlobalId. */
  async select(globalIds: string|string[], zoom = true) {
    this.infrastructure.select(null);
    const model = this.modelId ? this.fragments.list.get(this.modelId) : undefined;
    if (!model) return;
    const guids=typeof globalIds==='string'?[globalIds]:globalIds,globalId=guids[0];
    const localIds=(await model.getLocalIdsByGuids(guids)).filter((id):id is number=>id!==null&&id!==undefined);
    if (!localIds.length) return;
    const map: OBC.ModelIdMap = { [model.modelId]: new Set(localIds) };
    if(this.appearances?.has(globalId)){
      await this.highlighter.clear("select");this.appearances.highlight(globalId);this.onSelect(globalId);
    }else{
      this.appearances?.highlight(null);await this.highlighter.highlightByID("select", map, true, false);
    }
    if (zoom) await this.world.camera.fitToItems(map);
  }

  /** Show or hide native BIM elements by their stable IFC GlobalIds. */
  async setBimVisible(globalIds:string[],visible:boolean){
    const model=this.modelId?this.fragments.list.get(this.modelId):undefined;if(!model||!globalIds.length)return;
    const localIds=(await model.getLocalIdsByGuids(globalIds)).filter((id):id is number=>id!==null&&id!==undefined);
    if(localIds.length){await model.setVisible(localIds,visible);await this.fragments.core.update(true);}
  }

  /** Keep only the requested native BIM elements visible; infrastructure remains independently controlled. */
  async isolateBim(allGlobalIds:string[],keepGlobalIds:string[]){
    const model=this.modelId?this.fragments.list.get(this.modelId):undefined;if(!model)return;
    const keep=new Set(keepGlobalIds),hideGuids=allGlobalIds.filter(id=>!keep.has(id));
    const [hide,show]=await Promise.all([model.getLocalIdsByGuids(hideGuids),model.getLocalIdsByGuids(keepGlobalIds)]);
    const hidden=hide.filter((id):id is number=>id!==null&&id!==undefined),visible=show.filter((id):id is number=>id!==null&&id!==undefined);
    if(hidden.length)await model.setVisible(hidden,false);if(visible.length)await model.setVisible(visible,true);await this.fragments.core.update(true);
  }

  async clearSelection() { this.appearances?.highlight(null);await this.highlighter.clear("select");this.onSelect(null); }
  async setMeasurementMode(enabled:boolean,snapping=true){await this.ready;this.measurementMode=enabled;this.measurementSnapping=snapping;if(this.measurementStart&&this.pendingMeasurementMarker){this.measurementGroup.remove(this.pendingMeasurementMarker);this.pendingMeasurementMarker.geometry.dispose();(this.pendingMeasurementMarker.material as THREE.Material).dispose();this.pendingMeasurementMarker=null;}if(enabled)this.measurementStart=null;}
  async setMeasurementSnapping(enabled:boolean){this.measurementSnapping=enabled;}
  clearMeasurements(){this.measurementStart=null;this.pendingMeasurementMarker=null;for(const child of [...this.measurementGroup.children]){this.measurementGroup.remove(child);const mesh=child as THREE.Mesh;mesh.geometry?.dispose();const material=mesh.material;if(Array.isArray(material))material.forEach(m=>m.dispose());else material?.dispose();}this.onMeasurement(null);}
  private addMeasurementPoint(point:THREE.Vector3){
    if(!this.measurementStart){this.measurementStart=point.clone();const marker=new THREE.Mesh(new THREE.SphereGeometry(.045,12,8),new THREE.MeshBasicMaterial({color:0x16a085,depthTest:false}));marker.position.copy(point);marker.renderOrder=1000;this.measurementGroup.add(marker);this.pendingMeasurementMarker=marker;this.onMeasurement(null,true);return;}
    const a=this.measurementStart.clone(),b=point.clone(),line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color:0xf08b25,depthTest:false}));line.renderOrder=999;this.measurementGroup.add(line);
    const marker=new THREE.Mesh(new THREE.SphereGeometry(.045,12,8),new THREE.MeshBasicMaterial({color:0xf08b25,depthTest:false}));marker.position.copy(b);marker.renderOrder=1000;this.measurementGroup.add(marker);
    this.measurementStart=null;this.pendingMeasurementMarker=null;this.onMeasurement(a.distanceTo(b),false);
  }
  async applyAppearances(project:string,data:any){
    const model=this.modelId?this.fragments.list.get(this.modelId):undefined;if(!model)return;
    const pending=this.appearanceQueue.then(async()=>{
      if(this.disposed||model.modelId!==this.modelId)return;
      if(!this.appearances){this.appearances=new MaterialAppearanceView(model,project);this.world.scene.three.add(this.appearances.group);}
      await this.appearances.update(data);if(this.disposed)return;await this.fragments.core.update(true);
      this.onAppearanceWarnings([...new Set(this.appearances.warnings)]);
      const info=this.world.renderer?.three?.info;
      (window as any).__insaAppearanceStats={...this.appearances.stats,modelId:this.modelId,geometryLoads:this.loadVersion,gpuTextures:info?.memory.textures,gpuGeometries:info?.memory.geometries,drawCalls:info?.render.calls};
    });this.appearanceQueue=pending.catch(()=>{});return pending;
  }
  async clearBimModel(){await this.ready;await this.loadQueue;await this.appearanceQueue;if(this.modelId){const model=this.fragments.list.get(this.modelId);if(model)this.world.scene.three.remove(model.object);await this.fragments.core.disposeModel(this.modelId);this.modelId=null;}if(this.appearances){this.world.scene.three.remove(this.appearances.group);this.appearances.dispose();this.appearances=null;}}
  async startGoogleMap(key:string,g:MapReference,geoid:number,opacity:number,status:(s:string)=>void,provider:'google'|'cesium'|'terrain'='google',assetId?:number){await this.ready;if(!this.disposed)this.googleMap?.start(key,g,geoid,opacity,status,provider,assetId);}
  stopGoogleMap(){this.googleMap?.stop();}
  setGoogleMapOpacity(value:number){this.googleMap?.setOpacity(value);}
  sampleMapSurface(point:[number,number,number]){return this.googleMap?.sampleSurface(point)??null;}
  setMapGeoid(value:number){this.googleMap?.setGeoid(value);}
  async fit() {
    await this.ready;
    const model=this.modelId?this.fragments.list.get(this.modelId):undefined;
    if((!model||!model.object.visible)&&!this.infrastructure.bounds().isEmpty())return this.fitInfrastructure();
    return this.world.camera.fitToItems();
  }
  async updateInfrastructure(data:InfraScene){const version=++this.infrastructureVersion;await this.ready;if(this.disposed)return;
    const model=this.modelId?this.fragments.list.get(this.modelId):undefined;
    const first=data.objects[0]?.positions;
    const coordination=model?await model.getCoordinationMatrix():first?.length?new THREE.Matrix4().makeTranslation(-first[0],-first[1],-first[2]):new THREE.Matrix4();
    if(this.disposed||version!==this.infrastructureVersion||model?.modelId!==(this.modelId??undefined))return;
    // Fragments coordination is project -> rebased model (verified against native boxes).
    this.infrastructure.update(data,coordination);
    await this.infrastructure.applyMaterials(data);
    if(this.disposed||version!==this.infrastructureVersion)return;
    this.onAppearanceWarnings([...new Set([...(this.appearances?.warnings??[]),...this.infrastructure.warnings])]);
    model?.object.updateWorldMatrix(true,false);
    this.infrastructure.group.matrixAutoUpdate=false;
    this.infrastructure.group.matrix.copy(model?.object.matrixWorld??new THREE.Matrix4());
    this.infrastructure.group.updateWorldMatrix(true,true);
    if(!this.disposed&&version===this.infrastructureVersion){const transform=this.infrastructure.group.matrixWorld.clone().multiply(coordination);this.googleMap?.setModelTransform(transform);await this.train?.update(data.project,data.civilNavigation,transform);if(!this.disposed&&version===this.infrastructureVersion)await this.civilNavigation?.update(data.project,data.civilNavigation,transform);}
    const columnIds=model?Object.values(await model.getItemsOfCategories([/^IFCCOLUMN$/])).flat().slice(0,4):[];
    const nativeBox=model&&columnIds.length?await model.getMergedBox(columnIds):null,box=this.infrastructure.bounds();
    const projectBox=nativeBox?.clone().applyMatrix4(coordination.clone().invert());
    (window as any).__insaInfrastructureStats={key:data.key,objects:this.infrastructure.group.children.length,bounds:{min:box.min.toArray(),max:box.max.toArray()},nativeBounds:nativeBox?{min:nativeBox.min.toArray(),max:nativeBox.max.toArray()}:null,bimProjectBounds:projectBox?{min:projectBox.min.toArray(),max:projectBox.max.toArray()}:null,coordination:coordination.elements};
    Object.defineProperty((window as any).__insaInfrastructureStats,'gpu',{enumerable:true,get:()=>({sourcePositionBytes:this.infrastructure.group.children.reduce((n,o)=>n+((o as THREE.Mesh).geometry?.getAttribute('position')?.array.byteLength??0),0),gpuGeometries:this.world.renderer?.three.info.memory.geometries,gpuTextures:this.world.renderer?.three.info.memory.textures,drawCalls:this.world.renderer?.three.info.render.calls,appearanceMaterials:this.infrastructure.stats.materials,cachedTextures:this.infrastructure.stats.textures,warnings:this.infrastructure.warnings})});
    (window as any).__insaInfrastructureStats.geometryKeys=this.infrastructure.group.children.map(o=>({id:o.userData.infraId,key:o.userData.geometryKey}));
  }
  setCadSourceMode(enabled:boolean){const model=this.modelId?this.fragments.list.get(this.modelId):undefined;if(model)model.object.visible=!enabled;if(this.appearances)this.appearances.group.visible=!enabled;}
  async selectInfrastructure(id:string){await this.ready;await this.highlighter.clear('select');this.appearances?.highlight(null);this.infrastructure.select(id);this.onInfraSelect(id);await this.fitInfrastructure(id);}
  setInfrastructureWireframe(id:string,enabled:boolean){this.infrastructure.setWireframe(id,enabled);}
    setInfrastructureVisible(id:string,visible:boolean){this.infrastructure.setVisible(id,visible);}
  async fitInfrastructure(id?:string){await this.ready;const box=this.infrastructure.bounds(id);if(!box.isEmpty()){const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()).length();const camera=this.world.camera.three;camera.far=Math.max(camera.far,size*10);camera.updateProjectionMatrix();this.world.camera.controls.maxDistance=Math.max(this.world.camera.controls.maxDistance,size*10);await this.world.camera.controls.setLookAt(center.x+size*.6,center.y+size*.45,center.z+size*.7,center.x,center.y,center.z,false);await this.world.camera.controls.fitToSphere(box.getBoundingSphere(new THREE.Sphere()),true);}}
  dispose() { this.disposed = true; ++this.loadVersion; this.resolveReady(); this.removeAppearanceClick();this.clearMeasurements();this.googleMap?.dispose();this.train?.dispose();this.civilNavigation?.dispose();this.infrastructure.dispose();this.appearances?.dispose();this.components.dispose(); }
}

function snapMeshIntersection(hit:THREE.Intersection<THREE.Object3D>,clientX:number,clientY:number,rect:DOMRect,camera:THREE.Camera):THREE.Vector3|null{
  const mesh=hit.object as THREE.Mesh,geometry=mesh.geometry,face=hit.face,positions=geometry?.getAttribute('position');if(!geometry||!face||!positions)return null;
  mesh.updateWorldMatrix(true,false);
  const verts=[face.a,face.b,face.c].map(index=>new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(mesh.matrixWorld));
  const candidates=[...verts,verts[0].clone().add(verts[1]).multiplyScalar(.5),verts[1].clone().add(verts[2]).multiplyScalar(.5),verts[2].clone().add(verts[0]).multiplyScalar(.5)];
  let best:THREE.Vector3|null=null,bestPixels=12;
  for(const p of candidates){const ndc=p.clone().project(camera),x=rect.left+(ndc.x+1)*rect.width/2,y=rect.top+(1-ndc.y)*rect.height/2,d=Math.hypot(x-clientX,y-clientY);if(d<bestPixels){bestPixels=d;best=p;}}
  return best;
}



