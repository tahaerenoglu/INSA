/**
 * Web API. The same platform tools as the manager MCP, over HTTP, with the same
 * governance (permissions, proposals, audit). Plus viewer endpoints (.frag
 * cached per model version, IFC, plan PNG) and a live change stream (SSE).
 *
 * AUTH: development login only (pick a user, get a bearer token). Replace with
 * the company identity provider (OIDC / Entra ID) before real use.
 */
import * as fs from "node:fs";
import {registerGoogleMap} from './google-map.js';
import {fileVersion,type FilesState} from '@insa/files';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Platform, Actor, parseProjectId, publicError, can, canonicalJson, projectTypeFromState, hasInfrastructureModel, toolAvailableForProject } from "@insa/core";
import { BimState, toIfc, ifcToFrag, ifcGuid, quantities, elementLabel, elementGroup, categoryIdOfElement, findCategory } from "@insa/bim";
import { runAgent, ModelClient, AnthropicClient, DEFAULT_MODEL, Message } from "@insa/agent";
import {loadTerrain,parseLandXml,type InfraState} from '@insa/infra';
import {infrastructureScene,infrastructureKey,infrastructureMaterials} from './infrastructure.js';

export interface WebUser extends Actor { password?: string; }

export const DEV_USERS: WebUser[] = [
  { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] },
  { id: "modeler", name: "Modelci", kind: "human", roles: ["modeler"] },
  { id: "viewer", name: "İzleyici", kind: "human", roles: ["viewer"] },
  { id: "admin", name: "Admin", kind: "human", roles: ["admin"] },
];

export interface AppOptions {
  platform: Platform; users?: WebUser[]; devLogin?: boolean; logger?: boolean;
  /** In-app assistant model; default: Anthropic API when ANTHROPIC_API_KEY is set, otherwise disabled. */
  model?: ModelClient | null;
}

export function defaultModel(): ModelClient | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key ? new AnthropicClient(key, process.env.INSA_AI_MODEL ?? DEFAULT_MODEL) : null;
}

class HttpError extends Error { constructor(readonly status: number, msg: string, readonly reason = "HTTP_ERROR") { super(msg); } }

export function buildApp(opts: AppOptions): FastifyInstance {
  const { platform } = opts;
  const users = opts.users ?? DEV_USERS;
  const sessions = new Map<string, WebUser>();
  const fragCache = new Map<string, { seq: number; bytes: Uint8Array }>();
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });

  app.setErrorHandler((err: any, req, reply) => {
    if(err?.code==='FST_ERR_CTP_BODY_TOO_LARGE')return void reply.status(413).send({error:'Request exceeds the configured file/body size limit.',reason:'INVALID_INPUT'});
    if (err instanceof HttpError) return void reply.status(err.status).send({ error: err.message, code: "http", reason: err.reason });
    if (err?.name === "ZodError") return void reply.status(400).send({ error: "Invalid request body.", code: "domain", reason: "INVALID_INPUT" });
    if (err?.validation && err?.statusCode === 400) return void reply.status(400).send({ error: err.message, code: "domain", reason: "INVALID_INPUT" });
    const pe = publicError(err);
    if (pe.internal) req.log.error(err);
    void reply.status(pe.status).send({ error: pe.message, code: pe.code, reason: pe.reason, ...(pe.details ? { details: pe.details } : {}) });
  });

  const auth = (req: FastifyRequest): WebUser => {
    const h = req.headers.authorization;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : (req.query as any)?.token;
    const u = token ? sessions.get(token) : undefined;
    if (!u) throw new HttpError(401, "Not signed in.", "UNAUTHENTICATED");
    return u;
  };
  /** Early, friendly rejection; the Core validates again (authoritative). */
  const projectOf = (req: FastifyRequest) => parseProjectId((req.params as any).project);
  registerGoogleMap(app,platform,auth,projectOf);
  const run = async (u: Actor, project: string, tool: string, input: unknown, dryRun = false) =>
    platform.execute(u, project, tool, input, { dryRun });
  const result = (r: any) => (r.status === "ok" ? r.result : r);
  const projectType = async (project: string) => {
    const [bim, infra] = await Promise.all([platform.state<any>(project, "bim").catch(() => ({})), platform.state<any>(project, "infra").catch(() => ({}))]);
    return projectTypeFromState(bim, hasInfrastructureModel(infra));
  };

  // ------------------------------------------------------------ auth
  app.get("/api/auth/users", async () => {
    if (opts.devLogin === false) throw new HttpError(404, "Dev login disabled.");
    return users.map(({ id, name, roles }) => ({ id, name, roles }));
  });
  app.post("/api/auth/login", async (req) => {
    if (opts.devLogin === false) throw new HttpError(404, "Dev login disabled.");
    const { user } = z.object({ user: z.string() }).parse(req.body);
    const u = users.find((x) => x.id === user);
    if (!u) throw new HttpError(401, "Unknown user.");
    const token = randomUUID();
    sessions.set(token, u);
    return { token, user: { id: u.id, name: u.name, roles: u.roles } };
  });
  app.get("/api/me", async (req) => platform.whoami(auth(req)));

  // ------------------------------------------------------------ tools (same as MCP)
  app.get("/api/tools", async (req) => {
    auth(req);
    const selectedProject = (req.query as any)?.project;
    const type = typeof selectedProject === "string" ? await projectType(parseProjectId(selectedProject)) : undefined;
    return platform.listTools().filter((t) => !type || toolAvailableForProject(type, t)).map((t) => ({
      name: t.name, module: t.module, title: t.title, description: t.description, kind: t.kind, effect: t.effect,
      permission: t.permission, schema: z.toJSONSchema(t.input as z.ZodType, { unrepresentable: "any" }),
    }));
  });
  app.post("/api/projects/:project/tools/:tool", async (req) => {
    const u = auth(req);
    const body = z.object({ input: z.unknown().optional(), dry_run: z.boolean().optional() }).parse(req.body ?? {});
    const project = projectOf(req), name = (req.params as any).tool, def = platform.listTools().find((t) => t.name === name);
    if (def && !toolAvailableForProject(await projectType(project), def)) throw new HttpError(400, `Bu araç seçili proje türünde kullanılamaz: ${name}`, "TOOL_NOT_AVAILABLE_FOR_PROJECT_TYPE");
    return run(u, project, name, body.input ?? {}, body.dry_run);
  });

  // Authorized immutable upload. Model creation/replacement remains a governed Platform command.
  app.addContentTypeParser('application/xml',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
  app.post('/api/projects/:project/terrain-source',{bodyLimit:5*1024*1024},async(req)=>{
    const user=auth(req);if(!can(user,'infra.write'))throw new HttpError(403,'Not allowed');
    const data=req.body as Buffer,source=parseLandXml(data,(req.query as any)?.surfaceName),asset=platform.requireArtifacts().saveTerrainSource(projectOf(req),data);
    return {...asset,surfaceName:source.surfaceName,sourceCrs:source.declaredCrs,verticalDatum:source.declaredDatum,xyUnit:source.linearUnit,sourcePoints:source.points.length,sourceFaces:source.faces.length,elevationAttributeUnit:source.elevationAttributeUnit,warnings:source.warnings};
  });
  app.get('/api/projects/:project/terrain-source/:asset',async(req,reply)=>{
    const user=auth(req);if(!can(user,'infra.read'))throw new HttpError(403,'Not allowed');const asset=(req.params as any).asset,bytes=platform.requireArtifacts().readTerrainSource(projectOf(req),asset);
    return reply.type('application/xml').header('content-disposition',`attachment; filename="${asset}"`).send(bytes);
  });

  app.get('/api/projects/:project/files/:file/download',async(req,reply)=>{
    const user=auth(req);if(!can(user,'files.read',platform.roles))throw new HttpError(403,'Not allowed');
    const project=projectOf(req),file=z.string().regex(/^F-\d{4,}$/).parse((req.params as any).file),query=z.object({version:z.coerce.number().int().min(1).optional()}).parse(req.query),state=await platform.state<FilesState>(project,'files'),{version}=fileVersion(state,file,query.version),bytes=platform.requireArtifacts().readProjectFile(project,version.asset);
    return reply.type(version.mime).header('x-content-type-options','nosniff').header('content-disposition',`attachment; filename="source.${version.filename.split('.').at(-1)}"; filename*=UTF-8''${encodeURIComponent(version.filename)}`).send(bytes);
  });

  // ------------------------------------------------------------ projects & model
  const infraCache=new Map<string,ReturnType<typeof infrastructureScene>>();
  const infraDerivedCache=new Map<string,any>();
  app.get('/api/projects/:project/infrastructure',async(req)=>{
    const user=auth(req);if(!can(user,'infra.read')||!can(user,'bim.read'))throw new HttpError(403,'Not allowed');
    const project=projectOf(req),s=await platform.state<InfraState>(project,'infra'),b=await platform.state<BimState>(project,'bim'),key=infrastructureKey(project,s,b);
    const terrainData=new Map(Object.values(s.terrains??{}).map(t=>[t.id,loadTerrain(platform.requireArtifacts(),project,t)]));
    const cached=infraCache.get(key);if(cached)return infrastructureMaterials(cached,s,b);
    // A railway scene can contain hundreds of thousands of repeated solids.
    // Retain only the current revision per project, not eight full historical scenes.
    for(const [oldKey,oldScene]of infraCache)if(oldScene.project===project)infraCache.delete(oldKey);
    const data=infrastructureScene(project,s,b,infraDerivedCache,terrainData);if(infraCache.size>=8)infraCache.delete(infraCache.keys().next().value!);infraCache.set(key,data);return infrastructureMaterials(data,s,b);
  });
  app.post('/api/projects/:project/cad-source',{bodyLimit:14*1024*1024},async(req)=>{const user=auth(req);if(!can(user,'infra.write'))throw new HttpError(403,'Not allowed');const body=z.object({filename:z.string().max(120),base64:z.string().max(14000000)}).parse(req.body),bytes=Buffer.from(body.base64,'base64');if(!/\.dxf$/i.test(body.filename))throw new HttpError(415,'Native DWG desteklenmiyor. Model-space ASCII/UTF-8 DXF dışa aktarımı sağlayın; Civil 3D gerekmez.');const {parseDxf}=await import('@insa/infra');parseDxf(bytes);return platform.requireArtifacts().saveCadSource(projectOf(req),bytes);});
  app.get('/api/projects/:project/cad-source/:asset',async(req,reply)=>{const user=auth(req);if(!can(user,'infra.read'))throw new HttpError(403,'Not allowed');try{return reply.type('application/dxf').header('Content-Disposition','attachment; filename="source.dxf"').send(platform.requireArtifacts().readCadSource(projectOf(req),(req.params as any).asset));}catch(e){if((e as any).reason==='ARTIFACT_NOT_FOUND')throw new HttpError(404,'CAD source not found in this project.');throw e;}});
  app.get("/api/projects", async (req) => { auth(req); return platform.stores.listProjects(); });
  const creatingProjects=new Set<string>();
  app.post('/api/projects',async(req)=>{
    const user=auth(req),body=z.object({id:z.string(),name:z.string().trim().min(1).max(160),description:z.string().max(4000).optional(),projectType:z.enum(["infrastructure","superstructure"]).default("superstructure")}).parse(req.body);
    if(!can(user,'bim.write'))throw new HttpError(403,'Proje oluşturma yetkiniz yok.');
    const id=parseProjectId(body.id);
    if(creatingProjects.has(id))throw new HttpError(409,'Bu proje oluşturuluyor.');
    creatingProjects.add(id);
    try{
      if((await platform.stores.listProjects()).includes(id))throw new HttpError(409,'Bu proje kimliği zaten kullanılıyor.');
      return {id,...await run(user,id,'bim_set_project',{name:body.name,description:body.description??'',project_type:body.projectType})};
    }finally{creatingProjects.delete(id);}
  });
  app.get("/api/projects/:project/summary", async (req) => {
    const project = projectOf(req), r: any = await run(auth(req), project, "bim_model_summary", {});
    const state = await platform.state<BimState>(project, "bim");
    return { ...r.result, project:{...r.result.project,projectType:projectTypeFromState(state,hasInfrastructureModel(await platform.state<any>(project,"infra").catch(()=>({}))))}, seq: await platform.seq(project), geometryKey: geometryKey(state) };
  });
  const geometryKey = (s: BimState) => createHash("sha256").update(canonicalJson({ ...s, materials: {} })).digest("hex");
  app.get("/api/projects/:project/appearances", async(req) => {
    const u=auth(req); if(!can(u,"bim.read"))throw new HttpError(403,"Not allowed");
    const project=projectOf(req),s=await platform.state<BimState>(project,"bim");
    return { materials:s.materials, bindings:Object.values(s.elements).flatMap(e=>{
      if(!("type" in e))return [];
      const t:any=s.types[e.type]; const material=t?.finishMaterial ?? t?.layers?.[0]?.material ?? t?.material;
      if(t?.kind === "window" && t.windowFrame) return []; // IFC per-solid frame/glass styles preserve one window identity.
      if(e.kind === "pitched_roof" && material) return Array.from({length:e.form === "gable"?2:4},(_,i)=>({guid:ifcGuid(`${project}:${e.id}.R${i}`),elementId:e.id,materialId:material}));
      return material?[{guid:ifcGuid(`${project}:${e.id}`),elementId:e.id,materialId:material}]:[];
    }),credit:"Powered by Poly Haven" };
  });
  app.get("/api/projects/:project/textures/:asset",async(req,reply)=>{
    const u=auth(req);if(!can(u,"bim.read"))throw new HttpError(403,"Not allowed");
    const file=platform.requireArtifacts().resolveTexture(projectOf(req),(req.params as any).asset);
    return reply.header("content-type","image/jpeg").header("x-content-type-options","nosniff").header("cache-control","private, max-age=31536000, immutable").send(fs.createReadStream(file));
  });
  app.get("/api/projects/:project/tree", async (req) => {
    auth(req);
    const project = projectOf(req);
    const s = await platform.state<BimState>(project, "bim");
    return Object.values(s.storeys).sort((a, b) => a.elevation - b.elevation).map((st) => {
      const els = Object.values(s.elements).filter((e) => e.storey === st.id && e.kind !== "opening");
      const groups: Record<string, { id: string; label: string; global_id: string; category: string; categoryLabel: string; discipline: string }[]> = {};
      for (const e of els) {
        const category = categoryIdOfElement(s, e) ?? elementGroup(s, e);
        const discipline = findCategory(category)?.discipline ?? "generic";
        (groups[elementGroup(s, e)] ??= []).push({ id: e.id, label: e.name ?? ("type" in e ? s.types[e.type]?.name ?? e.id : e.id),
          global_id: ifcGuid(`${project}:${e.id}`), category, categoryLabel: findCategory(category)?.name ?? category, discipline });
      }
      return { id: st.id, name: st.name, elevation: st.elevation, groups };
    });
  });
  app.get("/api/projects/:project/elements/:id", async (req) => {
    const project = projectOf(req);
    const r: any = await run(auth(req), project, "bim_get_element", { id: (req.params as any).id });
    return { ...r.result, global_id: ifcGuid(`${project}:${r.result.id}`) };
  });

  async function fragFor(project: string) {
    const seq = await platform.seq(project);
    const hit = fragCache.get(project);
    if (hit && hit.seq === seq) return hit;
    const s = await platform.state<BimState>(project, "bim");
    const entry = { seq, bytes: await ifcToFrag(toIfc(s, { projectKey: project, spaceGeometry: false })) };
    fragCache.set(project, entry);
    return entry;
  }
  app.get("/api/projects/:project/model.frag", async (req, reply) => {
    auth(req);
    const f = await fragFor(projectOf(req));
    return reply.header("content-type", "application/octet-stream").header("x-insa-seq", String(f.seq))
      .header("cache-control", "no-store").send(Buffer.from(f.bytes));
  });
  app.get("/api/projects/:project/model.ifc", async (req, reply) => {
    const u = auth(req);
    const project = projectOf(req);
    await run(u, project, "bim_model_summary", {}); // permission check (bim.read)
    const s = await platform.state<BimState>(project, "bim");
    return reply.header("content-type", "application/x-step")
      .header("content-disposition", `attachment; filename="${encodeURIComponent(s.project.name)}.ifc"`).send(toIfc(s, { projectKey: project }));
  });
  app.get("/api/projects/:project/plan/:storey.png", async (req, reply) => {
    const r: any = await run(auth(req), projectOf(req), "bim_render_plan", { storey: (req.params as any).storey, show_ids: true });
    return reply.header("content-type", "image/png").send(Buffer.from(r.result.__image.base64, "base64"));
  });
  app.get("/api/projects/:project/quantities", async (req) => {
    auth(req);
    const s = await platform.state<BimState>(projectOf(req), "bim");
    return Object.values(s.elements).filter((e) => e.kind !== "opening").map((e) => ({ id: e.id, kind: e.kind, quantities: quantities(s, e) }));
  });

  // ------------------------------------------------------------ governance
  app.get("/api/projects/:project/proposals", async (req) => {
    auth(req);
    const status = (req.query as any).status as string | undefined;
    return (await platform.store(projectOf(req)).readProposals()).filter((p) => !status || p.status === status).reverse();
  });
  app.post("/api/projects/:project/proposals/:id/approve", async (req) =>
    platform.approve(auth(req), projectOf(req), (req.params as any).id));
  app.post("/api/projects/:project/proposals/:id/reject", async (req) =>
    platform.reject(auth(req), projectOf(req), (req.params as any).id, (req.body as any)?.reason));
  app.get("/api/projects/:project/history", async (req) => { auth(req); return platform.history(projectOf(req), 100); });
  // undo is a governed write: same permission / proposal / audit rules as every other command
  app.post("/api/projects/:project/undo", async (req) => {
    const cid = (req.body as any)?.command_id;
    return run(auth(req), projectOf(req), "platform_undo", cid ? { command_id: cid } : {});
  });

  // export artifacts (server-controlled storage; downloads by artifact id, never by path)
  app.get("/api/projects/:project/exports", async (req) => {
    const u = auth(req);
    if (!can(u, "bim.export")) throw new HttpError(403, "Not allowed to read exports.", "UNAUTHORIZED");
    return platform.requireArtifacts().list(projectOf(req));
  });
  app.get("/api/projects/:project/exports/:artifact", async (req, reply) => {
    const u = auth(req);
    if (!can(u, "bim.export")) throw new HttpError(403, "Not allowed to read exports.", "UNAUTHORIZED");
    const a = platform.requireArtifacts().resolve(projectOf(req), (req.params as any).artifact);
    return reply.header("content-type", a.kind === "ifc" ? "application/x-step" : "application/octet-stream")
      .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent((req.params as any).artifact)}`)
      .send(fs.createReadStream(a.path));
  });
  app.get("/api/projects/:project/audit", async (req) => result(await run(auth(req), projectOf(req), "platform_audit_log", { limit: 100 })));

  // ------------------------------------------------------------ in-app assistant
  const model = opts.model === undefined ? defaultModel() : opts.model;
  app.get("/api/assistant/status", async (req) => {
    auth(req);
    return { enabled: !!model, model: model instanceof AnthropicClient ? model.model : model ? "custom" : null };
  });
  app.post("/api/projects/:project/assistant", async (req, reply) => {
    const u = auth(req);
    const project = projectOf(req);
    if (!model) throw new HttpError(503, "Asistan yapılandırılmamış: sunucuda ANTHROPIC_API_KEY tanımlı değil.");
    const body = z.object({ message: z.string().min(1).max(20000), history: z.array(z.any()).max(400).default([]) }).parse(req.body);
    // the assistant acts with the signed-in user's roles, under its own identity, and never bypasses approval
    const actor: Actor = { id: `ai:${u.id}`, name: `Asistan (${u.name})`, kind: "ai", roles: u.roles };
    const selectedType = await projectType(project);
    const ctrl = new AbortController();
    req.raw.on("close", () => ctrl.abort());
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e: unknown) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      for await (const ev of runAgent({ platform, actor, project, projectType: selectedType, model, history: body.history as Message[], userText: body.message, signal: ctrl.signal }))
        send(ev);
    } catch (e) {
      send({ type: "error", message: (e as Error).message });
    }
    reply.raw.end();
  });

  // ------------------------------------------------------------ live changes (SSE)
  app.get("/api/projects/:project/stream", (req: FastifyRequest, reply: FastifyReply) => {
    auth(req);
    const project = projectOf(req);
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = async () => reply.raw.write(`event: change\ndata: ${JSON.stringify({ seq: await platform.seq(project) })}\n\n`);
    void send();
    const unsub = platform.stores.subscribe?.(project, () => void send()) ?? (() => {});
    const beat = setInterval(() => reply.raw.write(": ping\n\n"), 15000);
    req.raw.on("close", () => { unsub(); clearInterval(beat); });
  });

  return app;
}
