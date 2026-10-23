import {cadDisplayBudget} from './cad-display-budget';
/** Render-only line batching. Every primitive range retains its source entity/segment identity. */
export function batchedCadOverlay(data:any){
 const doc=data.document,budget=cadDisplayBudget(doc);if(!budget.allowed)return {key:`cad:blocked:${data.sourceAsset}`,status:'source-display-budget',resources:[],objects:[],diagnostic:budget.diagnostic};
 const cx=(doc.bounds[0]+doc.bounds[2])/2,cy=(doc.bounds[1]+doc.bounds[3])/2,resources:any[]=[],batches=new Map<string,any>();
 for(const e of doc.entities){const parent=`cad:${e.id}`,color=data.highlightSource?'#a9e000':e.layer.toLowerCase().includes('design')?'#d74141':'#315879';resources.push({id:parent,label:`${e.layer} · ${e.text??e.type}`,kind:'cad_source_entity',properties:e});
  for(const [index,s]of e.segments.entries()){const key=`${e.layer}:${color}`;let batch=batches.get(key);if(!batch){batch={id:`cad-batch:${key}`,kind:'line-batch',positions:[],parts:[],color,geometryKey:`${data.sourceAsset}:${key}:${doc.entities.map((q:any)=>q.id).join(',')}`};batches.set(key,batch);}const points:number[][]=[];
   if(s.kind==='line')points.push(s.start,s.end);else{const a=Math.atan2(s.start[1]-s.center[1],s.start[0]-s.center[0]),n=Math.min(512,Math.max(8,Math.ceil(Math.abs(s.sweep)*32)));for(let j=0;j<=n;j++){const t=a+s.sweep*j/n;points.push([s.center[0]+s.radius*Math.cos(t),s.center[1]+s.radius*Math.sin(t)]);}}
   const start=batch.positions.length/3;for(let j=1;j<points.length;j++)for(const p of [points[j-1],points[j]])batch.positions.push(p[0]-cx,0,-(p[1]-cy));batch.parts.push({id:`${parent}:${index}`,parent,sourceSegment:s.sourceSegment??index,start,count:batch.positions.length/3-start});
  }
 }
 return {key:`cad-batched:${data.sourceAsset}:${doc.entities.map((e:any)=>e.id).join(',')}:${Boolean(data.highlightSource)}`,status:'source-drawing-context',resources,objects:[...batches.values()],diagnostic:'Kaynak çizim koordinatları; katman bazında batch, entity/segment kimliği korunur. Mühendislik modeli değildir.'};
}
