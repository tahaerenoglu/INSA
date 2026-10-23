import {FamilyLibrary} from './FamilyLibrary';
import {StructureProperties,SectionDetail} from './StructureProperties';
import {ProjectsPage} from './ProjectsPage';
import {Box,Boxes,Plus,Search,PanelLeftClose,PanelLeftOpen,PanelRightOpen,Maximize,LogOut,Download,Files,Layers3,Compass,Ruler,Magnet,Trash2} from 'lucide-react';
import {ProjectExplorer} from './ui/ProjectExplorer';
import {WorkspaceRail,InspectorNavigation,ModelingTools,type InspectorTab} from './ui/WorkspaceChrome';
import {TrainSimulationPanel} from './TrainSimulationPanel';
import {GoogleMapPanel} from './GoogleMapPanel';
import {CivilNavigationPanel} from './CivilNavigationPanel';
import {AlignmentInspector} from './CadConversion';
import {CadInterpretation} from './CadInterpretation';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, HistoryRow, Proposal, ToolInfo, TreeNode, User } from "./api";

import { Viewer } from "./viewer";

import { Assistant } from "./Assistant";

import {TypeMaterials} from "./TypeMaterials";

import {ProjectFiles} from './ProjectFiles';
import {MeshSectionPanel} from './MeshSectionPanel';
import {RoadEditor} from './RoadEditor';
import {EarthworksInspection} from './EarthworksInspection';
import {RoadInspection} from './RoadInspection';
import {TerrainImport,TerrainPanel} from './TerrainPanel';



const KIND_TR: Record<string, string> = { wall: "Duvarlar", slab: "Döşemeler", column: "Kolonlar", beam: "Kirişler", door: "Kapılar", window: "Pencereler", component: "Bileşenler", spatial: "Mahaller",

  ceiling: "Tavanlar", roof: "Çatılar", stair: "Merdivenler", railing: "Korkuluklar", room: "Odalar", space: "Mahaller",

  "structure.brace": "Çaprazlar", "structure.pile": "Kazıklar", "structure.shear_wall": "Perde duvarlar", "structure.slab": "Yapısal döşemeler",

  "generic.element_assembly": "Düzenekler", "architecture.curtain_wall": "Perde cepheler", "architecture.pitched_roof": "Eğimli çatılar", "architecture.ramp_flight": "Rampa kolları", "architecture.stair_flight": "Merdiven kolları", "architecture.landing": "Sahanlıklar", "architecture.stair_assembly": "Merdivenler (düzenek)", "architecture.ramp_assembly": "Rampalar (düzenek)", "structure.deep_foundation": "Derin temeller", "structure.rebar_set": "Donatı çubukları", "structure.rebar_mesh": "Donatı hasırları", "structure.tendon": "Öngerme tendonları", "structure.tendon_conduit": "Tendon kanalları",

  "plumbing.pipe_fitting": "Boru bağlantı parçaları", "mechanical.duct_fitting": "Kanal bağlantı parçaları", "electrical.cable_carrier_fitting": "Kablo taşıyıcı bağlantı parçaları", "electrical.cable_fitting": "Kablo bağlantı parçaları",

  "electrical.cable_segment": "Kablolar", "mechanical.flexible_duct": "Esnek kanallar", "plumbing.flexible_pipe": "Esnek borular", "plumbing.pipe": "Borular", "mechanical.duct": "Kanallar", "electrical.cable_tray": "Kablo tavaları", "electrical.conduit": "Konduitler", "structure.footing": "Temel ayakları", "structure.foundation_slab": "Radye temeller" };

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3));

const when = (iso: string) => new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });



/** Builds an input skeleton from a JSON schema (required fields, sensible empties). */

function skeleton(s: any): unknown {

  if (!s) return {};

  if (s.default !== undefined) return s.default;

  if (s.type === "object") {

    const out: Record<string, unknown> = {};

    for (const k of s.required ?? []) out[k] = skeleton(s.properties?.[k]);

    return out;

  }

  if (s.type === "array") return s.items ? [skeleton(s.items)] : [];

  if (s.anyOf || s.oneOf) return skeleton((s.anyOf ?? s.oneOf)[0]);

  if (s.enum) return s.enum[0];

  if (s.type === "number" || s.type === "integer") return 0;

  if (s.type === "boolean") return false;

  return "";

}



function Login({ onLogin }: { onLogin: (u: User) => void }) {

  const [users, setUsers] = useState<User[]>([]);

  const [err, setErr] = useState("");

  useEffect(() => { api.users().then(setUsers).catch((e) => setErr(String(e.message))); }, []);

  return (

    <div className="login">

      <h1>INSA · BIM</h1>

      <p className="muted">Geliştirme girişi: bir kullanıcı seç. (Gerçek kullanımda şirket kimlik sistemiyle değiştirilecek.)</p>

      {users.map((u) => (

        <button key={u.id} onClick={() => api.login(u.id).then(onLogin).catch((e) => setErr(e.message))}>

          {u.name} <span className="muted">· {u.roles.join(", ")}</span>

        </button>

      ))}

      {err && <p className="error">{err}</p>}

    </div>

  );

}



export function App() {

  const [user, setUser] = useState<User | null>(null);

  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);

  const [projects, setProjects] = useState<string[]>([]);

  const [project, setProject] = useState(new URLSearchParams(window.location.search).get("project") ?? "");

  const [tree, setTree] = useState<TreeNode[]>([]);

  const [summary, setSummary] = useState<any>(null);

  const [meshSectionOpen,setMeshSectionOpen]=useState(false);
  const [isolatedInfraIds,setIsolatedInfraIds]=useState<string[]>(()=>new URLSearchParams(window.location.search).get("infraOnly")?.split(",").filter(Boolean)??[]);
  const [infra,setInfra]=useState<import('./infrastructure-view').InfraScene|null>(null);

  const applyInfraIsolation=(scene:import('./infrastructure-view').InfraScene,viewer:Viewer)=>{if(!isolatedInfraIds.length)return;const known=new Map(scene.resources.map(r=>[r.id,r])),kept=new Set<string>();for(const id of isolatedInfraIds){let r=known.get(id);while(r&&!kept.has(r.id)){kept.add(r.id);r=r.parent?known.get(r.parent):undefined;}}if(!kept.size)return;for(const r of scene.resources)viewer.setInfrastructureVisible(r.id,kept.has(r.id));};
  const clearInfraIsolation=()=>{const url=new URL(window.location.href);url.searchParams.delete('infraOnly');window.history.replaceState(null,'',url);setIsolatedInfraIds([]);for(const r of infraRef.current?.resources??[])viewerRef.current?.setInfrastructureVisible(r.id,true);};
  const infraRef=useRef<import('./infrastructure-view').InfraScene|null>(null);infraRef.current=infra;
  useEffect(()=>{const handle=(event:Event)=>{const d=(event as CustomEvent).detail;if(d.ids)for(const id of d.ids)viewerRef.current?.setInfrastructureVisible(id,d.visible);if(d.focus){setCenter('3d');void viewerRef.current?.fitInfrastructure(d.focus);}if(d.select){setCenter('3d');void viewerRef.current?.selectInfrastructure(d.select);}};window.addEventListener('insa-earthwork-view',handle);return()=>window.removeEventListener('insa-earthwork-view',handle);},[]);


  const [proposals, setProposals] = useState<Proposal[]>([]);

  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [measurementOn,setMeasurementOn]=useState(false),[snapOn,setSnapOn]=useState(true),[measurementText,setMeasurementText]=useState('');

  const [selected, setSelected] = useState<string | null>(null);

  const [element, setElement] = useState<any>(null);

  const [tab, setTab] = useState<InspectorTab>("props");
  const [consoleTool,setConsoleTool]=useState('bim_model_summary');
  const cadModeRef=useRef(false);cadModeRef.current=tab==='cad';

  useEffect(()=>{if(tab!=='cad'){viewerRef.current?.setCadSourceMode(false);if(infraRef.current)void viewerRef.current?.updateInfrastructure(infraRef.current);}},[tab,project]);


  const [center, setCenter] = useState<"3d" | "plan" | "files">(new URLSearchParams(window.location.search).get("view")==="files"?"files":"3d");

  const [planStorey, setPlanStorey] = useState("");
  const [sidebarOpen,setSidebarOpen]=useState(()=>window.innerWidth>950),[inspectorOpen,setInspectorOpen]=useState(()=>window.innerWidth>650),[modelQuery,setModelQuery]=useState('');
  useEffect(()=>{if(selected)setInspectorOpen(true);},[selected]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));return()=>cancelAnimationFrame(frame);},[sidebarOpen,inspectorOpen,center]);
  useEffect(()=>{const narrow=window.matchMedia('(max-width:950px)'),mobile=window.matchMedia('(max-width:650px)');const collapse=()=>{if(narrow.matches)setSidebarOpen(false);if(mobile.matches)setInspectorOpen(false);};narrow.addEventListener('change',collapse);mobile.addEventListener('change',collapse);return()=>{narrow.removeEventListener('change',collapse);mobile.removeEventListener('change',collapse);};},[]);
  useEffect(()=>{const url=new URL(window.location.href);if(center==='files')url.searchParams.set('view','files');else url.searchParams.delete('view');window.history.replaceState(null,'',url);},[center]);
  const openPanel=(next:InspectorTab)=>{setTab(next);setInspectorOpen(true);if(next==='map'||next==='navigate')setCenter('3d');};


  const [error, setError] = useState("");

  const [appearanceWarnings,setAppearanceWarnings]=useState<string[]>([]);

  const [live, setLive] = useState(false);

  const viewerRef = useRef<Viewer | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const toggleMeasurement=()=>{const next=!measurementOn;setMeasurementOn(next);if(next)setMeasurementText('İlk noktayı seçin');else setMeasurementText(old=>old==='İlk noktayı seçin'||old==='İkinci noktayı seçin'?'Ölçüm duraklatıldı':old);void viewerRef.current?.setMeasurementMode(next,snapOn);};

  const treeRef = useRef<TreeNode[]>([]);

  const refreshVersion = useRef(0);

  const currentProject = useRef(project);

  const loadedModel = useRef("");

  currentProject.current = project;

  treeRef.current = tree;



  const fail = (e: unknown) => {

    if (e instanceof ApiError && e.status === 401) { api.logout(); setUser(null); return; }

    setError(String((e as Error).message ?? e));

  };



  // session

  useEffect(() => { if (api.token) api.me().then((m) => { setMe(m); setUser(m.actor); }).catch(() => api.logout()); }, []);

  useEffect(() => {

    if (!user) return;

    api.me().then(setMe).catch(fail);

    api.projects().then((p) => { setProjects(p); }).catch(fail);

  }, [user]);

  useEffect(()=>{if(!user)return;api.tools(project||undefined).then(setTools).catch(fail);},[user,project]);



  const openProject=(id:string,navigate=true)=>{
    setSelected(null);setElement(null);setSummary(null);setTree([]);setInfra(null);setProposals([]);setHistory([]);setPlanStorey('');setModelQuery('');setAppearanceWarnings([]);setError('');setLive(false);setIsolatedInfraIds([]);setMeshSectionOpen(false);setCenter('3d');setTab('props');setMeasurementOn(false);setSnapOn(true);setProject(id);
    if(navigate){const url=new URL(window.location.href);if(id)url.searchParams.set('project',id);else url.searchParams.delete('project');url.searchParams.delete('view');url.searchParams.delete('infraOnly');window.history.pushState(null,'',url);}
  };
  useEffect(()=>{const back=()=>openProject(new URLSearchParams(window.location.search).get('project')??'',false);window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
  // viewer lifecycle

  useEffect(() => {

    if (!user || !project || !canvasRef.current || viewerRef.current) return;

    const v = new Viewer();

    v.onAppearanceWarnings=setAppearanceWarnings;
    v.onMeasurement=(distance,awaiting)=>setMeasurementText(awaiting?'İkinci noktayı seçin':distance===null?'':`Mesafe: ${distance.toFixed(3)} m`);

    v.onInfraSelect=id=>{if(cadModeRef.current){window.dispatchEvent(new CustomEvent('insa-cad-selection',{detail:id}));if(!id?.startsWith('cad:'))return;}if(id?.startsWith('cad:')){window.dispatchEvent(new CustomEvent('insa-cad-pick',{detail:id.slice(4).replace(/:\d+$/,'')}));return;}setSelected(id);if(id)setTab('props');};

    loadedModel.current = "";

    viewerRef.current = v;

    v.init(canvasRef.current).catch(fail);

    v.onSelect = (gid) => {

      if (!gid) return setSelected(null);

      for (const st of treeRef.current) for (const items of Object.values(st.groups)) {

        const hit = items.find((i) => i.global_id === gid);

        if (hit) { setSelected(hit.id); setTab("props"); return; }

      }

    };

    return () => { ++refreshVersion.current; v.dispose(); viewerRef.current = null; loadedModel.current=""; };

  }, [user,project]);



  const refresh = useCallback(async (withModel = true) => {

    if (!project) return;

    const version = ++refreshVersion.current;

    const current = () => version === refreshVersion.current && project === currentProject.current;

    try {

      const [t, s, p, h] = await Promise.all([api.tree(project), api.summary(project), api.proposals(project), api.history(project)]);

      if (!current()) return;

      setTree(t); setSummary(s); setProposals(p); setHistory(h);

      if (!planStorey && t[0]) setPlanStorey(t[0].name);

      const modelKey = `${project}:${s.geometryKey ?? s.seq}`;

      if(withModel&&viewerRef.current&&s.elements===0&&loadedModel.current!==modelKey){await viewerRef.current.clearBimModel();if(current())loadedModel.current=modelKey;}

      if (withModel && viewerRef.current && s.elements > 0 && loadedModel.current !== modelKey) {

        const viewer = viewerRef.current;

        const f = await api.frag(project);

        if (!current() || viewer !== viewerRef.current) return;

        await viewer.load(f.bytes, project);

        if (current() && viewer === viewerRef.current) loadedModel.current = modelKey;

      }

      if(withModel && current() && viewerRef.current) {

        const appearances=await api.appearances(project);

        if(current())await viewerRef.current?.applyAppearances(project,appearances);

        const infrastructure=await api.infrastructure(project);

        if(current()){setInfra(infrastructure);viewerRef.current?.setCadSourceMode(cadModeRef.current);if(!cadModeRef.current){await viewerRef.current?.updateInfrastructure(infrastructure);if(viewerRef.current){applyInfraIsolation(infrastructure,viewerRef.current);if(isolatedInfraIds.length)await viewerRef.current.fitInfrastructure();}}}

      }

    } catch (e) { if (current()) fail(e); }

  }, [project, planStorey, isolatedInfraIds]);



  // project switch + live stream

  useEffect(() => {

    if (!user || !project) return;

    localStorage.setItem("insa_project", project);

    setSelected(null);

    void refresh();

    const es = api.stream(project);

    let timer: number | undefined;

    let first = true;

    es.addEventListener("change", () => {

      if (first) { first = false; return; }

      window.clearTimeout(timer);

      timer = window.setTimeout(() => void refresh(), 350);

    });

    es.onopen = () => setLive(true);

    es.onerror = () => setLive(false);

    return () => { es.close(); window.clearTimeout(timer); };

  }, [user, project]);



  // selected element details

  useEffect(() => {

    if (!selected || !project) { setElement(null); return; }

    if(selected.startsWith('infra:')){setElement(infraRef.current?.resources.find(r=>r.id===selected)??null);return;}

    api.element(project, selected).then(setElement).catch(fail);

  }, [selected, project, summary?.seq,infra?.key,infra?.appearanceKey]);



  const pickFromTree = (id: string, gid: string) => {

    setSelected(id); setTab("props"); setCenter("3d");

    void viewerRef.current?.select(gid);

  };



  if (!user) return <Login onLogin={(u) => setUser(u)} />;

  if(!project)return <ProjectsPage user={user} projects={projects} canCreate={Boolean(me?.permissions.some(p=>p==='*'||p==='bim.write'||p==='bim.*'))} onOpen={openProject} onChanged={()=>void api.projects().then(setProjects).catch(fail)} onLogout={()=>{api.logout();setUser(null);}}/>;

  const pending = proposals.filter((p) => p.status === "pending");

  const canApprove = me?.permissions.some((p) => p === "*" || p === "platform.approve");



  return (

    <div className={`app workspace ${sidebarOpen?'':'sidebar-collapsed'} ${inspectorOpen?'':'inspector-collapsed'}`}>
      <header className="app-header">
        <div className="brand"><span className="brand-symbol"><Boxes size={23}/></span><strong>INSA<span>ENGINEERING WORKSPACE</span></strong></div>
        <span className="header-divider"/>
        <button className="ghost" onClick={()=>openProject("")}>← Projeler</button><div className="active-project-name"><small>ÇALIŞMA ALANI</small><strong>{summary?.project?.name??project}</strong></div>
        <span className="grow"/>
        <span className="connection-state"><span className={`dot ${live?'on':''}`}/>{live?'Canlı bağlantı':'Bağlanıyor'}</span>
        {project&&summary?.elements>0&&<a className="header-download" href={api.ifcUrl(project)}><Download size={15}/>IFC</a>}
        <button className="create-button" onClick={()=>openPanel('workspace-tools')}><Plus size={16}/>Oluştur</button>
        <div className="user-avatar" title={`${user.name} · ${user.roles.join(', ')}`}>{user.name.slice(0,2).toLocaleUpperCase('tr-TR')}</div>
        <button className="icon-button logout" title="Oturumu kapat" aria-label="Oturumu kapat" onClick={()=>{api.logout();setUser(null);}}><LogOut size={17}/></button>
      </header>
      <WorkspaceRail center={center} panel={inspectorOpen?tab:'props'} pending={pending.length} onCenter={v=>{setCenter(v);if(v==='3d'){if(window.innerWidth>950)setSidebarOpen(true);setTab('props');}}} onPanel={openPanel} onLogout={()=>{api.logout();setUser(null);}}/>
      <aside className="left" aria-label="Proje gezgini">
        <div className="explorer-heading"><div><span className="eyebrow">PROJE GEZGİNİ</span><h2>Model ağacı</h2></div><button className="icon-button" aria-label="Proje gezginini kapat" onClick={()=>setSidebarOpen(false)}><PanelLeftClose size={17}/></button></div>
        {isolatedInfraIds.length>0&&<div className="isolation-notice">Filtreli görünüm<button className="text-button" onClick={clearInfraIsolation}>Tümünü göster</button></div>}
        <ProjectExplorer key={project} project={project} resources={infra?.resources??[]} tree={tree} selected={selected} query={modelQuery} onQuery={setModelQuery} kindLabels={KIND_TR} onSelect={id=>{setSelected(id);openPanel('props');setCenter('3d');void viewerRef.current?.selectInfrastructure(id);}} onBimSelect={pickFromTree} onVisibility={(id,v)=>viewerRef.current?.setInfrastructureVisible(id,v)} onBimVisibility={(items,v)=>void viewerRef.current?.setBimVisible(items.map(i=>i.global_id),v)} onBimIsolate={keep=>void viewerRef.current?.isolateBim(tree.flatMap(st=>Object.values(st.groups).flat().map(i=>i.global_id)),keep.map(i=>i.global_id))} onBimShowAll={()=>void viewerRef.current?.setBimVisible(tree.flatMap(st=>Object.values(st.groups).flat().map(i=>i.global_id)),true)}/>
        {infra?.diagnostic&&<p role="status" className="muted">{infra.diagnostic}</p>}
      </aside>

      <main>

        <div className="workspace-toolbar">
          {!sidebarOpen&&<button className="icon-button" aria-label="Proje gezginini aç" onClick={()=>setSidebarOpen(true)}><PanelLeftOpen size={18}/></button>}
          <div className="view-tabs" aria-label="Görünüm">{([{id:'3d',label:'3B Model',icon:Box},{id:'plan',label:'Plan',icon:Layers3},{id:'files',label:'Dosyalar',icon:Files}] as const).map(({id,label,icon:Icon})=><button key={id} aria-pressed={center===id} className={center===id?'on':''} onClick={()=>setCenter(id)}><Icon size={15}/>{label}</button>)}</div>
          {center==='plan'&&<select aria-label="Plan katı" value={planStorey} onChange={e=>setPlanStorey(e.target.value)}>{tree.map(s=><option key={s.id}>{s.name}</option>)}</select>}
          <span className="grow"/>
          {center==='3d'&&<><button className={`toolbar-button ${measurementOn?'on':''}`} aria-pressed={measurementOn} onClick={()=>toggleMeasurement()} title="İki nokta seçerek 3B mesafe ölç"><Ruler size={15}/>Ölç</button><button className={`toolbar-button ${snapOn?'on':''}`} aria-pressed={snapOn} disabled={!measurementOn} onClick={()=>{const next=!snapOn;setSnapOn(next);void viewerRef.current?.setMeasurementSnapping(next);}} title="Ölçümde köşe ve kenarlara yakala"><Magnet size={15}/>Snap</button>{measurementText&&<span className="measurement-readout" role="status">{measurementText}</span>}{measurementText&&<button className="toolbar-button" onClick={()=>{viewerRef.current?.clearMeasurements();setMeasurementText(measurementOn?'İlk noktayı seçin':'');}} title="Ölçü çizgilerini temizle"><Trash2 size={14}/>Temizle</button>}<button className="toolbar-button" onClick={()=>void viewerRef.current?.fit()}><Maximize size={15}/>Sığdır</button><button className="toolbar-button" onClick={()=>openPanel('navigate')}><Compass size={15}/>Gezin</button></>}
          {!inspectorOpen&&<button className="icon-button" aria-label="Çalışma panelini aç" onClick={()=>setInspectorOpen(true)}><PanelRightOpen size={18}/></button>}
        </div>
        {appearanceWarnings.length>0&&<div role="status" style={{padding:8,color:"#835000",background:"#fff3d0"}}>Bazı dokular yüklenemedi; temel malzeme rengi gösteriliyor. ({appearanceWarnings.length})</div>}

        {center==='files'&&<ProjectFiles key={project} project={project} seq={summary?.seq??0} canWrite={Boolean(me?.permissions?.some((p:string)=>p==='*'||p==='files.*'||p==='files.write'))} onProposal={()=>{setTab('proposals');void refresh(false);}}/>}

        <div ref={canvasRef} className="canvas" style={{ display: center === "3d" ? "block" : "none" }} />

        {center === "plan" && planStorey && (

          <div className="plan"><img src={api.planUrl(project, planStorey, summary?.seq ?? 0)} alt="plan" /></div>

        )}

      </main>



      <aside className="right">

        <InspectorNavigation tab={tab} onChange={openPanel} onClose={()=>setInspectorOpen(false)} pending={pending.length}/>
        <div className="panel">
          <section className="map-workspace" style={{display:tab==='map'?'block':'none'}}><GoogleMapPanel key={`map:${project}`} project={project} active={tab==='map'} canWrite={Boolean(me?.permissions?.some((p:string)=>p==='*'||p==='bim.*'||p==='bim.write'))} onProposal={()=>{setTab('proposals');void refresh(false);}} onStart={async(key,g,n,opacity,status,provider,assetId)=>{setCenter('3d');await viewerRef.current?.startGoogleMap(key,g,n,opacity,status,provider,assetId);}} onStop={()=>viewerRef.current?.stopGoogleMap()} onOpacity={v=>viewerRef.current?.setGoogleMapOpacity(v)} onGeoid={v=>viewerRef.current?.setMapGeoid(v)} onSample={p=>viewerRef.current?.sampleMapSurface(p)??null}/></section>
          <section className="navigation-workspace" style={{display:tab==='navigate'?'block':'none'}}>{infra?.resources.some(r=>r.kind==='alignment')&&<CivilNavigationPanel key={project} project={project} scene={infra} onDone={()=>{setCenter('3d');void refresh();}}/>}{infra?.resources.some(r=>r.kind==='alignment')&&<TrainSimulationPanel key={`train:${project}`} project={project} scene={infra} onDone={()=>{setCenter('3d');void refresh();}}/>}</section>
          {tab==='workspace-tools'&&<ModelingTools projectType={summary?.project?.projectType??(infra?.resources.length?'infrastructure':'superstructure')} onPanel={openPanel} onTool={name=>{setConsoleTool(name);openPanel('tools');}} onSection={()=>setMeshSectionOpen(true)} hasRoads={Boolean(infra?.resources.some(r=>r.kind==='road_corridor'))}/>}


          {project && <div style={{ display: tab === "assistant" ? "block" : "none", height: "100%" }}>

            <Assistant project={project} onProposals={() => { setTab("proposals"); void refresh(false); }} />

          </div>}

          {tab === "props" && (!selected?<div className="empty-state inspector-empty"><Box size={32}/><strong>Bir elemanla başlayın</strong><p>Özelliklerini, malzemesini ve miktarlarını görmek için modelden veya ağaçtan bir eleman seçin.</p><div className="empty-actions"><button className="ghost" onClick={()=>openPanel('navigate')}><Compass size={14}/>Güzergâhta gezin</button><button className="ghost" onClick={()=>setCenter('files')}><Files size={14}/>Proje dosyaları</button></div></div>:selected?.startsWith('infra:')?<StructureProperties element={element} materials={infra?.materials??{}} resources={infra?.resources??[]}/>:<Properties element={element} project={project} />)}

          {tab === "proposals" && (

            <Proposals items={proposals} canApprove={!!canApprove} me={user.id}

              onApprove={(id) => api.approve(project, id).then(() => refresh()).catch(fail)}

              onReject={(id) => { const r = prompt("Ret nedeni"); if (r !== null) api.reject(project, id, r).then(() => refresh(false)).catch(fail); }} />

          )}

          {tab === "history" && <History rows={history} onUndo={() => api.undo(project).then(() => refresh()).catch(fail)} />}

          {tab === "tools" && <ToolConsole key={consoleTool} initialName={consoleTool} tools={tools} project={project} onDone={() => refresh()} />}

          {tab === "types" && <FamilyLibrary project={project} resources={infra?.resources??[]} materials={infra?.materials??{}}/>}

          {tab==='cad'&&<CadInterpretation key={project} project={project} onDone={()=>void refresh(false)} onProposal={()=>{setTab('proposals');void refresh(false);}} onSource={data=>{const v=viewerRef.current;if(v){v.setCadSourceMode(true);setCenter('3d');void v.updateInfrastructure(data).then(()=>v.fitInfrastructure());}}} onReturn={()=>{viewerRef.current?.setCadSourceMode(false);setTab('props');void refresh();}}/>}
          {tab==='terrain'&&<TerrainImport key={project} project={project} projectCrs={summary?.project?.georef?.crs?.name} materials={infra?.materials??{}} onDone={()=>refresh()} onProposal={()=>{setTab('proposals');void refresh(false);}}/>}
          {tab==='roads'&&<RoadEditor project={project} alignments={infra?.resources.filter(r=>r.kind==='alignment')??[]} materials={infra?.materials??{}} onDone={()=>refresh()} onProposal={()=>{setTab('proposals');void refresh(false);}}/>}

        </div>

      </aside>

      <footer className="workspace-status"><span><span className={`dot ${live?'on':''}`}/>{live?'Bağlı':'Bağlantı bekleniyor'}</span><span>{infra?.resources.filter(r=>!r.parent).length??0} altyapı nesnesi</span><span>{selected?`Seçili: ${selected.replace(/^infra:/,'')}`:'Eleman seçilmedi'}</span><span className="grow"/><span>Metre · 1:1</span><span>Revizyon {summary?.seq??0}</span><a href="https://polyhaven.com" target="_blank" rel="noreferrer">Poly Haven</a></footer>
      {meshSectionOpen&&<MeshSectionPanel project={project} roads={infra?.resources.filter(r=>r.kind==='road_corridor')??[]} onClose={()=>setMeshSectionOpen(false)}/>}
      {error && <div role="alert" className="toast" onClick={() => setError("")}>{error} <span className="muted">(kapat)</span></div>}

    </div>

  );

}



function Properties({ element,project }: { element: any;project:string }) {

  const [selectedMaterial,setSelectedMaterial]=useState<number|null>(null);

  const [texturePreview,setTexturePreview]=useState("");

  const texture=element?.material_details?.[selectedMaterial??-1]?.definition?.appearance?.baseColorTexture;

  useEffect(()=>{

    setTexturePreview("");let url="",cancelled=false;

    if(texture)void api.texture(project,texture).then(blob=>{if(cancelled)return;url=URL.createObjectURL(blob);setTexturePreview(url);}).catch(()=>{});

    return ()=>{cancelled=true;if(url)URL.revokeObjectURL(url);};

  },[texture,project]);

  useEffect(()=>setSelectedMaterial(null),[element?.id]);

  if (!element) return <p className="muted">3D modelde ya da soldaki ağaçta bir eleman seç.</p>;

  const type = element.type_def;

  return (

    <div>

      <h3><code>{element.id}</code> {type?.name ?? element.kind}</h3>

      <table><tbody>

        <tr><th>Tür</th><td>{element.kind}</td></tr>

        <tr><th>Kat</th><td>{element.storey_name}</td></tr>

        <tr><th>IFC GlobalId</th><td><code>{element.global_id}</code></td></tr>

        {element.host && <tr><th>Host</th><td><code>{element.host}</code></td></tr>}

      </tbody></table>

      {type?.layers?.length>0&&<SectionDetail materials={Object.fromEntries((element.material_details??[]).filter((m:any)=>m.definition).map((m:any)=>[m.definition.id,m.definition]))} sections={[{name:type.name,id:type.id,schematic:true,polygons:type.layers.map((l:any,i:number)=>{const offset=type.layers.slice(0,i).reduce((n:number,x:any)=>n+x.thickness,0);return {name:l.function,materialId:l.material,thickness:l.thickness,points:[[offset,0],[offset+l.thickness,0],[offset+l.thickness,1],[offset,1]]};})}]}/>}
      {type?.layers && (<>

        <h4>Katmanlar (dış → iç / üst → alt)</h4>

        <table><tbody>{type.layers.map((l: any, i: number) => (

          <tr key={i} className={selectedMaterial===i?"sel":""}><td>{l.function}</td><td><button className="ghost" onClick={()=>setSelectedMaterial(i)}>{element.material_details?.[i]?.definition?.name ?? l.material}</button><small>{l.material}</small></td><td className="num">{(l.thickness * 100).toFixed(1)} cm</td></tr>))}</tbody></table>

      </>)}

      {!type?.layers&&element.material_details?.map((m:any,i:number)=><button key={i} className="ghost" onClick={()=>setSelectedMaterial(i)}>{m.definition?.name??m.material}</button>)}

      {selectedMaterial!==null&&(()=>{

        const material=element.material_details?.[selectedMaterial]?.definition;if(!material)return null;

        const a=material.appearance;

        return <section className="card" aria-label="Seçilen malzeme detayı"><h4>{material.name} <code>{material.id}</code></h4>

          <div style={{height:24,background:a?.baseColor??material.color??"#cccccc",opacity:a?.opacity??1,border:"1px solid #ccc"}}/>

          {texturePreview&&<img src={texturePreview} alt={`${material.name} doku önizlemesi`} style={{width:"100%",maxHeight:180,objectFit:"contain"}}/>}

          <p>{material.category??"Malzeme"}</p>

          {a&&<table><tbody><tr><th>Opaklık</th><td>{a.opacity}</td></tr><tr><th>Pürüzlülük</th><td>{a.roughness}</td></tr><tr><th>Metalik</th><td>{a.metallic}</td></tr><tr><th>Doku ölçeği</th><td>{a.textureSize?.join(" × ")} m</td></tr></tbody></table>}

          {a?.source&&<a href={`https://polyhaven.com/a/${a.source.assetId}`} target="_blank" rel="noreferrer">Poly Haven · {a.source.assetId}</a>}

        </section>;

      })()}

      <h4>Miktarlar</h4>

      <table><tbody>{Object.entries(element.quantities ?? {}).map(([k, v]) => (

        <tr key={k}><th>{k}</th><td className="num">{fmt(v as number)}</td></tr>))}</tbody></table>

      {element.openings?.length > 0 && (<>

        <h4>Açıklıklar</h4>

        <table><tbody>{element.openings.map((o: any) => (

          <tr key={o.id}><td><code>{o.id}</code></td><td>{o.filledBy ?? "boşluk"}</td><td className="num">{o.width}×{o.height} @ {o.along} m</td></tr>))}</tbody></table>

      </>)}

      {element.props && Object.entries(element.props).map(([pset, vals]) => (

        <div key={pset}><h4>{pset}</h4><table><tbody>{Object.entries(vals as object).map(([k, v]) => (

          <tr key={k}><th>{k}</th><td>{String(v)}</td></tr>))}</tbody></table></div>

      ))}

    </div>

  );

}



const PROPOSAL_NAMES:Record<string,string>={infra_create_alignment:'Güzergâh oluştur',infra_update_alignment:'Güzergâhı güncelle',infra_create_section_types:'Kesit tiplerini oluştur',infra_create_tunnel:'Tünel / portal yerleştir',infra_set_tunnel_ranges:'Tünel / portal boyunu güncelle',infra_create_road_corridor:'Koridor yerleştir',infra_update_road_corridor:'Koridoru güncelle',infra_navigate_alignment:'Kamerayı güzergâha götür',infra_update_section_type:'Kesit tipini güncelle',bim_create_materials:'Malzemeleri oluştur',bim_create_mep_segments:'MEP hattı oluştur',files_register:'Proje dosyasını kaydet'};
const PROPOSAL_STATES:Record<string,string>={pending:'Onay bekliyor',applied:'Uygulandı',failed:'Uygulanamadı',rejected:'Reddedildi',applying:'Uygulanıyor'};
function Proposals({items,canApprove,me,onApprove,onReject}:{items:Proposal[];canApprove:boolean;me:string;onApprove:(id:string)=>void|Promise<void>;onReject:(id:string)=>void}){
 const [filter,setFilter]=useState('pending'),[query,setQuery]=useState(''),[busy,setBusy]=useState<string|null>(null);
 const shown=items.filter(p=>(filter==='all'||p.status===filter)&&`${p.id} ${p.tool} ${JSON.stringify(p.preview?.summary)}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
 const approve=async(id:string)=>{setBusy(id);try{await onApprove(id);}finally{setBusy(null);}};
 const description=(p:Proposal)=>{const v=p.preview?.summary;if(v?.name)return v.name;if(v?.created)return v.created.map((x:any)=>typeof x==='string'?x:[x.id,x.category].filter(Boolean).join(' · ')).join(' · ');if(v?.start&&v?.end)return `${v.start} → ${v.end}${v.length_m?` · ${Number(v.length_m).toLocaleString('tr-TR')} m`:''}`;if(v?.id)return `${v.id}${v.from!==undefined?` · ${Number(v.from).toLocaleString('tr-TR')} → ${Number(v.to).toLocaleString('tr-TR')}`:''}`;return 'İşlemin parametrelerini aşağıdan inceleyebilirsiniz.';};
 return <div className="proposal-center"><p className="panel-intro">Model değişikliklerini inceleyin ve yetkiniz dahilinde onaylayın.</p><div className="proposal-filters">{[{id:'pending',label:'Bekleyen'},{id:'all',label:'Tümü'},{id:'failed',label:'Başarısız'}].map(({id,label})=><button key={id} className={filter===id?'on':''} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}<span>{items.filter(p=>id==='all'||p.status===id).length}</span></button>)}</div><label className="proposal-search"><Search size={14}/><input aria-label="Öneri ara" placeholder="Öneri kimliği veya işlem…" value={query} onChange={e=>setQuery(e.target.value)}/></label>{!shown.length&&<div className="empty-state"><Boxes size={28}/><strong>{filter==='pending'?'Bekleyen öneri yok':'Eşleşen öneri yok'}</strong><p>Diğer kayıtları görmek için filtreyi değiştirebilirsiniz.</p></div>}{shown.map(p=><article key={p.id} className={`card ${p.status}`}><div className="proposal-top"><code>{p.id}</code><span className={`proposal-status ${p.status}`}>{PROPOSAL_STATES[p.status]??p.status}</span></div><h3>{PROPOSAL_NAMES[p.tool]??p.tool.replace(/_/g,' ')}</h3><p>{description(p)}</p><small>{p.actor} · {when(p.createdAt)}</small><details className="proposal-details"><summary>Parametreleri ve özeti incele</summary><pre>{JSON.stringify({özet:p.preview?.summary,parametreler:p.input},null,2)}</pre></details>{p.status==='pending'?(canApprove&&p.actor!==me?<div className="row"><button disabled={busy!==null} onClick={()=>void approve(p.id)}>{busy===p.id?'Uygulanıyor…':'Onayla ve uygula'}</button><button className="ghost" disabled={busy!==null} onClick={()=>onReject(p.id)}>Reddet</button></div>:<p className="muted">{p.actor===me?'Kendi önerinizi onaylayamazsınız.':'Bu işlem için onay yetkiniz yok.'}</p>):<p className="proposal-reason">{p.decidedBy?`İşlem yapan: ${p.decidedBy}`:''}{p.reason?` · ${p.reason}`:''}</p>}</article>)}</div>;
}

function History({ rows, onUndo }: { rows: HistoryRow[]; onUndo: () => void }) {

  const latest = rows.find((r) => !r.reverted && r.tool!=="platform_undo");

  return (<div>

    {latest && <button onClick={onUndo}>Son işlemi geri al ({latest.tool})</button>}

    {rows.map((r) => (

      <div key={r.commandId} className={`card ${r.reverted ? "reverted" : ""}`}>

        <div><strong>{r.tool}</strong> <span className="muted">· {r.actor} · {when(r.at)}{r.proposalId ? ` · onaylı ${r.proposalId}` : ""}</span></div>

        <pre>{JSON.stringify(r.summary)}</pre>

        {r.reverted && <span className="muted">geri alındı</span>}

      </div>))}

  </div>);

}



function ToolConsole({ tools, project, onDone,initialName='bim_model_summary' }: { tools: ToolInfo[]; project: string; onDone: () => void;initialName?:string }) {

  const [name, setName] = useState(initialName);

  const tool = useMemo(() => tools.find((t) => t.name === name), [tools, name]);

  const [text, setText] = useState("{}");

  const [out, setOut] = useState<any>(null);

  const [busy, setBusy] = useState(false);

  useEffect(() => { if (tool) setText(JSON.stringify(skeleton(tool.schema), null, 2)); }, [tool]);

  const exec = async (dry: boolean) => {

    setBusy(true);

    try {

      const r = await api.run(project, name, JSON.parse(text), dry);

      setOut(r);

      if (r.status === "applied") onDone();

    } catch (e) { setOut({ error: (e as Error).message }); }

    setBusy(false);

  };

  const img = out?.status === "ok" ? out.result?.__image : null;

  return (<div className="console">

    <select value={name} onChange={(e) => setName(e.target.value)}>

      {tools.map((t) => <option key={t.name} value={t.name}>{t.module} · {t.name}</option>)}

    </select>

    <p className="muted">{tool?.description}</p>

    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} spellCheck={false} />

    <div className="row">

      {tool?.kind === "command" && <button className="ghost" disabled={busy} onClick={() => exec(true)}>Önizle (dry-run)</button>}

      <button disabled={busy || !project} onClick={() => exec(false)}>{tool?.kind === "command" ? "Uygula" : "Çalıştır"}</button>

    </div>

    {img ? <img className="result" src={`data:${img.mimeType};base64,${img.base64}`} /> : out && <pre>{JSON.stringify(out, null, 1)}</pre>}

  </div>);

}


