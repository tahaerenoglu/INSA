/**
 * Server-controlled export storage. Callers never pass filesystem paths: they
 * get artifact metadata back and download by artifact id (= file name) within
 * their project.
 *
 * Layout: <root>/<projectId>/exports/<file>  (same root as the file event store)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./errors.js";
import { parseProjectId } from "./ids.js";

export type ArtifactKind = "ifc" | "frag";

export interface ArtifactInfo {
  id: string;            // file name; unique within the project
  project: string;
  kind: ArtifactKind;
  bytes: number;
  sha256: string;
  createdAt: string;
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.()-]{0,99}$/u;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const EXT: Record<ArtifactKind, string> = { ifc: ".ifc", frag: ".frag" };

const invalid = (msg: string) => new DomainError(msg, "INVALID_EXPORT_PATH");

/** Validates a caller-supplied base name (no directories, no traversal); never "fixes" it silently. */
export function parseArtifactBaseName(name: string): string {
  if (typeof name !== "string" || !NAME.test(name) || name.includes("..") || name.endsWith(".") || name.endsWith(" ") || RESERVED.test(name))
    throw invalid(`Invalid export name ${JSON.stringify(String(name).slice(0, 80))}: use a plain file name (letters, digits, space, '_', '-', '.', '()'), no folders or '..'.`);
  return name;
}

/** Derives a safe base name from free text (e.g. a project title) for server-chosen names. */
export function safeBaseName(text: string, fallback = "model"): string {
  const s = text.normalize("NFC").replace(/[^\p{L}\p{N}_.-]+/gu, "_").replace(/\.{2,}/g, "_").replace(/^[^\p{L}\p{N}]+/u, "").replace(/[._-]+$/u, "").slice(0, 80);
  return s && !RESERVED.test(s) ? s : fallback;
}

export class ArtifactStore {
  readonly root: string;
  constructor(root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.root = fs.realpathSync(root);
  }

  /** Immutable project documents reuse the same scoped artifact storage as CAD/terrain. */
  saveProjectFile(project:string,extension:string,data:Uint8Array){
    if(!/^(pdf|txt|md|csv|json|xml|kml|kmz|dxf|dwg|ifc|docx|xlsx|png|jpg|jpeg)$/.test(extension)||!data.length||data.length>10*1024*1024)throw invalid('Unsupported document type or size; maximum 10 MiB.');
    const sha256=createHash('sha256').update(data).digest('hex'),id=`file-${sha256}.${extension}`,dir=this.dir(project,true),full=this.fileIn(dir,id);
    if(!fs.existsSync(full)){const tmp=path.join(dir,`.tmp-${randomUUID()}`);fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,full);}return {id,sha256,bytes:data.length};
  }
  readProjectFile(project:string,id:string):Buffer{
    if(!/^file-[a-f0-9]{64}\.(pdf|txt|md|csv|json|xml|kml|kmz|dxf|dwg|ifc|docx|xlsx|png|jpg|jpeg)$/.test(id))throw invalid('Invalid project file reference.');
    const full=this.fileIn(this.dir(project,false),id);if(!fs.existsSync(full))throw new DomainError('Project file missing.','ARTIFACT_NOT_FOUND');
    if(fs.realpathSync(full)!==full||!fs.statSync(full).isFile()||fs.statSync(full).size>10*1024*1024)throw invalid('Invalid project file.');
    const bytes=fs.readFileSync(full);if(createHash('sha256').update(bytes).digest('hex')!==id.slice(5,69))throw invalid('Project file checksum mismatch.');return bytes;
  }
  private fileAnalysisId(asset:string){if(!/^file-[a-f0-9]{64}\.(pdf|txt|md|csv|json|xml|kml|kmz|dxf|dwg|ifc|docx|xlsx|png|jpg|jpeg)$/.test(asset))throw invalid('Invalid project file reference.');return `analysis-${asset.slice(5).replace('.','-')}-v1.json`;}
  saveFileAnalysis(project:string,asset:string,data:string){
    this.readProjectFile(project,asset);if(Buffer.byteLength(data)>8*1024*1024)throw invalid('File analysis exceeds storage limit.');const full=this.fileIn(this.dir(project,true),this.fileAnalysisId(asset));
    if(!fs.existsSync(full)){const tmp=full+'.'+randomUUID()+'.tmp';fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,full);}
  }
  readFileAnalysis(project:string,asset:string):string{
    const full=this.fileIn(this.dir(project,false),this.fileAnalysisId(asset));if(!fs.existsSync(full))throw new DomainError('File analysis not available.','ARTIFACT_NOT_FOUND');
    if(fs.realpathSync(full)!==full||!fs.statSync(full).isFile()||fs.statSync(full).size>8*1024*1024)throw invalid('Invalid file analysis.');return fs.readFileSync(full,'utf8');
  }

  /** Immutable engineering source, scoped to the same project artifact directory. No individual deletion API. */
  saveCadSource(project:string,data:Uint8Array):{id:string;sha256:string;bytes:number}{
    if(!data.length||data.length>10*1024*1024)throw invalid('CAD source must be 1 byte–10 MiB.');
    if(Buffer.from(data.subarray(0,6)).toString('ascii').startsWith('AC10'))throw new DomainError('Native DWG desteklenmiyor. Dosyayı hazırlayan kişiden ASCII DXF (model space, explode/proxy export) isteyin; Civil 3D gerekmez.','INVALID_INPUT');
    const sha256=createHash('sha256').update(data).digest('hex'),id=`cad-${sha256}.dxf`,dir=this.dir(project,true),full=this.fileIn(dir,id);
    if(!fs.existsSync(full)){const tmp=path.join(dir,`.tmp-${randomUUID()}`);fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,full);}this.readCadSource(project,id);return {id,sha256,bytes:data.length};
  }
  readCadSource(project:string,id:string):Buffer{
    if(!/^cad-[a-f0-9]{64}\.dxf$/.test(id))throw invalid('Invalid CAD source asset reference.');const full=this.fileIn(this.dir(project,false),id);
    if(!fs.existsSync(full))throw new DomainError('CAD source missing in this project.','ARTIFACT_NOT_FOUND');if(fs.realpathSync(full)!==full||!fs.statSync(full).isFile()||fs.statSync(full).size>10*1024*1024)throw invalid('Invalid CAD source file.');const data=fs.readFileSync(full);if(createHash('sha256').update(data).digest('hex')!==id.slice(4,-4))throw invalid('CAD source checksum mismatch.');return data;
  }

  saveTerrainSource(project:string,data:Uint8Array):{id:string;sha256:string;bytes:number} {
    if(!data.length||data.length>5*1024*1024)throw invalid('Terrain source must be 1 byte–5 MiB.');
    const sha256=createHash('sha256').update(data).digest('hex'),id=`terrain-${sha256}.xml`,dir=this.dir(project,true),full=this.fileIn(dir,id);
    if(!fs.existsSync(full)){const tmp=path.join(dir,`.tmp-${randomUUID()}`);fs.writeFileSync(tmp,data,{flag:'wx'});fs.renameSync(tmp,full);}
    this.readTerrainSource(project,id);return {id,sha256,bytes:data.length};
  }
  readTerrainSource(project:string,id:string):Buffer {
    if(!/^terrain-[a-f0-9]{64}\.xml$/.test(id))throw invalid('Invalid terrain source asset reference; paths/URLs are not accepted.');
    const full=this.fileIn(this.dir(project,false),id);
    if(!fs.existsSync(full))throw new DomainError('Terrain source asset missing in this project.','ARTIFACT_NOT_FOUND');
    if(fs.realpathSync(full)!==full||!fs.statSync(full).isFile()||fs.statSync(full).size>5*1024*1024)throw invalid('Invalid terrain source file.');
    const data=fs.readFileSync(full);if(createHash('sha256').update(data).digest('hex')!==id.slice(8,-4))throw invalid('Terrain source checksum mismatch.');return data;
  }

  /** Immutable, content-addressed JPG texture cache in the existing project storage. */
  saveTexture(project: string, md5: string, data: Uint8Array): string {
    if (!/^[a-f0-9]{32}$/.test(md5) || createHash("md5").update(data).digest("hex") !== md5) throw invalid("Invalid texture checksum.");
    const id = `tex-${md5}.jpg`, dir = this.dir(project, true), full = this.fileIn(dir, id);
    if (!fs.existsSync(full)) {
      const tmp = path.join(dir, `.tmp-${randomUUID()}`);
      fs.writeFileSync(tmp, data, { flag: "wx" }); fs.renameSync(tmp, full);
    }
    return id;
  }
  resolveTexture(project: string, id: string): string {
    if (!/^tex-[a-f0-9]{32}\.jpg$/.test(id)) throw invalid("Invalid texture asset reference.");
    const full = this.fileIn(this.dir(project, false), id);
    if (!fs.existsSync(full)) throw new DomainError("Texture asset missing.", "ARTIFACT_NOT_FOUND");
    if(fs.realpathSync(full)!==full)throw invalid("Texture symlinks are not allowed.");
    if (createHash("md5").update(fs.readFileSync(full)).digest("hex") !== id.slice(4,36)) throw invalid("Texture checksum mismatch.");
    return full;
  }

  /** Project export directory; guaranteed (after symlink resolution) to be inside the root. */
  private dir(project: string, create: boolean): string {
    const pid = parseProjectId(project);
    const dir = path.join(this.root, pid, "exports");
    if (create) fs.mkdirSync(dir, { recursive: true });
    else if (!fs.existsSync(dir)) return dir;
    const real = fs.realpathSync(dir);
    if (real !== path.join(this.root, pid, "exports") || !real.startsWith(this.root + path.sep)) throw invalid("Export directory escapes the export root.");
    return real;
  }

  private fileIn(dir: string, file: string): string {
    const full = path.resolve(dir, file);
    if (path.dirname(full) !== dir) throw invalid(`Invalid artifact ${JSON.stringify(file)}.`);
    return full;
  }

  save(project: string, kind: ArtifactKind, baseName: string, data: Uint8Array | string): ArtifactInfo {
    const base = parseArtifactBaseName(baseName.toLowerCase().endsWith(EXT[kind]) ? baseName.slice(0, -EXT[kind].length) : baseName);
    const dir = this.dir(project, true);
    const file = base + EXT[kind];
    const full = this.fileIn(dir, file);
    const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
    const tmp = path.join(dir, `.tmp-${randomUUID()}`);
    fs.writeFileSync(tmp, bytes, { flag: "wx" });
    fs.renameSync(tmp, full);                       // atomic replace within the same directory
    return { id: file, project, kind, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: new Date().toISOString() };
  }

  /** Absolute path of an existing artifact of the project (for downloads); validated like save(). */
  resolve(project: string, artifactId: string): { path: string; kind: ArtifactKind } {
    const kind = (Object.keys(EXT) as ArtifactKind[]).find((k) => artifactId.toLowerCase().endsWith(EXT[k]));
    if (!kind) throw invalid(`Unknown artifact type ${JSON.stringify(artifactId.slice(0, 80))}.`);
    parseArtifactBaseName(artifactId.slice(0, -EXT[kind].length));
    const dir = this.dir(project, false);
    const full = this.fileIn(dir, artifactId);
    if (!fs.existsSync(full)) throw new DomainError(`Artifact ${artifactId} not found.`, "ARTIFACT_NOT_FOUND");
    return { path: full, kind };
  }

  list(project: string): Omit<ArtifactInfo, "sha256">[] {
    const dir = this.dir(project, false);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => !f.startsWith(".tmp-")).flatMap((f) => {
      const kind = (Object.keys(EXT) as ArtifactKind[]).find((k) => f.endsWith(EXT[k]));
      if (!kind) return [];
      const st = fs.statSync(path.join(dir, f));
      return [{ id: f, project, kind, bytes: st.size, createdAt: st.mtime.toISOString() }];
    });
  }
}

