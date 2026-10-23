/** Typed client for the INSA web API (same tools and governance as the manager MCP). */
export interface User { id: string; name: string; roles: string[]; }
export interface TreeItem { id: string; label: string; global_id: string;global_ids?:string[];parentId?:string;assemblyId?:string;typeId?:string;typeName?:string;familyId?:string;systemIds?:string[];systemNames?:string[]; category: string; categoryLabel: string; discipline: string; }
export interface TreeNode { id: string; name: string; elevation: number; groups: Record<string, TreeItem[]>; }
export interface Proposal { id: string; tool: string; actor: string; createdAt: string; status: string; input: unknown; preview: any; decidedBy?: string; reason?: string; }
export interface HistoryRow { commandId: string; tool: string; actor: string; at: string; summary: unknown; reverted: boolean; proposalId?: string; events: number; }
export interface ToolInfo { name: string; module: string; title: string; description: string; kind: "query" | "command"; effect: string; permission: string; schema: any; }

let token = typeof localStorage==='undefined'?'':localStorage.getItem("insa_token") ?? "";

export class ApiError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new ApiError(r.status, e.error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

export const api = {
  portalMapTargets:(p:string)=>req<any>('GET',`/api/projects/${encodeURIComponent(p)}/google-map/portal-targets`),
  portalMapPlan:(p:string,input:unknown)=>req<any>('POST',`/api/projects/${encodeURIComponent(p)}/google-map/portal-plan`,input),
  bridgeMapTargets:(p:string)=>req<any>('GET',`/api/projects/${encodeURIComponent(p)}/google-map/bridge-targets`),
  bridgeMapPlan:(p:string,input:unknown)=>req<any>('POST',`/api/projects/${encodeURIComponent(p)}/google-map/bridge-plan`,input),
  googleMap:(p:string)=>req<any>('GET',`/api/projects/${encodeURIComponent(p)}/google-map`),
  googleMapSession:(p:string,provider:'google'|'cesium'|'terrain'='google',accessToken?:string)=>req<{apiKey:string;provider:'google'|'cesium'|'terrain';assetId?:number}>('POST',`/api/projects/${encodeURIComponent(p)}/google-map/session`,{provider,...(accessToken?{accessToken}:{})}),
  projectFileUrl:(p:string,file:string,version:number)=>`/api/projects/${encodeURIComponent(p)}/files/${encodeURIComponent(file)}/download?version=${version}&token=${encodeURIComponent(token)}`,
  async stageProjectFile(p:string,file:File){if(file.size>10*1024*1024)throw new Error('En fazla 10 MiB yüklenebilir.');const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Dosya okunamadı.'));reader.readAsDataURL(file);});return req<any>('POST',`/api/projects/${encodeURIComponent(p)}/tools/files_upload`,{input:{filename:file.name,base64}});},
  async uploadCad(p:string,file:File){const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});return req<any>('POST',`/api/projects/${encodeURIComponent(p)}/cad-source`,{filename:file.name,base64});},
  cadSourceUrl:(p:string,id:string)=>`/api/projects/${encodeURIComponent(p)}/cad-source/${encodeURIComponent(id)}?token=${token}`,

  async uploadTerrain(p:string,file:File,surfaceName?:string){const r=await fetch(`/api/projects/${encodeURIComponent(p)}/terrain-source${surfaceName?`?surfaceName=${encodeURIComponent(surfaceName)}`:''}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/xml'},body:file});const result=await r.json();if(!r.ok)throw new ApiError(r.status,result.error??'Terrain upload failed');return result;},
  terrainSourceUrl:(p:string,id:string)=>`/api/projects/${encodeURIComponent(p)}/terrain-source/${encodeURIComponent(id)}?token=${token}`,

  infrastructure:(p:string)=>req<import('./infrastructure-view').InfraScene>('GET',`/api/projects/${p}/infrastructure`),
  appearances: (p: string) => req<any>("GET", `/api/projects/${p}/appearances`),
  async texture(p:string,asset:string):Promise<Blob> {
    const r=await fetch(`/api/projects/${encodeURIComponent(p)}/textures/${encodeURIComponent(asset)}`,{headers:{authorization:`Bearer ${token}`}});
    if(!r.ok)throw new ApiError(r.status,"Texture asset unavailable"); return r.blob();
  },
  get token() { return token; },
  users: () => req<User[]>("GET", "/api/auth/users"),
  async login(user: string) {
    const r = await req<{ token: string; user: User }>("POST", "/api/auth/login", { user });
    token = r.token; localStorage.setItem("insa_token", token);
    return r.user;
  },
  logout() { token = ""; localStorage.removeItem("insa_token"); },
  me: () => req<{ actor: User; permissions: string[]; approvalMode: string; writesNeedApproval: boolean }>("GET", "/api/me"),
  projects: () => req<string[]>("GET", "/api/projects"),
  createProject:(id:string,name:string,description:string,projectType:'infrastructure'|'superstructure')=>req<any>('POST','/api/projects',{id,name,description,projectType}),
  tools: (project?:string) => req<ToolInfo[]>("GET", `/api/tools${project?`?project=${encodeURIComponent(project)}`:''}`),
  run: (p: string, tool: string, input: unknown, dry_run = false) => req<any>("POST", `/api/projects/${p}/tools/${tool}`, { input, dry_run }),
  summary: (p: string) => req<any>("GET", `/api/projects/${p}/summary`),
  tree: (p: string) => req<TreeNode[]>("GET", `/api/projects/${p}/tree`),
  semantics:(p:string)=>req<any>('GET',`/api/projects/${p}/semantics`),
  element: (p: string, id: string) => req<any>("GET", `/api/projects/${p}/elements/${encodeURIComponent(id)}`),
  proposals: (p: string) => req<Proposal[]>("GET", `/api/projects/${p}/proposals`),
  approve: (p: string, id: string) => req<any>("POST", `/api/projects/${p}/proposals/${id}/approve`, {}),
  reject: (p: string, id: string, reason: string) => req<any>("POST", `/api/projects/${p}/proposals/${id}/reject`, { reason }),
  history: (p: string) => req<HistoryRow[]>("GET", `/api/projects/${p}/history`),
  undo: (p: string) => req<any>("POST", `/api/projects/${p}/undo`, {}),
  async frag(p: string): Promise<{ bytes: Uint8Array; seq: number }> {
    const r = await fetch(`/api/projects/${p}/model.frag`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) throw new ApiError(r.status, "model.frag failed");
    return { bytes: new Uint8Array(await r.arrayBuffer()), seq: Number(r.headers.get("x-insa-seq")) };
  },
  ifcUrl: (p: string) => `/api/projects/${p}/model.ifc?token=${token}`,
  planUrl: (p: string, storey: string, seq: number) => `/api/projects/${p}/plan/${encodeURIComponent(storey)}.png?token=${token}&v=${seq}`,
  stream: (p: string) => new EventSource(`/api/projects/${p}/stream?token=${token}`),
  assistantStatus: () => req<{ enabled: boolean; model: string | null }>("GET", "/api/assistant/status"),
  /** Streams assistant events (text deltas, tool calls/results, done) for one user turn. */
  async assistant(p: string, message: string, history: unknown[], onEvent: (e: AssistantEvent) => void, signal: AbortSignal) {
    const r = await fetch(`/api/projects/${p}/assistant`, {
      method: "POST", signal, body: JSON.stringify({ message, history }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (!r.ok || !r.body) { const e = await r.json().catch(() => ({ error: r.statusText })); throw new ApiError(r.status, e.error); }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (chunk.startsWith("data: ")) onEvent(JSON.parse(chunk.slice(6)));
      }
    }
  },
};

export type AssistantEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; status?: string; summary: unknown; image?: string }
  | { type: "done"; messages: unknown[]; stop_reason: string | null; steps: number }
  | { type: "error"; message: string };

