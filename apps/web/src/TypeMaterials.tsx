import {useEffect,useState} from "react";
import {api} from "./api";
import {SharedComponentTypes} from './SharedComponentTypes';
const layeredKinds=["wall","slab","roof","ceiling","foundation_slab"];
const labels:Record<string,string>={wall:"Duvar",slab:"Döşeme",roof:"Çatı",ceiling:"Tavan",foundation_slab:"Radye temel",column:"Kolon",beam:"Kiriş"};
export function TypeMaterials({project,onDone}:{project:string;onDone:()=>void}){
 const [sharedOpen,setSharedOpen]=useState(false);
 const [materials,setMaterials]=useState<any[]>([]),[kind,setKind]=useState("wall"),[name,setName]=useState("");
 const [layers,setLayers]=useState([{material:"",thickness:.2,function:"structure"}]);
 const [width,setWidth]=useState(.3),[height,setHeight]=useState(.6),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [materialName,setMaterialName]=useState(""),[color,setColor]=useState("#bbbbbb"),[roughness,setRoughness]=useState(.8),[metallic,setMetallic]=useState(0),[opacity,setOpacity]=useState(1);
 const load=async()=>{const r=await api.run(project,"bim_query_materials",{});setMaterials(r.result??[]);};
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[project]);
 const describe=(r:any)=>r.status==="proposed"?`Öneri ${r.proposalId} onay bekliyor.`:"Kaydedildi.";
 const createMaterial=async()=>{setBusy(true);try{
  const r=await api.run(project,"bim_create_materials",{materials:[{name:materialName,color,appearance:{baseColor:color,roughness,metallic,opacity,textureSize:[2,2],normalConvention:"OpenGL"}}]});
  setMessage(describe(r));await load();onDone();
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const createType=async()=>{setBusy(true);try{
  const type=layeredKinds.includes(kind)?{kind,name,layers:layers.map(l=>({...l,thickness:Number(l.thickness)}))}:{kind,name,material:layers[0].material,profile:{shape:"rect",b:width,h:height}};
  const r=await api.run(project,"bim_create_types",{types:[type]});setMessage(describe(r));onDone();
 }catch(e){setMessage((e as Error).message);}finally{setBusy(false);}};
 const choose=(index:number,value:string)=>setLayers(layers.map((l,i)=>i===index?{...l,material:value}:l));
 return <div className="type-materials">
  <h3>Tip ve malzemeler</h3>
  <details onToggle={e=>setSharedOpen(e.currentTarget.open)}><summary>Ortak altyapı bileşen tipleri</summary>{sharedOpen&&<SharedComponentTypes project={project} materials={materials} onDone={onDone}/>}</details>
  <label>Tip türü<select value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
  <label>Tip adı<input value={name} onChange={e=>setName(e.target.value)}/></label>
  <h4>{layeredKinds.includes(kind)?"Katmanlar (dış → iç / üst → alt)":"Malzeme"}</h4>
  {(layeredKinds.includes(kind)?layers:layers.slice(0,1)).map((layer,index)=><div className="card" key={index}>
   <label>{index+1}. Malzeme<select aria-label={`Katman ${index+1} malzemesi`} value={layer.material} onChange={e=>choose(index,e.target.value)}><option value="">Malzeme seç</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label>
   {layeredKinds.includes(kind)&&<><label>Kalınlık (m)<input aria-label={`Katman ${index+1} kalınlığı`} type="number" min="0.001" step="0.005" value={layer.thickness} onChange={e=>setLayers(layers.map((l,i)=>i===index?{...l,thickness:Number(e.target.value)}:l))}/></label>
   <label>İşlev<select value={layer.function} onChange={e=>setLayers(layers.map((l,i)=>i===index?{...l,function:e.target.value}:l))}>{["finish","substrate","insulation","structure","membrane"].map(f=><option key={f}>{f}</option>)}</select></label>
   <button className="ghost" disabled={layers.length===1} onClick={()=>setLayers(layers.filter((_,i)=>i!==index))}>Katmanı kaldır</button></>}
  </div>)}
  {layeredKinds.includes(kind)?<button className="ghost" onClick={()=>setLayers([...layers,{material:"",thickness:.02,function:"finish"}])}>Katman ekle</button>:<><label>Kesit genişliği (m)<input type="number" min=".01" step=".01" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><label>Kesit yüksekliği (m)<input type="number" min=".01" step=".01" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label></>}
  <p className="muted">Katmanlar tek BIM elemanı içinde saklanır. Ayrı kaplama elemanları oluşturulmaz.</p>
  <button disabled={busy||!name.trim()||(layeredKinds.includes(kind)?layers:layers.slice(0,1)).some(l=>!l.material)} onClick={()=>void createType()}>Tip oluştur</button>
  <details><summary>Yeni malzeme tanımla</summary>
   <label>Malzeme adı<input value={materialName} onChange={e=>setMaterialName(e.target.value)}/></label>
   <label>Temel renk<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
   <label>Pürüzlülük<input type="number" min="0" max="1" step=".05" value={roughness} onChange={e=>setRoughness(Number(e.target.value))}/></label>
   <label>Metalik<input type="number" min="0" max="1" step=".05" value={metallic} onChange={e=>setMetallic(Number(e.target.value))}/></label>
   <label>Opaklık<input type="number" min="0" max="1" step=".05" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/></label>
   <button disabled={busy||!materialName.trim()} onClick={()=>void createMaterial()}>Malzemeyi kaydet</button>
  </details>
  <button className="ghost" onClick={()=>void load()}>Malzeme listesini yenile</button>
  {message&&<p role="status">{message}</p>}
 </div>;
}
