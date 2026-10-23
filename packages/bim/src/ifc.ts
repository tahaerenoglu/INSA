/**
 * IFC4 (Reference View-friendly) STEP writer.
 * Walls: local placement along the axis, mitred footprint extrusion, Axis
 * curve, IfcMaterialLayerSetUsage (exterior layer on the exterior side).
 * Openings void their wall; doors/windows fill the opening.
 */
import { DomainError } from "@insa/core";
import { wallRoof } from './wall-roof.js';
import { IFC_CLASS_DATA, IFC_SPATIAL_DATA } from "./ifc-schema-data.js";
import { unitsOf, unitAncestors } from "./spatial-units.js";
import { allHandlers, handlersOf } from "./engines/handlers.js";
import { BimState, Element, Wall, Slab, Column, Beam, Opening, Insert, LayeredType, ProfileType, OpeningType,
         thickness, wallFrame, isLayeredType } from "./model.js";
import type { Component, ComponentType } from "./model.js";
import { componentBox, resolveParameters } from "./family.js";
import { findCategory, categoryIdOfElement } from "./taxonomy.js";
import { memberRepresentation, memberWorldEnds } from "./engines/profile-member.js";
import { sectionBounds } from "./section.js";
import { boundaryRepresentation } from "./engines/boundary.js";
import { hostedRepresentation } from "./engines/hosted.js";
import type { ProfileMember, Boundary, StairElement, PathElement, MepSegment, MepSystem, MepFitting, FittingSection, Reinforcement, RebarType, Assembly } from "./model.js";
import { mepRepresentation, connectorsOf, refKey } from "./mep.js";
type V3 = [number, number, number];
import { memberFrame } from "./engines/profile-member.js";
import { stairRepresentation } from "./engines/stair.js";
import { pathRepresentation } from "./engines/path.js";
import { SpatialContext, resolveSpatialElement } from "./spatial.js";
import type { SpatialElement } from "./model.js";
import { ifcGuid, toLocal, P2, r } from "./geo.js";

type Ref = string;

/** STEP string literal: escapes quotes/backslashes, encodes non-ASCII as \X2\..\X0\ (UTF-16). */
export function stepString(v: string): string {
  let out = "", run = "";
  const flush = () => { if (run) { out += "\\X2\\" + run + "\\X0\\"; run = ""; } };
  for (const ch of v) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code < 127) {
      flush();
      out += ch === "'" ? "''" : ch === "\\" ? "\\\\" : ch;
    } else {
      const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
      for (const u of units) run += u.toString(16).toUpperCase().padStart(4, "0");
    }
  }
  flush();
  return `'${out}'`;
}

export function real(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Non-finite number ${v}`);
  const x = Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e9) / 1e9;
  const s = String(x);
  return /[.eE]/.test(s) ? s : s + ".";
}

class Step {
  lines: string[] = [];
  private n = 0;
  add(entity: string, args: string): Ref {
    this.n++;
    this.lines.push(`#${this.n}=${entity}(${args});`);
    return `#${this.n}`;
  }
}

const list = (xs: string[]) => `(${xs.join(",")})`;
const S = stepString;
const $ = "$";

/** What an engine-owned IFC writer may use (typed; the closures are the single source of the IFC primitives). */
export interface IfcWriteContext {
  readonly s: BimState; readonly schema: "IFC4" | "IFC4X3_ADD2"; readonly projectKey: string; readonly elements: readonly Element[];
  /** product refs by INSA element id: a writer sets the ref of every element it writes */
  readonly elRef: Record<string, string>; readonly zAxis: string; readonly identity: string;
  add(entity: string, args: string): string; gid(key: string): string; str(v: string): string; real(v: number): string; list(xs: string[]): string;
  pt3(x: number, y: number, z: number): string; dir3(x: number, y: number, z: number): string; axis3(loc: string, axis?: string, ref?: string): string; placement(rel: string, ax: string): string;
  extrude(profile: string, pos: string, depth: number, dir?: string): string; product(reps: string[]): string; profile(pr: ProfileType["profile"]): string; bodyShape(type: string, items: string[]): string;
  storeyPlacement(storeyId: string): string; unitPlacement(unitId: string): string; containIn(unitId: string, ref: string): void; contain(el: Element, ref: string): void; markPart(ref: string): void; typed(el: Element, ref: string): void; polygonProfile(pts: [number, number][]): string;
  classFor(categoryId: string): { entity: string; predefined: string };
  /** the schema's attribute template (name, optional) of an IFC class under the file's schema, or null */
  template(ifcClass: string): [string, 0 | 1][] | null;
}
export interface IfcOptions {
  /** false: rooms / spaces are exported without body geometry (e.g. for the 3D viewer, so they never hide the building). Default true. */
  spaceGeometry?: boolean; schema?: "auto" | "IFC4" | "IFC4X3_ADD2"; projectKey: string; author?: string; organization?: string; application?: string; }

/**
 * Category -> IFC semantic class (the only place IFC classes are chosen for physical elements). Geometry never
 * depends on this: it comes from the engine's representation. Unmapped categories export as proxies.
 */
const IFC_ENTITY: Readonly<Record<string, { entity: string; predefined: string }>> = Object.freeze({
  IfcBeam: { entity: "IFCBEAM", predefined: ".BEAM." }, IfcColumn: { entity: "IFCCOLUMN", predefined: ".COLUMN." },
  IfcSlab: { entity: "IFCSLAB", predefined: ".FLOOR." }, IfcCovering: { entity: "IFCCOVERING", predefined: ".CEILING." },
  IfcRoof: { entity: "IFCROOF", predefined: ".NOTDEFINED." }, IfcStair: { entity: "IFCSTAIR", predefined: ".STRAIGHT_RUN_STAIR." },
  IfcRailing: { entity: "IFCRAILING", predefined: ".GUARDRAIL." }, IfcMember: { entity: "IFCMEMBER", predefined: ".NOTDEFINED." },
  IfcPile: { entity: "IFCPILE", predefined: ".NOTDEFINED.,$" },                 // IfcPile has a trailing ConstructionType attribute
  IfcFooting: { entity: "IFCFOOTING", predefined: ".NOTDEFINED." },
  IfcPipeSegment: { entity: "IFCPIPESEGMENT", predefined: ".RIGIDSEGMENT." }, IfcDuctSegment: { entity: "IFCDUCTSEGMENT", predefined: ".RIGIDSEGMENT." },
  IfcCableCarrierSegment: { entity: "IFCCABLECARRIERSEGMENT", predefined: ".NOTDEFINED." }, IfcFurniture: { entity: "IFCFURNITURE", predefined: ".NOTDEFINED." },
  IfcBuildingElementProxy: { entity: "IFCBUILDINGELEMENTPROXY", predefined: ".ELEMENT." },
});
/** Category -> { IFC entity, PredefinedType }: the class AND the predefined type are category data (BRACE, SHEAR, BASESLAB, ...), never the engine's. */
export const ifcClassFor = (categoryId: string) => {
  const c = findCategory(categoryId), dd = c?.ifcClass ? IFC_CLASS_DATA[c.ifcClass] : undefined;
  // a class with the standard 9-attribute product layout (… Tag, PredefinedType) that the table does not list is taken from the schema data, never defaulted to a proxy
  const fromSchema = dd && dd.generic && dd.predefined && dd.attrs.length === 9 ? { entity: c!.ifcClass!.toUpperCase(), predefined: ".NOTDEFINED." }
    : dd && dd.generic && !dd.predefined && dd.attrs.length === 8 ? { entity: c!.ifcClass!.toUpperCase(), predefined: "$NONE$" } : undefined;       // a class WITHOUT a PredefinedType attribute: the writers' trailing value is dropped on output
  const base = IFC_ENTITY[c?.ifcClass ?? ""] ?? fromSchema ?? IFC_ENTITY.IfcBuildingElementProxy;
  return c?.ifcPredefined ? { ...base, predefined: `.${c.ifcPredefined}.${base.predefined.endsWith(",$") ? ",$" : ""}` } : base;
};

/** Layered type kind -> its IFC type entity (a ceiling type is a covering type, a roof type a roof type: never a slab type). */
const LAYERED_TYPE_IFC: Readonly<Record<string, [string, string]>> = Object.freeze({
  wall: ["IFCWALLTYPE", ".STANDARD."], slab: ["IFCSLABTYPE", ".FLOOR."], footing: ["IFCFOOTINGTYPE", ".NOTDEFINED."], foundation_slab: ["IFCSLABTYPE", ".BASESLAB."], ceiling: ["IFCCOVERINGTYPE", ".CEILING."], roof: ["IFCROOFTYPE", ".NOTDEFINED."] });

export function toIfc(s: BimState, opts: IfcOptions): string {
  // schema selection is deliberate: a class that exists only in IFC4.3 is never written under an IFC4 header
  const needs43 = Object.values(s.elements).some((e) => { const c = findCategory(categoryIdOfElement(s, e) ?? ""); const d = c?.ifcClass ? IFC_CLASS_DATA[c.ifcClass] : undefined; return !!d && !d.in_ifc4; });   // ANY element, whatever its engine
  const schema: "IFC4" | "IFC4X3_ADD2" = opts.schema === "IFC4X3_ADD2" ? "IFC4X3_ADD2" : opts.schema === "IFC4" ? "IFC4" : needs43 || Object.keys(s.spatialUnits ?? {}).length > 0 ? "IFC4X3_ADD2" : "IFC4";
  const hasUnits = Object.keys(s.spatialUnits ?? {}).length > 0;                       // IfcFacility / IfcFacilityPart exist only in IFC4.3
  if (schema === "IFC4" && (needs43 || hasUnits)) throw new DomainError("The model holds categories whose IFC class exists only in IFC4.3: export with schema IFC4X3_ADD2 (or auto).", "UNSUPPORTED_IFC_SCHEMA", { schema: "IFC4" });
  const classFor = (id: string) => {            // the IfcPile ConstructionType attribute exists in IFC4 only
    const r = ifcClassFor(id);
    if (schema !== "IFC4" && r.predefined.endsWith(",$")) { const d = IFC_CLASS_DATA[findCategory(id)?.ifcClass ?? ""]; if (d && d.attrs.length < 10) return { ...r, predefined: r.predefined.slice(0, -2) }; }
    return r;
  };
  const st = new Step();
  const gid = (k: string) => S(ifcGuid(`${opts.projectKey}:${k}`));

  // geometry primitives
  const pt3 = (x: number, y: number, z: number) => st.add("IFCCARTESIANPOINT", list([real(x), real(y), real(z)]));
  const pt2 = (x: number, y: number) => st.add("IFCCARTESIANPOINT", list([real(x), real(y)]));
  // last line of defence: the domain rejects degenerate geometry before commit; a zero or non-finite direction must never be written
  const dir3 = (x: number, y: number, z: number) => {
    if (!(Math.hypot(x, y, z) > 1e-12)) throw new Error(`IFC export: invalid direction (${x}, ${y}, ${z})`);
    return st.add("IFCDIRECTION", list([real(x), real(y), real(z)]));
  };
  const origin = pt3(0, 0, 0);
  const zAxis = dir3(0, 0, 1);
  const xAxis = dir3(1, 0, 0);
  const axis3 = (loc: Ref, axis: Ref | string = $, ref: Ref | string = $) => st.add("IFCAXIS2PLACEMENT3D", `${loc},${axis},${ref}`);
  const identity = axis3(origin);
  const placement = (rel: Ref | string, ax: Ref) => st.add("IFCLOCALPLACEMENT", `${rel},${ax}`);
  const polyline2 = (pts: P2[]) => {
    const closed = [...pts, pts[0]];
    return st.add("IFCPOLYLINE", list(closed.map((p) => pt2(p[0], p[1]))));
  };

  // project, units, contexts
  const units = st.add("IFCUNITASSIGNMENT", list([
    st.add("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE."), st.add("IFCSIUNIT", "*,.AREAUNIT.,$,.SQUARE_METRE."),
    st.add("IFCSIUNIT", "*,.VOLUMEUNIT.,$,.CUBIC_METRE."), st.add("IFCSIUNIT", "*,.PLANEANGLEUNIT.,$,.RADIAN.")]));
  const ctx = st.add("IFCGEOMETRICREPRESENTATIONCONTEXT", `$,'Model',3,1.E-05,${identity},$`);
  const sub = (id: string, view: string) => st.add("IFCGEOMETRICREPRESENTATIONSUBCONTEXT", `'${id}','Model',*,*,*,*,${ctx},$,.${view}.,$`);
  const body = sub("Body", "MODEL_VIEW"), axisCtx = sub("Axis", "GRAPH_VIEW"), footCtx = sub("FootPrint", "PLAN_VIEW");
  const shape = (c: Ref, id: string, type: string, items: Ref[]) => st.add("IFCSHAPEREPRESENTATION", `${c},'${id}','${type}',${list(items)}`);
  const product = (reps: Ref[]) => st.add("IFCPRODUCTDEFINITIONSHAPE", `$,$,${list(reps)}`);
  const extrude = (profile: Ref, pos: Ref, depth: number, dir: Ref = zAxis) =>
    st.add("IFCEXTRUDEDAREASOLID", `${profile},${pos},${dir},${real(depth)}`);

  const P = s.project;
  const project = st.add("IFCPROJECT", `${gid("project")},$,${S(P.name)},${P.description ? S(P.description) : $},$,${P.number ? S(P.number) : $},$,(${ctx}),${units}`);
  const sitePl = placement($, identity);
  const site = st.add("IFCSITE", `${gid("site")},$,${S(P.site)},$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$`);
  const bldPl = placement(sitePl, identity);
  const building = st.add("IFCBUILDING", `${gid("building")},$,${S(P.building)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$`);
  st.add("IFCRELAGGREGATES", `${gid("agg:project")},$,$,$,${project},(${site})`);
  st.add("IFCRELAGGREGATES", `${gid("agg:site")},$,$,$,${site},(${building})`);
  // coordinate semantics: the optional map conversion of the local coordinate system (units are metres / radians, declared above)
  if (P.georef) {
    const g = P.georef, opt = (v?: string) => (v ? S(v) : $);
    const crs = st.add("IFCPROJECTEDCRS", `${S(g.crs.name)},${opt(g.crs.description)},${opt(g.crs.geodeticDatum)},${opt(g.crs.verticalDatum)},${opt(g.crs.mapProjection)},${opt(g.crs.mapZone)},${st.add("IFCSIUNIT", "*,.LENGTHUNIT.,$,.METRE.")}`);
    st.add("IFCMAPCONVERSION", `${ctx},${crs},${real(g.eastings)},${real(g.northings)},${real(g.orthogonalHeight)},${real(g.xAxisAbscissa)},${real(g.xAxisOrdinate)},${real(g.scale)}`);
  }
  // infrastructure spatial structure (IFC4.3): facilities under the site, parts under facilities / parts, parents before children
  const unitRef: Record<string, { ref: Ref; pl: Ref }> = {}, unitContained: Record<string, Ref[]> = {};
  {
    const depth = (id: string) => unitAncestors(s, id).length, ordered = unitsOf(s).sort((a, b) => depth(a.id) - depth(b.id) || (a.id < b.id ? -1 : 1)), kids: Record<string, Ref[]> = {};
    for (const u of ordered) {
      const d = IFC_SPATIAL_DATA[u.ifcClass], pl = placement(u.parent ? unitRef[u.parent].pl : sitePl, identity);
      const vals: Record<string, string> = { GlobalId: gid(u.id), Name: S(u.name), ObjectType: u.predefinedType === "USERDEFINED" ? S(u.name) : $, ObjectPlacement: pl, LongName: u.longName ? S(u.longName) : $, CompositionType: `.${u.composition}.`,
        UsageType: u.usage ? `.${u.usage}.` : $, PredefinedType: `.${u.predefinedType ?? "NOTDEFINED"}.` };
      const ref = st.add(u.ifcClass.toUpperCase(), d.attrs.map(([n]) => vals[n] ?? $).join(","));
      unitRef[u.id] = { ref, pl }; (kids[u.parent ?? "site"] ??= []).push(ref);
    }
    for (const [parent, refs] of Object.entries(kids)) st.add("IFCRELAGGREGATES", `${gid("agg:unit:" + parent)},$,$,$,${parent === "site" ? site : unitRef[parent].ref},${list(refs)}`);
  }

  const storeys = Object.values(s.storeys).sort((a, b) => a.elevation - b.elevation);
  const storeyRef: Record<string, { ref: Ref; pl: Ref }> = {};
  for (const sy of storeys) {
    const pl = placement(bldPl, axis3(pt3(0, 0, sy.elevation)));
    const ref = st.add("IFCBUILDINGSTOREY", `${gid(sy.id)},$,${S(sy.name)},$,$,${pl},$,$,.ELEMENT.,${real(sy.elevation)}`);
    storeyRef[sy.id] = { ref, pl };
  }
  if (storeys.length) st.add("IFCRELAGGREGATES", `${gid("agg:building")},$,$,$,${building},${list(storeys.map((x) => storeyRef[x.id].ref))}`);

  // materials & types
  const matRef: Record<string, Ref> = {};
  for (const m of Object.values(s.materials)) matRef[m.id] = st.add("IFCMATERIAL", `${S(m.name)},$,${m.category ? S(m.category) : $}`);
  const layerSet: Record<string, Ref> = {};
  const typeRef: Record<string, Ref> = {};
  const typeMembers: Record<string, Ref[]> = {};
  for (const t of Object.values(s.types)) {
    if (isLayeredType(t)) {
      const lt = t as LayeredType;
      const layers = lt.layers.map((l) => st.add("IFCMATERIALLAYER",
        `${matRef[l.material]},${real(l.thickness)},$,$,$,${S(l.function)},$`));
      layerSet[t.id] = st.add("IFCMATERIALLAYERSET", `${list(layers)},${S(t.name)},$`);
      const [typeEntity, kindPredefined] = LAYERED_TYPE_IFC[t.kind];
      const typePredefined = t.kind === "footing" ? ((t as LayeredType).footingKind === "strip" ? ".STRIP_FOOTING." : ".PAD_FOOTING.") : kindPredefined;
      typeRef[t.id] = st.add(typeEntity, `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,${typePredefined}`);
      st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + t.id)},$,$,$,(${typeRef[t.id]}),${layerSet[t.id]}`);
    } else if (t.kind === "stair" || t.kind === "railing") {
      // a stair type used ONLY by stair flights is an IfcStairFlightType (its occurrences are IfcStairFlight)
      const flightOnly = t.kind === "stair" && (() => { const u = Object.values(s.elements).filter((e) => "type" in e && e.type === t.id); return u.length > 0 && u.every((e) => findCategory((e as { category?: string }).category ?? "")?.ifcClass === "IfcStairFlight"); })();
      typeRef[t.id] = st.add(t.kind === "stair" ? (flightOnly ? "IFCSTAIRFLIGHTTYPE" : "IFCSTAIRTYPE") : "IFCRAILINGTYPE", `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,${t.kind === "stair" ? (flightOnly ? ".STRAIGHT." : ".STRAIGHT_RUN_STAIR.") : ".GUARDRAIL."}`);
      const m = (t as { material?: string }).material;
      if (m) st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + t.id)},$,$,$,(${typeRef[t.id]}),${matRef[m]}`);
    } else if (t.kind === "curtain_wall") {
      typeRef[t.id] = st.add("IFCCURTAINWALLTYPE", `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,.NOTDEFINED.`);
      const m = (t as { material?: string }).material;
      if (m) st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + t.id)},$,$,$,(${typeRef[t.id]}),${matRef[m]}`);
    } else if (t.kind === "ramp") {
      typeRef[t.id] = st.add("IFCRAMPFLIGHTTYPE", `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,.STRAIGHT.`);
      const m = (t as { material?: string }).material;
      if (m) st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + t.id)},$,$,$,(${typeRef[t.id]}),${matRef[m]}`);
    } else if (t.kind === 'rebar') {
      typeRef[t.id] = st.add('IFCREINFORCINGBARTYPE', `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,.NOTDEFINED.,${real(t.diameter)},${real(Math.PI*t.diameter*t.diameter/4)},$,$,$,$`);
    } else if (t.kind === "column" || t.kind === "beam") {
      const pt = t as ProfileType;
      typeRef[t.id] = st.add(t.kind === "column" ? "IFCCOLUMNTYPE" : "IFCBEAMTYPE",
        `${gid(t.id)},$,${S(t.name)},$,$,$,$,$,$,.${t.kind.toUpperCase()}.`);
      if (pt.material) st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + t.id)},$,$,$,(${typeRef[t.id]}),${matRef[pt.material]}`);
    }
  }

  // elements
  for(const t of Object.values(s.types)) if("finishMaterial" in t && t.finishMaterial && typeRef[t.id])
    st.add("IFCRELASSOCIATESMATERIAL",`${gid("finish:"+t.id)},$,${S("Surface finish")},$,(${typeRef[t.id]}),${matRef[t.finishMaterial]}`);
  const contained: Record<string, Ref[]> = {};
  const elRef: Record<string, Ref> = {};
  const elPl: Record<string, Ref> = {};
  const contain = (el: Element, ref: Ref) => (contained[el.storey] ??= []).push(ref);
  const typed = (el: Element, ref: Ref) => { if ("type" in el && typeRef[el.type]) (typeMembers[el.type] ??= []).push(ref); };
  const usage = (el: Element, ref: Ref, dirn: string, sense: string, off: number) => {
    if (!("type" in el) || !layerSet[el.type]) return;
    const u = st.add("IFCMATERIALLAYERSETUSAGE", `${layerSet[el.type]},.${dirn}.,.${sense}.,${real(off)},$`);
    st.add("IFCRELASSOCIATESMATERIAL", `${gid("usage:" + el.id)},$,$,$,(${ref}),${u}`);
  };

  const elements = Object.values(s.elements);
  // One volume owner at structural interfaces: columns > beams > walls/slabs.
  // All cutters are expressed in the target product's local coordinates.
  const members = elements.filter((e): e is ProfileMember => e.kind === "profile_member"
    && (e.category === "structure.column" || e.category === "structure.framing"));
  const boundaries=elements.filter((e):e is Boundary=>e.kind==='boundary');
  // One owner per occupied volume, also at roof facets and decorative strips.
  // Broad-phase boxes only select cutters: IFC performs the actual solid difference,
  // including holes and inclined planes. Identity, source axes and gross quantities stay intact.
  const boundaryRank=(b:Boundary)=>[b.category==='architecture.ceiling'?0:b.category==='architecture.roof'?1:2,thickness(s.types[b.type] as LayeredType),b.id] as const;
  const owns=(a:Boundary,b:Boundary)=>{const A=boundaryRank(a),B=boundaryRank(b);return A[0]!==B[0]?A[0]<B[0]:A[1]!==B[1]?A[1]<B[1]:A[2]<B[2];};
  const boundaryBoxes=new Map(boundaries.map(b=>{
    const rep=boundaryRepresentation(s,b),elevation=s.storeys[b.storey].elevation;
    const points:V3[]=[];
    for(const p of rep.outer){
      if(rep.kind==='boundary_extrusion')points.push([p[0],p[1],elevation+rep.bottom],[p[0],p[1],elevation+rep.top]);
      else{const z=rep.eaveOffset+(p[0]*rep.riseDir[0]+p[1]*rep.riseDir[1]-rep.eaveLine)*rep.tan;
        const n:V3=[-rep.riseDir[0]*rep.sin,-rep.riseDir[1]*rep.sin,rep.cos],sign=rep.direction==='above'?1:-1;
        points.push([p[0],p[1],elevation+z],[p[0]+n[0]*rep.thickness*sign,p[1]+n[1]*rep.thickness*sign,elevation+z+n[2]*rep.thickness*sign]);}
    }
    return [b.id,{min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as V3}] as const;
  }));
  function boundarySolid(el:Boundary,origin:P2=[0,0],direction:P2=[1,0],worldZ=s.storeys[el.storey].elevation){
    const rep=boundaryRepresentation(s,el),elevation=s.storeys[el.storey].elevation;
    const point=(x:number,y:number,z:number)=>{const p=toLocal([x,y],origin,direction);return pt3(p[0],p[1],elevation+z-worldZ);};
    const vector=(v:V3)=>dir3(v[0]*direction[0]+v[1]*direction[1],-v[0]*direction[1]+v[1]*direction[0],v[2]);
    let prof:Ref,pos:Ref;
    if(rep.kind==='boundary_extrusion'){
      const outer=polyline2(rep.outer);prof=rep.holes.length?st.add('IFCARBITRARYPROFILEDEFWITHVOIDS',`.AREA.,$,${outer},${list(rep.holes.map(h=>polyline2(h)))}`):st.add('IFCARBITRARYCLOSEDPROFILEDEF',`.AREA.,$,${outer}`);
      pos=axis3(point(0,0,rep.bottom),vector([0,0,1]),vector([1,0,0]));
    }else{
      const[u0,u1]=rep.riseDir,c=rep.cos,sn=rep.sin,q:P2=[rep.eaveLine*u0,rep.eaveLine*u1];
      const loc=(p:P2):P2=>[r(p[0]*u1-p[1]*u0,9),r((p[0]*u0+p[1]*u1-rep.eaveLine)/c,9)];
      const outer=polyline2(rep.outer.map(loc));prof=rep.holes.length?st.add('IFCARBITRARYPROFILEDEFWITHVOIDS',`.AREA.,$,${outer},${list(rep.holes.map(h=>polyline2(h.map(loc))))}`):st.add('IFCARBITRARYCLOSEDPROFILEDEF',`.AREA.,$,${outer}`);
      const n:V3=[-u0*sn,-u1*sn,c],below=rep.direction==='above'?0:rep.thickness;
      pos=axis3(point(q[0]-n[0]*below,q[1]-n[1]*below,rep.eaveOffset-n[2]*below),vector(n),vector([u1,-u0,0]));
    }
    return extrude(prof,pos,rep.thickness);
  }
  function cutBoundaries(solid:Ref,min:V3,max:V3,origin:P2,direction:P2,worldZ:number,owner?:Boundary){
    let cut=false;
    for(const b of boundaries){if(owner&&(!owns(b,owner)||b.id===owner.id))continue;const box=boundaryBoxes.get(b.id)!;
      if(min.some((v,i)=>Math.min(max[i],box.max[i])-Math.max(v,box.min[i])<=1e-7))continue;
      solid=st.add('IFCBOOLEANRESULT',`.DIFFERENCE.,${solid},${boundarySolid(b,origin,direction,worldZ)}`);cut=true;
    }
    return{solid,cut};
  }
  function cutMembers(solid: Ref, storey: string, candidates: ProfileMember[],
    min: V3, max: V3, origin: P2 = [0, 0], direction: P2 = [1, 0], offset = 0) {
    let cut = false;
    const elevation = s.storeys[storey].elevation;
    for (const member of candidates) {
      const rep = memberRepresentation(s, member), ends = memberWorldEnds(s, member);
      const bounds = sectionBounds(rep.profile), radius = Math.hypot(bounds.w, bounds.h) / 2;
      const low = ends.start.map((v, i) => Math.min(v, ends.end[i]) - radius);
      const high = ends.start.map((v, i) => Math.max(v, ends.end[i]) + radius);
      if (min.some((v, i) => high[i] <= v + 1e-8 || low[i] >= max[i] - 1e-8)) continue;
      const at = toLocal([rep.origin[0], rep.origin[1]], origin, direction);
      const rotate = (v: V3): V3 => [v[0] * direction[0] + v[1] * direction[1], -v[0] * direction[1] + v[1] * direction[0], v[2]];
      const axis = rotate(rep.axisDir), ref = rotate(rep.refDir);
      const z = s.storeys[member.storey].elevation + rep.origin[2] - elevation - offset;
      const position = axis3(pt3(at[0], at[1], z), dir3(...axis), dir3(...ref));
      const cutter = extrude(profileDef(rep.profile, rep.profileCenter), position, rep.length);
      solid = st.add("IFCBOOLEANRESULT", `.DIFFERENCE.,${solid},${cutter}`);
      cut = true;
    }
    return { solid, cut };
  }
  for (const el of elements.filter((e): e is Wall => e.kind === "wall")) {
    const f = wallFrame(s, el);
    const pl = placement(storeyRef[el.storey].pl, axis3(pt3(el.start[0], el.start[1], el.baseOffset), zAxis, dir3(f.dir[0], f.dir[1], 0)));
    const local = f.footprint.map((p) => toLocal(p, el.start, f.dir));
    const roofTop = wallRoof(s, el);
    let solid = extrude(st.add("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${polyline2(local)}`), identity, roofTop?.maxHeight ?? el.height);
    let hasColumnCuts = false;
    if (roofTop) {
      const roof = roofTop.roof, slope = roof.slope;
      const pitch = (slope?.pitch ?? 0) * Math.PI / 180, az = (slope?.azimuth ?? 0) * Math.PI / 180;
      const nx = -Math.sin(pitch) * Math.cos(az), ny = -Math.sin(pitch) * Math.sin(az), nz = Math.cos(pitch);
      const normal = dir3(nx * f.dir[0] + ny * f.dir[1], -nx * f.dir[1] + ny * f.dir[0], nz);
      const plane = st.add('IFCPLANE', axis3(pt3(0, 0, roofTop.start - el.baseOffset), normal));
      const half = st.add('IFCHALFSPACESOLID', `${plane},.F.`);
      solid = st.add('IFCBOOLEANCLIPPINGRESULT', `.DIFFERENCE.,${solid},${half}`);
      hasColumnCuts = true;
    }
    // Structural columns own their occupied volume; trim the wall body rather
    // than moving either axis or breaking its opening/topology relationships.
    const wallBottom = s.storeys[el.storey].elevation + el.baseOffset;
    const xs = f.footprint.map(p => p[0]), ys = f.footprint.map(p => p[1]);
    for (const column of elements) {
      if (column.kind !== "profile_member" || column.category !== "structure.column" || column.placement !== "member_vertical") continue;
      const rep = memberRepresentation(s, column);
      const ends = memberWorldEnds(s, column);
      const bottom = Math.min(ends.start[2], ends.end[2]), top = Math.max(ends.start[2], ends.end[2]);
      if (top <= wallBottom || bottom >= wallBottom + el.height) continue;
      const bounds = sectionBounds(rep.profile);
      const radius = Math.hypot(bounds.w, bounds.h) / 2;
      if (column.at[0] + radius < Math.min(...xs) || column.at[0] - radius > Math.max(...xs)
        || column.at[1] + radius < Math.min(...ys) || column.at[1] - radius > Math.max(...ys)) continue;
      const at = toLocal(column.at, el.start, f.dir);
      const angle = column.rotation * Math.PI / 180 - Math.atan2(f.dir[1], f.dir[0]);
      const pos = axis3(pt3(at[0], at[1], bottom - wallBottom), zAxis, dir3(Math.cos(angle), Math.sin(angle), 0));
      const cutter = extrude(profileDef(rep.profile, [0, 0]), pos, top - bottom);
      solid = st.add("IFCBOOLEANRESULT", `.DIFFERENCE.,${solid},${cutter}`);
      hasColumnCuts = true;
    }
    const beamCuts = cutMembers(solid, el.storey, members.filter(m => m.category === "structure.framing"),
      [Math.min(...xs), Math.min(...ys), wallBottom], [Math.max(...xs), Math.max(...ys), wallBottom + el.height], el.start, f.dir, el.baseOffset);
    solid = beamCuts.solid;
    hasColumnCuts ||= beamCuts.cut;
    const surfaceCuts=cutBoundaries(solid,[Math.min(...xs),Math.min(...ys),wallBottom],[Math.max(...xs),Math.max(...ys),wallBottom+el.height],el.start,f.dir,wallBottom);
    solid=surfaceCuts.solid;hasColumnCuts ||=surfaceCuts.cut;
    const axisCurve = st.add("IFCPOLYLINE", list([pt2(0, 0), pt2(f.length, 0)]));
    const ref = st.add(el.category && findCategory(el.category)?.ifcClass === "IfcWallStandardCase" ? "IFCWALLSTANDARDCASE" : "IFCWALL", `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${pl},${product([
      shape(body, "Body", hasColumnCuts ? "CSG" : "SweptSolid", [solid]), shape(axisCtx, "Axis", "Curve2D", [axisCurve])])},${S(el.id)},${el.category ? `.${findCategory(el.category)?.ifcPredefined ?? "STANDARD"}.` : ".STANDARD."}`);
    elRef[el.id] = ref; elPl[el.id] = pl;
    contain(el, ref); typed(el, ref);
    // reference line = wall axis; exterior layer first on the exterior side
    if (el.exterior === "left") usage(el, ref, "AXIS2", "NEGATIVE", f.t / 2);
    else usage(el, ref, "AXIS2", "POSITIVE", -f.t / 2);
  }

  // boundary engine (floors, ceilings, roofs): geometry from the boundary representation; the IFC class from the category
  for (const el of elements.filter((e): e is Boundary => e.kind === "boundary")) {
    const rep = boundaryRepresentation(s, el);
    const cls = classFor(el.category);
    let solid = boundarySolid(el);
    const elevation = s.storeys[el.storey].elevation;
    const bx = rep.outer.map(p => p[0]), by = rep.outer.map(p => p[1]);
    const bottom = rep.kind === "boundary_extrusion" ? rep.bottom : Math.min(...rep.outer.map(p => rep.eaveOffset + (p[0] * rep.riseDir[0] + p[1] * rep.riseDir[1] - rep.eaveLine) * rep.tan)) - rep.thickness;
    const top = rep.kind === "boundary_extrusion" ? rep.top : Math.max(...rep.outer.map(p => rep.eaveOffset + (p[0] * rep.riseDir[0] + p[1] * rep.riseDir[1] - rep.eaveLine) * rep.tan)) + rep.thickness;
    const joined = cutMembers(solid, el.storey, members, [Math.min(...bx), Math.min(...by), elevation + bottom], [Math.max(...bx), Math.max(...by), elevation + top]);
    solid = joined.solid;
    const box=boundaryBoxes.get(el.id)!;
    const surfaceCuts=cutBoundaries(solid,box.min,box.max,[0,0],[1,0],elevation,el);solid=surfaceCuts.solid;
    const pl = placement(storeyRef[el.storey].pl, identity);
    const predefined = cls.entity === "IFCROOF" ? (el.slope ? ".SHED_ROOF." : ".FLAT_ROOF.")
      : cls.entity === "IFCFOOTING" ? ((s.types[el.type] as LayeredType).footingKind === "strip" ? ".STRIP_FOOTING." : ".PAD_FOOTING.") : cls.predefined;
    const ref = st.add(cls.entity, `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${pl},${product([shape(body, "Body", joined.cut || surfaceCuts.cut ? "CSG" : "SweptSolid", [solid])])},${S(el.id)},${predefined}`);
    elRef[el.id] = ref;
    contain(el, ref); typed(el, ref);
    // the layer-set usage is defined along the product's own Z: only meaningful for horizontal boundaries
    if (rep.kind === "boundary_extrusion") usage(el, ref, "AXIS3", rep.direction === "above" ? "POSITIVE" : "NEGATIVE", el.offset);
  }

  // stair engine: the stepped solid of the run (vertical profile of the walking line, extruded across the width); class from the category
  for (const el of elements.filter((e): e is StairElement => e.kind === "stair")) {
    const rep = stairRepresentation(s, el), [dx, dy] = rep.direction, w = rep.width;
    const prof = st.add("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${polyline2(rep.profile)}`);
    // X along the run, Z across (to the right), hence Y up: the profile is the (s, z) section; the solid starts at the left edge
    const pos = axis3(pt3(rep.origin[0] - dy * (w / 2), rep.origin[1] + dx * (w / 2), rep.baseZ), dir3(dy, -dx, 0), dir3(dx, dy, 0));
    const cls = classFor(el.category), cat = findCategory(el.category), schemaAttrs = cat?.ifcClass ? IFC_CLASS_DATA[cat.ifcClass] : undefined, tpl = schemaAttrs ? (schema === "IFC4" ? schemaAttrs.attrs4 : schemaAttrs.attrs) : null;
    const rep3 = product([shape(body, "Body", "SweptSolid", [extrude(prof, pos, w)])]);
    // a class with attributes beyond the standard product ones (IfcStairFlight: NumberOfRisers, NumberOfTreads, RiserHeight, TreadLength) is written from the schema template
    const ref = tpl && tpl.length > 9 ? st.add(cat!.ifcClass!.toUpperCase(), tpl.map(([n]) => ({ GlobalId: gid(el.id), Name: S(el.name ?? el.id), ObjectPlacement: placement(storeyRef[el.storey].pl, identity), Representation: rep3, Tag: S(el.id),
        NumberOfRisers: String(el.riserCount), NumberOfTreads: String(el.riserCount - 1), RiserHeight: real(rep.riserHeight), TreadLength: real(rep.treadDepth), PredefinedType: `.${cat!.ifcPredefined ?? "NOTDEFINED"}.` } as Record<string, string>)[n] ?? "$").join(","))
      : st.add(cls.entity, `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${placement(storeyRef[el.storey].pl, identity)},${rep3},${S(el.id)},${cls.predefined}`);
    elRef[el.id] = ref;
    contain(el, ref); typed(el, ref);
  }

  // path engine: top rail along every segment + the derived posts (railings); class from the category
  for (const el of elements.filter((e): e is PathElement => e.kind === "path")) {
    const rep = pathRepresentation(s, el), solids: Ref[] = [];
    const rect = (xd: number, yd: number) => st.add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D", `${pt2(0, 0)},$`)},${real(xd)},${real(yd)}`);
    const railProf = rect(rep.topRail.depth, rep.topRail.width);                                  // X vertical (depth), Y across (width)
    for (const [a, b] of rep.segments) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / l, dy = (b[1] - a[1]) / l;
      solids.push(extrude(railProf, axis3(pt3(a[0], a[1], rep.baseZ + rep.height - rep.topRail.depth / 2), dir3(dx, dy, 0), dir3(0, 0, 1)), l));
    }
    const postLen = rep.height - rep.topRail.depth, postProf = rect(rep.post.size, rep.post.size);
    if (postLen > 0) for (const p of rep.posts) solids.push(extrude(postProf, axis3(pt3(p[0], p[1], rep.baseZ)), postLen));
    const cls = classFor(el.category);
    const ref = st.add(cls.entity, `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${placement(storeyRef[el.storey].pl, identity)},${product([shape(body, "Body", "SweptSolid", solids)])},${S(el.id)},${cls.predefined}`);
    elRef[el.id] = ref;
    contain(el, ref); typed(el, ref);
  }

  function profileDef(pr: ProfileType["profile"], center: [number, number] = [0, 0]) {
    const pos = st.add("IFCAXIS2PLACEMENT2D", `${pt2(center[0], center[1])},$`);
    switch (pr.shape) {                                                      // hollow sections stay HOLLOW; the I-section is a true I profile
      case "rect": return st.add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${pos},${real(pr.b)},${real(pr.h)}`);
      case "circle": return st.add("IFCCIRCLEPROFILEDEF", `.AREA.,$,${pos},${real(pr.d / 2)}`);
      case "rhs": return st.add("IFCRECTANGLEHOLLOWPROFILEDEF", `.AREA.,$,${pos},${real(pr.b)},${real(pr.h)},${real(pr.t)},$,$`);
      case "chs": return st.add("IFCCIRCLEHOLLOWPROFILEDEF", `.AREA.,$,${pos},${real(pr.d / 2)},${real(pr.t)}`);
      case "i_section": return st.add("IFCISHAPEPROFILEDEF", `.AREA.,$,${pos},${real(pr.b)},${real(pr.h)},${real(pr.tw)},${real(pr.tf)},$,$,$`);
    }
  };

  // profile_member engine: ONE writer for beams, columns and any member category. Geometry = the member's
  // profile sweep (representation); IFC class = the category's semantic class (proxy when it has none).
  for (const el of elements.filter((e): e is ProfileMember => e.kind === "profile_member")) {
    const rep = memberRepresentation(s, el);
    // ONE placement for every member category: origin, sweep axis and section X direction come from the representation
    const pos = axis3(pt3(rep.origin[0], rep.origin[1], rep.origin[2]), dir3(rep.axisDir[0], rep.axisDir[1], rep.axisDir[2]), dir3(rep.refDir[0], rep.refDir[1], rep.refDir[2]));
    let solid = extrude(profileDef(rep.profile, rep.profileCenter), pos, rep.length);
    const ends = memberWorldEnds(s, el), bounds = sectionBounds(rep.profile), radius = Math.hypot(bounds.w, bounds.h) / 2;
    const candidates = el.category === "structure.framing" ? members.filter(m => m.category === "structure.column"
      || (m.category === "structure.framing" && m.id.localeCompare(el.id) < 0)) : [];
    const joined = cutMembers(solid, el.storey, candidates,
      ends.start.map((v, i) => Math.min(v, ends.end[i]) - radius) as V3,
      ends.start.map((v, i) => Math.max(v, ends.end[i]) + radius) as V3);
    solid = joined.solid;
    const cls = classFor(el.category);
    const ref = st.add(cls.entity, `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${placement(storeyRef[el.storey].pl, identity)},${product([shape(body, "Body", joined.cut ? "CSG" : "SweptSolid", [solid])])},${S(el.id)},${cls.predefined}`);
    elRef[el.id] = ref;
    contain(el, ref); typed(el, ref);
  }

  for (const op of elements.filter((e): e is Opening => e.kind === "opening")) {
    const w = s.elements[op.host] as Wall;
    const t = wallFrame(s, w).t;
    const pl = placement(elPl[w.id], axis3(pt3(op.along, 0, op.sill)));
    const prof = st.add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D", `${pt2(0, 0)},$`)},${real(op.width)},${real(t + 0.1)}`);
    const solid = extrude(prof, identity, op.height);
    const ref = st.add("IFCOPENINGELEMENT", `${gid(op.id)},$,${S(op.id)},$,$,${pl},${product([shape(body, "Body", "SweptSolid", [solid])])},$,.OPENING.`);
    elRef[op.id] = ref; elPl[op.id] = pl;
    st.add("IFCRELVOIDSELEMENT", `${gid("void:" + op.id)},$,$,$,${elRef[w.id]},${ref}`);
  }

  // hosted_component engine: geometry from the hosted representation; IfcDoor / IfcWindow are the categories'
  // semantic classes (their attribute lists differ, so the IFC writer — not the engine — knows them).
  for (const ins of elements.filter((e): e is Insert => e.kind === "hosted_component")) {
    const op = s.elements[ins.opening] as Opening;
    const t = s.types[ins.type] as OpeningType;
    const hr = hostedRepresentation(s, ins);
    const pl = placement(elPl[op.id], identity);
    const prof = st.add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D", `${pt2(0, 0)},$`)},${real(hr.width)},${real(hr.depth)}`);
    const solid = extrude(prof, identity, hr.height);
    let solids=[solid];
    if(t.kind === "window" && t.windowFrame){
      const f=t.windowFrame,W=t.width,H=t.height,fw=f.width,depth=f.depth;
      const styled=(item:Ref,glass:boolean)=>{
        const color=st.add("IFCCOLOURRGB",glass?"$,0.75,0.90,0.93":"$,0.72,0.74,0.76");
        const rendering=st.add("IFCSURFACESTYLERENDERING",`${color},${glass?'0.78':'0.'},$,$,$,$,$,$,.NOTDEFINED.`);
        const style=st.add("IFCSURFACESTYLE",`$,.BOTH.,(${rendering})`);
        st.add("IFCSTYLEDITEM",`${item},(${style}),$`);return item;
      };
      const hollow=()=>st.add("IFCRECTANGLEHOLLOWPROFILEDEF",`.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D",`${pt2(0,0)},$`)},${real(fw)},${real(depth)},0.003,$,$`);
      solids=[
        ...[-1,1].map(side=>styled(extrude(hollow(),axis3(pt3(side*(W-fw)/2,0,fw)),H-2*fw),false)),
        ...[fw/2,H-fw/2].map(z=>styled(extrude(hollow(),axis3(pt3(-W/2,0,z),dir3(1,0,0),dir3(0,0,1)),W),false)),
        ...(f.sashCount===2?[styled(extrude(hollow(),axis3(pt3(0,0,fw)),H-2*fw),false)]:[]),
        ...Array.from({length:f.sashCount??1},(_,index)=>[-1,1].map(side=>{
          const count=f.sashCount??1,paneWidth=(W-(count+1)*fw)/count,cx=count===1?0:(index===0?-1:1)*(paneWidth+fw)/2;
          const pane=st.add("IFCRECTANGLEPROFILEDEF",`.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D",`${pt2(0,0)},$`)},${real(paneWidth)},0.004`);
          return styled(extrude(pane,axis3(pt3(cx,side*(f.glassThickness/2-.002),fw)),H-2*fw),true);
        })).flat()
      ];
    }
    const rep = product([shape(body, "Body", "SweptSolid", solids)]);
    const ref = findCategory(ins.category)?.ifcClass === "IfcDoor"
      ? st.add("IFCDOOR", `${gid(ins.id)},$,${S(ins.name ?? t.name)},$,${S(t.name)},${pl},${rep},${S(ins.id)},${real(t.height)},${real(t.width)},.DOOR.,.SINGLE_SWING_LEFT.,$`)
      : st.add("IFCWINDOW", `${gid(ins.id)},$,${S(ins.name ?? t.name)},$,${S(t.name)},${pl},${rep},${S(ins.id)},${real(t.height)},${real(t.width)},.WINDOW.,${t.windowFrame?.sashCount===2?".DOUBLE_PANEL_VERTICAL.":".SINGLE_PANEL."},$`);
    elRef[ins.id] = ref;
    contain(ins, ref);
    st.add("IFCRELFILLSELEMENT", `${gid("fill:" + ins.id)},$,$,$,${elRef[op.id]},${ref}`);
  }

  // generic components (Phase 7): one writer for every component category. IfcFurniture where the category says
  // so (a safe, simple IFC4 entity); every other category -> IfcBuildingElementProxy, with the class hint kept as a property.
  const componentPsets: Record<string, Record<string, Record<string, string | number | boolean>>> = {};
  for (const el of elements.filter((e): e is Component => e.kind === "component")) {
    const t = s.types[el.type] as ComponentType, f = s.families[t.family], c = findCategory(f.category);
    const box = componentBox(s, el);
    const a = (el.placement.rotation * Math.PI) / 180;
    const pl = placement(storeyRef[el.storey].pl, axis3(pt3(el.placement.x, el.placement.y, el.placement.offset), zAxis, dir3(Math.cos(a), Math.sin(a), 0)));
    const prof = st.add("IFCRECTANGLEPROFILEDEF", `.AREA.,$,${st.add("IFCAXIS2PLACEMENT2D", `${pt2(0, 0)},$`)},${real(box.width)},${real(box.depth)}`);
    const solid = extrude(prof, identity, box.height);
    const rep = product([shape(body, "Body", "SweptSolid", [solid])]);
    const furniture = c?.ifcClass === "IfcFurniture";
    // a schema-derived class: the attribute list comes from the official schema (per IFC version); PredefinedType from the type (validated); the rest $
    const data = c?.ifcClass && !furniture && c.ifcClass !== "IfcBuildingElementProxy" ? IFC_CLASS_DATA[c.ifcClass] : undefined, tpl = data && data.generic ? (schema === "IFC4" ? data.attrs4 : data.attrs) : null;
    const native = !!tpl;
    const vals: Record<string, string> = { GlobalId: gid(el.id), Name: S(el.name ?? t.name), ObjectType: S(`${f.name}:${t.name}`), ObjectPlacement: pl, Representation: rep, Tag: S(el.id), PredefinedType: `.${t.predefinedType ?? "NOTDEFINED"}.` };
    const ref = native ? st.add(c!.ifcClass!.toUpperCase(), tpl!.map(([n]) => vals[n] ?? "$").join(","))
      : st.add(furniture ? "IFCFURNITURE" : "IFCBUILDINGELEMENTPROXY",
      `${gid(el.id)},$,${S(el.name ?? t.name)},$,${S(`${f.name}:${t.name}`)},${pl},${rep},${S(el.id)},${furniture ? ".NOTDEFINED." : ".ELEMENT."}`);
    elRef[el.id] = ref;
    contain(el, ref);
    componentPsets[el.id] = {
      INSA_Component: { Category: f.category, Discipline: c?.discipline ?? "", Family: f.name, FamilyId: f.id, Type: t.name, TypeId: t.id,
                        ...(c?.ifcClass && !furniture && !native ? { IfcClassHint: c.ifcClass } : {}) },
      INSA_Parameters: { ...resolveParameters(f.parameters, "type", t.parameters), ...resolveParameters(f.parameters, "instance", el.parameters) },
    };
  }

  // mep_network engine (Phase 13): ONE writer for pipes, ducts, cable trays and conduits. The class AND the predefined type come from the category;
  // geometry = one deterministic swept solid per route segment inside ONE product representation (no fitting products).
  for (const el of elements.filter((e): e is MepSegment => e.kind === "mep_segment")) {
    const rep = mepRepresentation(s, el), sec = rep.section;
    const solids = rep.segments.map((g) => {
      const f = memberFrame(g.direction, 0);
      const pos = axis3(pt3(g.start[0], g.start[1], g.start[2]), dir3(f.axis[0], f.axis[1], f.axis[2]), dir3(f.ref[0], f.ref[1], f.ref[2]));
      return extrude(profileDef(sec.shape === "round" ? { shape: "circle", d: sec.diameter! } : { shape: "rect", b: sec.width!, h: sec.height! }), pos, g.length);
    });
    const cls = classFor(el.category);
    const ref = st.add(cls.entity, `${gid(el.id)},$,${S(el.name ?? el.id)},$,$,${placement(storeyRef[el.storey].pl, identity)},${product([shape(body, "Body", "SweptSolid", solids)])},${S(el.id)},${cls.predefined}`);
    elRef[el.id] = ref;
    contain(el, ref);
  }
  // Engine-owned writers (Phase 14): every engine that DECLARES `ifc.mode === "writer"` writes its own products through this context. Product writers run
  // first; relationship-phase writers (assemblies) after, because they aggregate products that must already exist.
  const partRefs = new Set<string>();
  const wctx: IfcWriteContext = {
    s, schema, projectKey: opts.projectKey, elements, elRef, zAxis, identity,
    add: (e, a) => st.add(e, a), gid, str: S, real, list, pt3, dir3, axis3, placement, extrude, product, profile: profileDef, bodyShape: (t, items) => shape(body, "Body", t, items),
    storeyPlacement: (id) => storeyRef[id].pl, unitPlacement: (id) => unitRef[id].pl, containIn: (unitId, ref) => { (unitContained[unitId] ??= []).push(ref); }, contain, typed, polygonProfile: (pts) => st.add("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${polyline2(pts)}`), markPart: (r) => { partRefs.add(r); }, classFor, template: (cls) => { const d = IFC_CLASS_DATA[cls]; return d ? (schema === "IFC4" ? d.attrs4 : d.attrs) : null; },
  };
  for (const phase of ["product", "relationship"] as const)
    for (const h of allHandlers()) if (h.ifc.mode === "writer" && (h.ifc.phase ?? "product") === phase) h.ifc.write(wctx, elements.filter((e) => e.kind === h.kind));
  for (const k of Object.keys(contained)) contained[k] = contained[k].filter((r) => !partRefs.has(r));    // parts of an aggregation are not separately contained
  // distribution systems (resources, not elements): IfcDistributionSystem + IfcRelAssignsToGroup for the route products. The stable classification
  // string maps to IfcDistributionSystemEnum when it names one, else USERDEFINED with ObjectType = the classification (the identity survives export).
  const SYSTEM_ENUM = new Set(["AIRCONDITIONING", "CHILLEDWATER", "COMPRESSEDAIR", "CONDENSERWATER", "DATA", "DOMESTICCOLDWATER", "DOMESTICHOTWATER", "DRAINAGE", "ELECTRICAL", "EXHAUST", "FIREPROTECTION", "FUEL", "GAS", "HEATING", "LIGHTING", "RAINWATER", "REFRIGERATION", "SEWAGE", "STORMWATER", "TELEPHONE", "VACUUM", "VENT", "VENTILATION", "WASTEWATER", "WATERSUPPLY"]);
  const systemEnum = (sys: MepSystem) => { const n = sys.classification.toUpperCase().replace(/[^A-Z]/g, ""); return SYSTEM_ENUM.has(n) ? `.${n}.` : ".USERDEFINED."; };
  for (const sys of Object.values(s.mepSystems ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ref = st.add("IFCDISTRIBUTIONSYSTEM", `${gid(sys.id)},$,${S(sys.name)},${sys.description ? S(sys.description) : "$"},${S(sys.classification)},$,${systemEnum(sys)}`);
    const members = elements.filter((e): e is MepSegment => (e.kind === "mep_segment" || e.kind === "mep_fitting") && e.system === sys.id).sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => elRef[e.id]).filter(Boolean);
    if (members.length) st.add("IFCRELASSIGNSTOGROUP", `${gid("assign:" + sys.id)},$,$,$,${list(members)},$,${ref}`);
  }
  // connectors -> IfcDistributionPort nested in their owner (routes AND components with connector definitions); a junction -> IfcRelConnectsPorts
  // between consecutive members (IFC4 allows one connection per port in each direction, so a tee is exported as a chain of port connections).
  const portRef: Record<string, Ref> = {};
  for (const el of elements) {
    const cs = connectorsOf(s, el);
    if (!cs.length || !elRef[el.id]) continue;
    const z0 = s.storeys[el.storey]?.elevation ?? 0, refs: Ref[] = [];
    for (const c of cs) {
      const f = memberFrame(c.direction, 0);
      const ax = axis3(pt3(c.position[0], c.position[1], c.position[2] - z0), dir3(f.axis[0], f.axis[1], f.axis[2]), dir3(f.ref[0], f.ref[1], f.ref[2]));
      const flow = c.flow === "in" ? ".SINK." : c.flow === "out" ? ".SOURCE." : ".SOURCEANDSINK.";
      const kind = c.domain === "piping" ? ".PIPE." : c.domain === "hvac" ? ".DUCT." : ".CABLECARRIER.";
      const port = st.add("IFCDISTRIBUTIONPORT", `${gid(`port:${el.id}#${c.ref.connector}`)},$,${S(c.ref.connector)},$,$,${placement(storeyRef[el.storey].pl, ax)},$,${flow},${kind},${c.system && s.mepSystems[c.system] ? systemEnum(s.mepSystems[c.system]) : "$"}`);
      portRef[refKey(c.ref)] = port; refs.push(port);
    }
    st.add("IFCRELNESTS", `${gid("nests:" + el.id)},$,$,$,${elRef[el.id]},${list(refs)}`);
  }
  for (const j of Object.values(s.mepJunctions ?? {}).sort((a, b) => (a.id < b.id ? -1 : 1)))
    for (let k = 0; k + 1 < j.members.length; k++) {
      const a = portRef[refKey(j.members[k])], b = portRef[refKey(j.members[k + 1])];
      if (a && b) st.add("IFCRELCONNECTSPORTS", `${gid(`connect:${j.id}:${k}`)},$,${S(j.id)},$,${a},${b},$`);
    }
  // spatial elements (Phase 8): IfcSpace aggregated by its storey; body = the DERIVED region (same resolver as queries)
  // extruded by the resolved height; unbounded -> semantic IfcSpace without geometry (nothing is invented).
  const sctx = new SpatialContext(s);
  const spacesOf: Record<string, Ref[]> = {};
  const spatialPsets: Record<string, Record<string, Record<string, string | number | boolean>>> = {};
  const ring = (pts: P2[]) => st.add("IFCPOLYLINE", list([...pts, pts[0]].map((p) => pt2(p[0], p[1]))));
  for (const el of elements.filter((e): e is SpatialElement => e.kind === "spatial").sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const res = resolveSpatialElement(sctx, el);
    const c = findCategory(el.category);
    const pl = placement(storeyRef[el.storey].pl, identity);
    let rep = "$";
    if (res.status === "bounded" && opts.spaceGeometry !== false) {
      const g = res.region!;
      const prof = g.holes.length
        ? st.add("IFCARBITRARYPROFILEDEFWITHVOIDS", `.AREA.,$,${ring(g.outer)},${list(g.holes.map(ring))}`)
        : st.add("IFCARBITRARYCLOSEDPROFILEDEF", `.AREA.,$,${ring(g.outer)}`);
      rep = product([shape(body, "Body", "SweptSolid", [extrude(prof, identity, el.height)])]);
    }
    const ref = st.add("IFCSPACE", `${gid(el.id)},$,${S(el.number ?? el.id)},$,${S(c?.name ?? el.category)},${pl},${rep},${el.name ? S(el.name) : "$"},.ELEMENT.,.SPACE.,$`);
    elRef[el.id] = ref;
    (spacesOf[el.storey] ??= []).push(ref);
    spatialPsets[el.id] = { INSA_Spatial: { Category: el.category, Status: res.status, BoundaryLocation: res.boundaryLocation, Height: res.height,
      ...(el.number ? { Number: el.number } : {}),
      ...(res.status === "bounded" ? { Area: res.area!, Perimeter: res.perimeter!, OuterPerimeter: res.outerPerimeter!, Volume: res.volume!, RegionSignature: res.regionSignature! } : {}) } };
  }
  for (const [sid, refs] of Object.entries(spacesOf).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    st.add("IFCRELAGGREGATES", `${gid("spaces:" + sid)},$,$,$,${storeyRef[sid].ref},${list(refs)}`);

  // grids (IFC needs at least one U and one V axis)
  const grids = Object.values(s.grids);
  const isU = (g: typeof grids[number]) => Math.abs(g.end[0] - g.start[0]) >= Math.abs(g.end[1] - g.start[1]);
  const U = grids.filter(isU), V = grids.filter((g) => !isU(g));
  if (U.length && V.length && storeys.length) {
    const curveRefs: Ref[] = [];
    const axis = (g: typeof grids[number]) => {
      const c = st.add("IFCPOLYLINE", list([pt2(g.start[0], g.start[1]), pt2(g.end[0], g.end[1])]));
      curveRefs.push(c);
      return st.add("IFCGRIDAXIS", `${S(g.name)},${c},.T.`);
    };
    const ua = U.map(axis), va = V.map(axis);
    const curves = st.add("IFCGEOMETRICCURVESET", list(curveRefs));
    const g0 = storeys[0];
    const ref = st.add("IFCGRID", `${gid("grid")},$,'Grid',$,$,${placement(storeyRef[g0.id].pl, identity)},${product([shape(footCtx, "FootPrint", "GeometricCurveSet", [curves])])},${list(ua)},${list(va)},$,.RECTANGULAR.`);
    (contained[g0.id] ??= []).push(ref);
  }

  // relations
  for (const [sid, refs] of Object.entries(contained))
    st.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", `${gid("contain:" + sid)},$,$,$,${list(refs)},${storeyRef[sid].ref}`);
  for (const [uid, refs] of Object.entries(unitContained))                      // infrastructure products live in a facility / facility part, never in a storey
    st.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", `${gid("contain:" + uid)},$,$,$,${list(refs)},${unitRef[uid].ref}`);
  for (const el of elements) {
    if (el.kind !== "hosted_component" || !elRef[el.id]) continue;
    const t = s.types[el.type] as OpeningType;
    if (t.material && matRef[t.material]) st.add("IFCRELASSOCIATESMATERIAL", `${gid("mat:" + el.id)},$,$,$,(${elRef[el.id]}),${matRef[t.material]}`);
  }
  for (const [tid, refs] of Object.entries(typeMembers))
    st.add("IFCRELDEFINESBYTYPE", `${gid("type:" + tid)},$,$,$,${list(refs)},${typeRef[tid]}`);

  // property sets (+ INSA identity for round trips)
  const value = (v: string | number | boolean) =>
    typeof v === "boolean" ? `IFCBOOLEAN(${v ? ".T." : ".F."})` : typeof v === "number" ? `IFCREAL(${real(v)})` : `IFCLABEL(${S(v)})`;
  for (const el of elements) {
    if (!elRef[el.id]) continue;
    const psets = { INSA_Identity: { Id: el.id }, ...(componentPsets[el.id] ?? {}), ...(spatialPsets[el.id] ?? {}), ...(el.props ?? {}) };   // parameters and general properties stay separate sets
    for (const [name, vals] of Object.entries(psets)) {
      const props = Object.entries(vals).map(([k, v]) => st.add("IFCPROPERTYSINGLEVALUE", `${S(k)},$,${value(v)},$`));
      if (!props.length) continue;
      const ps = st.add("IFCPROPERTYSET", `${gid(`pset:${el.id}:${name}`)},$,${S(name)},$,${list(props)}`);
      st.add("IFCRELDEFINESBYPROPERTIES", `${gid(`rel:${el.id}:${name}`)},$,$,$,(${elRef[el.id]}),${ps}`);
    }
  }

  // enforced export contract: an element whose engine declares an IFC product must HAVE one (checked once EVERY writer has run)
  for (const e of elements) { const h = handlersOf(e); if (h.ifc.mode !== "none" && !elRef[e.id]) throw new DomainError(`IFC export: ${e.id} (${e.kind}) has no product although its engine declares IFC export.`, "IFC_ELEMENT_NOT_EXPORTED", { elementId: e.id }); }
  const stamp = new Date().toISOString().slice(0, 19);
  const header = [
    "ISO-10303-21;", "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${S(P.name + ".ifc")},'${stamp}',(${S(opts.author ?? "")}),(${S(opts.organization ?? "")}),'INSA BIM kernel','${opts.application ?? "INSA Platform"}','');`,
    `FILE_SCHEMA(('${schema}'));`, "ENDSEC;", "DATA;",
  ];
  return [...header, ...st.lines.map((l) => l.replace(",$NONE$)", ")")), "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
