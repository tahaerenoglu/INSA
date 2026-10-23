/**
 * IFC4 export of tunnels: one IfcBuildingElementProxy per station range and
 * layer (optionally also the excavation solid), IfcTriangulatedFaceSet bodies
 * in local engineering coordinates, georeferenced with IfcMapConversion; the
 * alignment as a 3D IfcAnnotation polyline.
 */
import { createHash } from "node:crypto";
import { Alignment3D, point3d, sampleStations, kmLabel } from "./alignment.js";
import { meshVolume, Mesh } from "./sweep.js";
import type { RangeGeometry } from "./tunnel.js";

const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
export function ifcGuid(seed: string): string {
  let n = 0n;
  for (const b of createHash("md5").update(seed).digest()) n = (n << 8n) | BigInt(b);
  let out = "";
  for (let i = 0; i < 22; i++) out += B64[Number((n >> BigInt(128 - (i === 0 ? 2 : 2 + 6 * i))) & ((1n << BigInt(i === 0 ? 2 : 6)) - 1n))];
  return out;
}
function S(v: string) {
  let o = "", run = "";
  const flush = () => { if (run) { o += "\\X2\\" + run + "\\X0\\"; run = ""; } };
  for (const ch of v) {
    const c = ch.codePointAt(0)!;
    if (c >= 32 && c < 127) { flush(); o += ch === "'" ? "''" : ch === "\\" ? "\\\\" : ch; }
    else run += c.toString(16).toUpperCase().padStart(4, "0");
  }
  flush();
  return `'${o}'`;
}
const R = (v: number) => { const x = Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e6) / 1e6; const s = String(x); return /[.eE]/.test(s) ? s : s + "."; };

export interface InfraIfcInput {
  materials?:Record<string,{id:string;name:string}>;
  projectKey: string; projectName: string;
  origin: [number, number, number];
  crs?: string;                                   // e.g. "EPSG:5254"
  alignments: { id: string; name: string; a: Alignment3D }[];
  /** geometry: export meshes; volumes: precise (authoritative) volumes per range index and layer name / "Excavation" */
  tunnels: { id: string; name: string; geometry: RangeGeometry[]; volumes?: Record<string, number>[] }[];
  includeExcavation?: boolean;
}

export function infraIfc(inp: InfraIfcInput): string {
  const lines: string[] = [];
  let n = 0;
  const add = (e: string, args: string) => { lines.push(`#${++n}=${e}(${args});`); return `#${n}`; };
  const g = (k: string) => S(ifcGuid(`${inp.projectKey}:infra:${k}`));
  const pt3 = (x: number, y: number, z: number) => add("IFCCARTESIANPOINT", `(${R(x)},${R(y)},${R(z)})`);
  const id3 = add("IFCAXIS2PLACEMENT3D", `${pt3(0, 0, 0)},$,$`);
  const ctx = add("IFCGEOMETRICREPRESENTATIONCONTEXT", `$,'Model',3,1.E-05,${id3},$`);
  const units = add("IFCUNITASSIGNMENT", `(${add("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.")},${add("IFCSIUNIT", "*,.AREAUNIT.,$,.SQUARE_METRE.")},${add("IFCSIUNIT", "*,.VOLUMEUNIT.,$,.CUBIC_METRE.")},${add("IFCSIUNIT", "*,.PLANEANGLEUNIT.,$,.RADIAN.")})`);
  const project = add("IFCPROJECT", `${g("project")},$,${S(inp.projectName)},$,$,$,$,(${ctx}),${units}`);
  if (inp.crs) {
    const crs = add("IFCPROJECTEDCRS", `${S(inp.crs)},$,$,$,$,$,$`);
    add("IFCMAPCONVERSION", `${ctx},${crs},${R(inp.origin[0])},${R(inp.origin[1])},${R(inp.origin[2])},1.,0.,1.`);
  }
  const sitePl = add("IFCLOCALPLACEMENT", `$,${id3}`);
  const site = add("IFCSITE", `${g("site")},$,${S(inp.projectName)},$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$`);
  add("IFCRELAGGREGATES", `${g("agg")},$,$,$,${project},(${site})`);
  const contained: string[] = [];
  const materialRefs=new Map<string,string>();
  const val = (v: string | number) => (typeof v === "number" ? `IFCREAL(${R(v)})` : `IFCLABEL(${S(v)})`);
  const pset = (owner: string, key: string, name: string, props: Record<string, string | number>) => {
    const ps = add("IFCPROPERTYSET", `${g(`pset:${key}:${name}`)},$,${S(name)},$,(${Object.entries(props).map(([k, v]) => add("IFCPROPERTYSINGLEVALUE", `${S(k)},$,${val(v)},$`)).join(",")})`);
    add("IFCRELDEFINESBYPROPERTIES", `${g(`rel:${key}:${name}`)},$,$,$,(${owner}),${ps}`);
  };
  const tess = (m: Mesh) => {
    const P = m.positions, coords: string[] = [];
    for (let i = 0; i < P.length; i += 3) coords.push(`(${R(P[i])},${R(P[i + 1])},${R(P[i + 2])})`);
    const tri: string[] = [];
    for (let t = 0; t < m.indices.length; t += 3) tri.push(`(${m.indices[t] + 1},${m.indices[t + 1] + 1},${m.indices[t + 2] + 1})`);
    const list = add("IFCCARTESIANPOINTLIST3D", `(${coords.join(",")})`);
    return add("IFCTRIANGULATEDFACESET", `${list},$,.T.,(${tri.join(",")}),$`);
  };
  const proxy = (key: string, name: string, type: string, mesh: Mesh, props: Record<string, string | number>, precise?: number) => {
    const rep = add("IFCSHAPEREPRESENTATION", `${ctx},'Body','Tessellation',(${tess(mesh)})`);
    const el = add("IFCBUILDINGELEMENTPROXY", `${g(key)},$,${S(name)},$,${S(type)},${add("IFCLOCALPLACEMENT", `${sitePl},${id3}`)},${add("IFCPRODUCTDEFINITIONSHAPE", `$,$,(${rep})`)},$,.USERDEFINED.`);
    contained.push(el);
    // Volume: precise quantity (authoritative). GeometryVolume: volume of the tessellated solid in this file.
    const gv = meshVolume(mesh);
    pset(el, key, "INSA_Infra", { ...props, Volume: precise ?? gv, GeometryVolume: gv });
    return el;
  };
  for (const al of inp.alignments) {
    const s0 = al.a.h[0].s0, s1 = s0 + al.a.h.reduce((x, e) => x + e.length, 0);
    const pts = sampleStations(al.a, s0, s1, 0.01, 20).map((s) => { const p = point3d(al.a, s); return pt3(p.x - inp.origin[0], p.y - inp.origin[1], p.z - inp.origin[2]); });
    const rep = add("IFCSHAPEREPRESENTATION", `${ctx},'Axis','Curve3D',(${add("IFCPOLYLINE", `(${pts.join(",")})`)})`);
    const an = add("IFCANNOTATION", `${g("al:" + al.id)},$,${S(al.name)},$,'Alignment',${add("IFCLOCALPLACEMENT", `${sitePl},${id3}`)},${add("IFCPRODUCTDEFINITIONSHAPE", `$,$,(${rep})`)}`);
    contained.push(an);
    pset(an, "al:" + al.id, "INSA_Alignment", { Id: al.id, StartStation: kmLabel(s0), EndStation: kmLabel(s1), Length: s1 - s0 });
  }
  for (const t of inp.tunnels) t.geometry.forEach((rg, i) => {
    const base = { Tunnel: t.name, TunnelId: t.id, From: kmLabel(rg.range.from), To: kmLabel(rg.range.to), Length: rg.range.to - rg.range.from, SectionType: rg.section.name };
    const vol = t.volumes?.[i] ?? {};
    rg.layers.forEach((l,li) => {
      const id=rg.section.layers[li].materialId,material=id?inp.materials?.[id]:undefined;
      const el=proxy(`${t.id}:${i}:${l.name}`, `${t.name} ${kmLabel(rg.range.from)}–${kmLabel(rg.range.to)} ${l.name}`, l.name, l.mesh, { ...base, Layer: l.name, Material: material?.name??l.material??'',MaterialId:id??'' }, vol[l.name]);
      if(material){let ref=materialRefs.get(material.id);if(!ref){ref=add('IFCMATERIAL',`${S(material.name)},$,$`);materialRefs.set(material.id,ref);}add('IFCRELASSOCIATESMATERIAL',`${g(`mat:${t.id}:${i}:${li}`)},$,$,$,(${el}),${ref}`);}
    });
    if (inp.includeExcavation) proxy(`${t.id}:${i}:excavation`, `${t.name} ${kmLabel(rg.range.from)}–${kmLabel(rg.range.to)} kazı`, "Excavation", rg.excavation, { ...base, Layer: "Excavation" }, vol["Excavation"]);
  });
  if (contained.length) add("IFCRELCONTAINEDINSPATIALSTRUCTURE", `${g("contain")},$,$,$,(${contained.join(",")}),${site}`);
  return ["ISO-10303-21;", "HEADER;", "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${S(inp.projectName + " infra.ifc")},'${new Date().toISOString().slice(0, 19)}',(''),(''),'INSA infra kernel','INSA Platform','');`,
    "FILE_SCHEMA(('IFC4'));", "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
