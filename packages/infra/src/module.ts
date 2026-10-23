import {familyTools,validateFamilies,type InfrastructureFamily,type FamilyInstance} from './families.js';
import {setProfileReference,validateProfileReference,type ProfileReference} from './profile-reference.js';
import {civilNavigationTools,type CivilNavigation} from './civil-navigation.js';
import type {CadAlignmentReview} from './cad-inspection.js';
import {align3d} from './alignment-resource.js';
import {verticalConversionInput,prepareVerticalConversion,applyVerticalConversion,verticalLineageStatus,type VerticalLineage} from './cad-vertical.js';
import {cadConversionInput,prepareCadConversion,convertedAlignment,cadLineageStatus,type CadLineage} from './cad-conversion.js';
import {parseDxf} from './cad-source.js';
import {cadTools} from './cad-tools.js';
import type {CadDrawing,CadRegion} from './cad-source.js';
/** Infra module: alignments, tunnel section types and tunnels as platform tools. */
import { z } from "zod";
import { DomainError, parseArtifactBaseName, safeBaseName,canonicalJson } from "@insa/core";
import type { ModuleDef, CommandTool, QueryTool, Decision, DomainEvent } from "@insa/core";
import { Alignment3D, PI, PVI, buildHorizontal, checkVertical, point3d, kmLabel, hLength, GeometryError,evalH,validateHorizontalElements,type HElement,hasVerticalAt,verticalCoverage } from "./alignment.js";
import { SectionType, boundaries, layerId } from "./section.js";
import { randomUUID } from 'node:crypto';
import { Range, tunnelGeometry, tunnelQuantities, localOrigin, EXPORT_TOL } from "./tunnel.js";
import { planSvg, profileSvg, sectionSvg, threeDSvg, toPng } from "./render.js";
import { infraIfc } from "./ifc.js";
import { meshVolume } from "./sweep.js";
import {roadGeometry,validateRoad,type RoadCorridor} from './road.js';
import {roadTools} from './road-tools.js';
import {componentTypeTools,projectComponentTypes,type ComponentType} from './component-types.js';
import {terrainTools} from './terrain-tools.js';
import {earthworksTools} from './earthworks-tools.js';
import {validateEarthworks,type EarthworksDesign,type EarthworkZone} from './earthworks.js';
import type {TerrainResource} from './terrain.js';

export interface AlignmentDef { id: string; name: string; start_station: number; points: PI[]; pvis: PVI[]; elements?:HElement[]; cadSource?:CadLineage; verticalSource?:VerticalLineage; }
export interface TunnelDef { id: string; name: string; alignment: string; ranges: Range[]; parentTunnel?: string; }
export interface InfraState {
  families?:Record<string,InfrastructureFamily>;
  familyInstances?:Record<string,FamilyInstance>;
  componentTypes?:Record<string,ComponentType>;
  civilNavigation?:CivilNavigation;
  profileReferences?:Record<string,ProfileReference>;
  cadAlignmentReviews?:Record<string,CadAlignmentReview>;
  cadDrawings?:Record<string,CadDrawing>;
  cadRegions?:Record<string,CadRegion>;
  earthworks?:Record<string,EarthworksDesign>;
  earthworkZones?:Record<string,EarthworkZone>;
  roads?:Record<string,RoadCorridor>;
  terrains?:Record<string,TerrainResource>;
  alignments: Record<string, AlignmentDef>;
  sections: Record<string, SectionType>;
  tunnels: Record<string, TunnelDef>;
  counters: Record<string, number>;
  crs?: string;
}

const initialState = (): InfraState => ({ alignments: {}, sections: {}, tunnels: {}, counters: {} });
const next = (s: InfraState, p: string) => { s.counters[p] = (s.counters[p] ?? 0) + 1; return `${p}-${String(s.counters[p]).padStart(3, "0")}`; };

function apply(s: InfraState, e: DomainEvent): InfraState {
  const p = e.payload;
  switch (e.type) {
    case 'InfrastructureFamilySet': (s.families??={})[p.id]=structuredClone(p);break;
    case 'FamilyInstanceSet': (s.familyInstances??={})[p.id]=structuredClone(p);break;
    case "ComponentTypeSet": (s.componentTypes??={})[p.id]=p;projectComponentTypes(s);break;
    case "CadAlignmentReviewSet": (s.cadAlignmentReviews??={})[p.id]=p;break;
    case "CadDrawingSet": (s.cadDrawings??={})[p.id]=p;break;
    case "CadRegionSet": (s.cadRegions??={})[p.id]=p;break;
    case "ProfileReferenceSet": (s.profileReferences??={})[p.id]=p;break;
    case "CivilNavigationSet": s.civilNavigation=p;break;
    case "AlignmentSet": s.alignments[p.id] = p; break;
    case "SectionTypeSet": s.sections[p.id] = p; break;
    case "TunnelSet": s.tunnels[p.id] = p; break;
    case "EarthworksSet": (s.earthworks??={})[p.id]=p;break;
    case "EarthworkZoneSet": (s.earthworkZones??={})[p.id]=p;break;
    case "TerrainSet": (s.terrains??={})[p.id]=p;break;
    case "RoadCorridorSet": (s.roads??={})[p.id]=structuredClone(p);projectComponentTypes(s);break;
    case "Deleted": delete s.families?.[p.id];delete s.familyInstances?.[p.id];delete s.profileReferences?.[p.id];delete s.earthworks?.[p.id];delete s.earthworkZones?.[p.id];delete s.alignments[p.id]; delete s.sections[p.id]; delete s.tunnels[p.id];delete s.roads?.[p.id];delete s.terrains?.[p.id]; break;
    case "CountersSet": Object.assign(s.counters, p); break;
    case "SettingsSet": Object.assign(s, p); break;
  }
  return s;
}

// --------------------------------------------------------------- geometry helpers (wrap geometry errors as domain errors)
const geo = <T>(f: () => T): T => { try { return f(); } catch (e) { if (e instanceof GeometryError) throw new DomainError(e.message); throw e; } };
export {align3d} from './alignment-resource.js';
function stationRange(d: AlignmentDef) { const a = align3d(d); return [a.h[0].s0, a.h[0].s0 + hLength(a.h)] as const; }

function validate(s: InfraState,before?:InfraState) {
 validateFamilies(s);
 for(const r of Object.values(s.profileReferences??{}))validateProfileReference(s,r);
 for(const r of Object.values(s.cadAlignmentReviews??{}))if(!s.cadDrawings?.[r.drawing])throw new DomainError("CAD alignment review source missing.","INVALID_REFERENCE");
 for(const r of Object.values(s.cadRegions??{}))if(!s.cadDrawings?.[r.drawing])throw new DomainError("CAD region source missing.","INVALID_REFERENCE");
  for(const d of Object.values(s.earthworks??{})){const r=s.roads?.[d.road];if(!r||!s.terrains?.[d.terrain])throw new DomainError('Earthworks source road/terrain is missing or in use.','INVALID_REFERENCE');validateEarthworks(d,r);}
  for(const z of Object.values(s.earthworkZones??{}))if(!s.earthworks?.[z.design])throw new DomainError('Construction zone parent design is missing or in use.','INVALID_REFERENCE');
  const geometricRoad=(road:RoadCorridor|undefined)=>road?canonicalJson({...road,layers:road.layers.map(l=>({...l,materialId:undefined}))}):'';
  const roads=Object.values(s.roads??{});for(let i=0;i<roads.length;i++)for(let j=i+1;j<roads.length;j++)if(roads[i].alignment===roads[j].alignment&&Math.max(roads[i].from,roads[j].from)<Math.min(roads[i].to,roads[j].to)-1e-8)throw new DomainError('Road station ranges overlap on the same alignment.','INVALID_GEOMETRY');
  for(const road of Object.values(s.roads??{})){
    const alignment=s.alignments[road.alignment];if(!alignment)throw new DomainError(`${road.id}: alignment ${road.alignment} is in use or missing.`,'INVALID_REFERENCE');
    if(road.parentTunnel){const parent=s.tunnels[road.parentTunnel];if(!parent||parent.alignment!==road.alignment||!parent.ranges.some(r=>road.from>=r.from-1e-6&&road.to<=r.to+1e-6))throw new DomainError(`${road.id}: parent tunnel is missing or does not contain its station range.`,'INVALID_REFERENCE');}
    const a=align3d(alignment);if(!verticalCoverage(a).complete)throw new DomainError("Horizontal-only or partial alignment: reviewed vertical profile coverage is required for road modeling.");geo(()=>validateRoad(road,a));
    if(geometricRoad(road)!==geometricRoad(before?.roads?.[road.id])||canonicalJson(alignment)!==canonicalJson(before?.alignments[road.alignment]??null))geo(()=>roadGeometry(road,a,localOrigin(a)));
  }
  for (const d of Object.values(s.alignments)) {
    const a = align3d(d);
    if(!d.pvis.length&&d.elements)continue;
    geo(() => checkVertical(d.pvis));
    const [s0, s1] = [a.h[0].s0, a.h[0].s0 + hLength(a.h)];
    if (!d.verticalSource&&(d.pvis[0].station > s0 + 1e-6 || d.pvis[d.pvis.length - 1].station < s1 - 1e-6))
      throw new DomainError(`${d.id}: the vertical profile (${kmLabel(d.pvis[0].station)}–${kmLabel(d.pvis[d.pvis.length - 1].station)}) must cover the alignment (${kmLabel(s0)}–${kmLabel(s1)}).`);
  }
  for (const t of Object.values(s.sections)) {
    geo(() => boundaries(t, 0.01));
    const ids=t.layers.map((_,i)=>layerId(t,i));
    if(new Set(ids).size!==ids.length)throw new DomainError(`${t.id}: duplicate layer id.`);
  }
  for (const t of Object.values(s.tunnels)) {
    const al = s.alignments[t.alignment];
    if (!al) throw new DomainError(`${t.id}: alignment ${t.alignment} does not exist.`);
    if(t.parentTunnel){const parent=s.tunnels[t.parentTunnel];if(!parent||parent.id===t.id||parent.parentTunnel||parent.alignment!==t.alignment||t.ranges.some(r=>!parent.ranges.some(p=>r.from>=p.from-1e-6&&r.to<=p.to+1e-6)))throw new DomainError(`${t.id}: parent tunnel is missing or does not contain its station range.`,'INVALID_REFERENCE');}
    if(!verticalCoverage(align3d(al)).complete)throw new DomainError("Horizontal-only alignment: a reviewed vertical profile with complete coverage is required for tunnel modeling.");
    const [s0, s1] = stationRange(al);
    const rs = [...t.ranges].sort((a, b) => a.from - b.from);
    rs.forEach((r, i) => {
      if (!s.sections[r.section]) throw new DomainError(`${t.id}: section type ${r.section} does not exist.`);
      if (r.to <= r.from) throw new DomainError(`${t.id}: range ${kmLabel(r.from)}–${kmLabel(r.to)} is empty.`);
      if (r.from < s0 - 1e-6 || r.to > s1 + 1e-6) throw new DomainError(`${t.id}: range ${kmLabel(r.from)}–${kmLabel(r.to)} is outside the alignment (${kmLabel(s0)}–${kmLabel(s1)}).`);
      if (i && r.from < rs[i - 1].to - 1e-6) throw new DomainError(`${t.id}: ranges ${kmLabel(rs[i - 1].from)}–${kmLabel(rs[i - 1].to)} and ${kmLabel(r.from)}–${kmLabel(r.to)} overlap.`);
    });
  }
}

// --------------------------------------------------------------- inputs
export function parseStation(v: number | string): number {
  if (typeof v === "number") return v;
  v=v.trim().replace(/^km\s*/i, "");
  if (!v) throw new DomainError("Station cannot be empty.");
  const m = /^\s*(\d+)\s*\+\s*(\d+(?:[.,]\d+)?)\s*$/.exec(v);
  if (m) return Number(m[1]) * 1000 + Number(m[2].replace(",", "."));
  const n = Number(v.replace(",", "."));
  if (Number.isFinite(n)) return n;
  throw new DomainError(`Station '${v}' is not valid (use metres or 'km+m' like '2+340.50').`);
}
const Station = z.union([z.number(), z.string()]).describe("metres or 'km+m', e.g. '2+340.50'");
const byRef = <T extends { id: string; name: string }>(rec: Record<string, T>, ref: string, what: string): T => {
  if (rec[ref]) return rec[ref];
  const hit = Object.values(rec).find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!hit) throw new DomainError(`${what} '${ref}' not found. Available: ${Object.values(rec).map((x) => `${x.id} ${x.name}`).join("; ") || "none"}`);
  return hit;
};
const ProfileSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("circle"), radius: z.number().positive().describe("clear (inner) radius, m"), center_y: z.number().describe("centre height above the alignment level, m"), center_x:z.number().finite().min(-70).max(70).optional().describe("signed right offset of tube centre from alignment, m; omitted = zero") }),
  z.object({ shape: z.literal("horseshoe"), crown_radius: z.number().positive().describe("clear crown radius, m"), spring_y: z.number().describe("springline (crown centre) height above the alignment level"),
             wall_bottom_y: z.number().describe("height of the sidewall bottoms"), invert_depth: z.number().min(0).describe("depth of the invert arc below the wall bottoms (0 = flat)") }),
  z.object({ shape: z.literal("polygon"), points: z.array(z.tuple([z.number(), z.number()])).min(3).describe("clear line [x right, y up] looking forward") }),
]);

// --------------------------------------------------------------- tools
const cmd = <I>(t: Omit<CommandTool<InfraState, I>, "kind" | "module" | "effect"> & { effect?: "write" | "destructive" }): CommandTool<InfraState, I> =>
  ({ kind: "command", module: "infra", effect: t.effect ?? "write", ...t });
const qry = <I>(t: Omit<QueryTool<InfraState, I>, "kind" | "module" | "effect">): QueryTool<InfraState, I> =>
  ({ kind: "query", module: "infra", effect: "read", ...t });

const AlignmentInput = {
  horizontal: z.array(z.object({ x: z.number(), y: z.number(), radius: z.number().positive().optional(), spiral: z.number().min(0).optional() })).min(2)
    .describe("PIs [x east, y north]; first/last are start/end. radius (m) and spiral = clothoid length (m) at interior PIs"),
  vertical: z.array(z.object({ station: Station, z: z.number(), curve: z.number().min(0).optional() })).min(2)
    .describe("PVIs; curve = parabolic vertical curve length (m)"),
};

const exactElements=z.array(z.object({id:z.string().optional(),kind:z.enum(['line','arc','clothoid']),s0:z.number().finite(),length:z.number().positive(),start:z.tuple([z.number().finite(),z.number().finite()]),az0:z.number().finite(),k0:z.number().finite(),k1:z.number().finite(),pi:z.number().int().optional()})).min(1).max(2000);
const createAlignment = cmd({
  name: "infra_create_alignment", title: "Create alignment", permission: "infra.write",
  description: "Create a canonical alignment: legacy 3D PIs/PVIs or {cad} from infra_query_cad conversion preview with explicit direction, current approval/source/georeference hashes. CAD creates exact horizontal elements and no vertical profile. Create a 3D alignment from horizontal PIs (radius + clothoid length per PI), or validated exact line/arc/clothoid elements, and vertical PVIs (parabolic curves). Coordinates in the project CRS (e.g. ITRF96 / 3° TM).",
  input:z.object({name:z.string().trim().min(1).max(120),start_station:Station.default(0),horizontal:AlignmentInput.horizontal.optional(),elements:exactElements.optional(),vertical:AlignmentInput.vertical.optional(),cad:cadConversionInput.optional()}).superRefine((i,ctx)=>{if(i.cad?(i.horizontal!==undefined||i.vertical!==undefined||i.elements!==undefined):(!i.vertical||Boolean(i.horizontal)===Boolean(i.elements)))ctx.addIssue({code:'custom',message:'Provide cad conversion, or vertical PVIs with exactly one of horizontal PIs or exact elements.'});}),
  decide: (s, i,ctx) => {
    if(i.cad){const c=i.cad,drawing=s.cadDrawings?.[c.drawing];if(!drawing)throw new DomainError("CAD source not found in this project.");const p=prepareCadConversion(s,parseDxf(ctx.platform.requireArtifacts().readCadSource(ctx.project,drawing.asset)),c);if(!c.previewHash||c.previewHash!==p.previewHash)throw new DomainError("CAD_PREVIEW_STALE: a matching read-only preview is required.");const d=convertedAlignment(next(s,"AL"),i.name,s,p);return {events:[{type:"AlignmentSet",payload:d},{type:"CountersSet",payload:{...s.counters}}],summary:{id:d.id,length_m:p.totalLength_m,segments:d.elements!.length,verticalStatus:"unresolved",sourceIdentity:p.identity}};}
    const d: AlignmentDef = { id: next(s, "AL"), name: i.name, start_station: parseStation(i.start_station), points: i.horizontal??[], ...(i.elements?{elements:i.elements}:{}),
      pvis: i.vertical!.map((p) => ({ station: parseStation(p.station), z: p.z, curve: p.curve })) };
    const a = align3d(d);
    return { events: [{ type: "AlignmentSet", payload: d }, { type: "CountersSet", payload: { ...s.counters } }],
             summary: { id: d.id, start: kmLabel(a.h[0].s0), end: kmLabel(a.h[0].s0 + hLength(a.h)), length_m: +hLength(a.h).toFixed(3),
                        elements: a.h.map((e) => e.kind).join(", ") } };
  },
});


const updateAlignment = cmd({
  name: "infra_update_alignment", title: "Update alignment", permission: "infra.write",
  description: "Replace the horizontal and/or vertical definition of an alignment (tunnels on it follow automatically).",
  input: z.object({ alignment: z.string(), name: z.string().optional(), start_station: Station.optional(),
                    cadVertical:verticalConversionInput.optional(),elements:exactElements.optional(),horizontal: AlignmentInput.horizontal.optional(), vertical: AlignmentInput.vertical.optional() }),
  decide: (s, i,ctx) => {
    const old = byRef(s.alignments, i.alignment, "Alignment");
    if(i.cadVertical){if(i.horizontal||i.elements||i.vertical||i.start_station!==undefined||i.name!==undefined)throw new DomainError('CAD vertical conversion cannot change horizontal geometry or combine manual edits.');const c=i.cadVertical;if(c.alignment!==old.id)throw new DomainError('CAD vertical target mismatch.');const drawing=s.cadDrawings?.[c.drawing];if(!drawing)throw new DomainError('CAD vertical source missing in this project.');const p=prepareVerticalConversion(s,parseDxf(ctx.platform.requireArtifacts().readCadSource(ctx.project,drawing.asset)),c);if(!c.previewHash||c.previewHash!==p.previewHash)throw new DomainError('CAD_VERTICAL_PREVIEW_STALE: prepare the read-only preview again.');const d=applyVerticalConversion(s,p);return {events:[{type:'AlignmentSet',payload:d}],summary:{id:d.id,verticalStatus:p.coverage,pvis:d.pvis.length,validRange:p.validRange,horizontalUnchanged:true,verticalIdentity:p.identity}};}

    if(i.elements&&i.horizontal)throw new DomainError("Use exact elements or horizontal PIs, not both.");
    if(old.elements&&i.start_station!==undefined&&!i.elements&&!i.horizontal)throw new DomainError("Exact element station edits require the explicitly restationed element array.");
    const d: AlignmentDef = { ...old, name: i.name ?? old.name, start_station: i.start_station !== undefined ? parseStation(i.start_station) : old.start_station,
      elements:i.horizontal?undefined:i.elements??old.elements,points: i.horizontal ?? old.points, pvis: i.vertical ? i.vertical.map((p) => ({ station: parseStation(p.station), z: p.z, curve: p.curve })) : old.pvis };
    const a = align3d(d);
    return { events: [{ type: "AlignmentSet", payload: d }], summary: { id: d.id, length_m: +hLength(a.h).toFixed(3) } };
  },
});

const createSections = cmd({
  name: "infra_create_section_types", title: "Create tunnel section types", permission: "infra.write",
  description: "Tunnel cross-section types: clear line (circle for TBM, horseshoe for NATM, or polygon), layers inside->out (e.g. final lining, shotcrete), overbreak allowance, rock bolt pattern, TBM ring length.",
  input: z.object({ types: z.array(z.object({
    name: z.string(), profile: ProfileSchema,
    designBasis:z.object({status:z.string().min(1).max(120),notes:z.array(z.string().max(2000)).max(40),sources:z.array(z.object({title:z.string().max(200),reference:z.string().max(2000)})).max(20)}).optional(),
    layers: z.array(z.object({ name: z.string(), thickness: z.number().positive(), material: z.string().optional(), materialId:z.string().regex(/^M-\d+$/).optional(),outer_profile:z.array(z.tuple([z.number().finite(),z.number().finite()])).min(3).max(2048).optional().describe('Explicit CCW outer boundary for variable lining; polygon clear profile required, independent vertex count; thickness remains nominal metadata.') })).default([]).describe("inside -> out"),
    overbreak: z.number().min(0).optional().describe("payment line beyond the excavation line, m"),
    bolts: z.object({ per_round: z.number().int().positive(), spacing: z.number().positive(), length: z.number().positive() }).optional(),
    ring_length: z.number().positive().optional() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const t of i.types) {
      if (Object.values(s.sections).some((x) => x.name.toLowerCase() === t.name.toLowerCase())) throw new DomainError(`Section type '${t.name}' exists.`);
      const d: SectionType = { id: next(s, "TS"), ...t, layers:t.layers.map(l=>({...l,id:randomUUID()})) };
      geo(() => boundaries(d, 0.01));
      events.push({ type: "SectionTypeSet", payload: d });
    }
    events.push({ type: "CountersSet", payload: { ...s.counters } });
    return { events, summary: { created: events.filter((e) => e.type === "SectionTypeSet").map((e: any) => `${e.payload.id} ${e.payload.name}`) } };
  },
});

const updateSection = cmd({
  name:'infra_update_section_type',title:'Update tunnel section and lining materials',permission:'infra.write',
  description:'Update a section shared by its tunnel ranges. Stable layer ids are required for existing layers. Material ids reference this project BIM registry; null clears assignment. Full layers replaces/reorders layers; omit id only for a new layer.',
  input:z.object({section:z.string(),name:z.string().optional(),profile:ProfileSchema.optional(),designBasis:z.object({status:z.string().min(1).max(120),notes:z.array(z.string().max(2000)).max(40),sources:z.array(z.object({title:z.string().max(200),reference:z.string().max(2000)})).max(20)}).optional(),
    assignments:z.array(z.object({layerId:z.string(),materialId:z.string().regex(/^M-\d+$/).nullable()})).min(1).optional(),
    layers:z.array(z.object({id:z.string().optional(),name:z.string(),thickness:z.number().positive(),material:z.string().optional(),materialId:z.string().regex(/^M-\d+$/).nullable().optional(),outer_profile:z.array(z.tuple([z.number().finite(),z.number().finite()])).min(3).max(2048).nullable().optional()})).optional()}),
  decide(s,i){
    const old=byRef(s.sections,i.section,'Section type');
    const existing=old.layers.map((l,index)=>({...l,id:layerId(old,index)}));
    if(i.layers&&i.assignments)throw new DomainError('Use layers or assignments, not both.');
    let layers=existing;
    if(i.layers)layers=i.layers.map(l=>{
      const prior=l.id?existing.find(x=>x.id===l.id):undefined;
      if(l.id&&!prior)throw new DomainError(`Unknown layer ${l.id}.`);
      const merged={...prior,...l,id:prior?.id??randomUUID()};
      return {...merged,outer_profile:l.outer_profile===null?undefined:l.outer_profile??prior?.outer_profile,materialId:l.materialId===null?undefined:l.materialId??prior?.materialId};
    });
    for(const a of i.assignments??[]){const l=layers.find(x=>x.id===a.layerId);if(!l)throw new DomainError(`Unknown layer ${a.layerId}.`);l.materialId=a.materialId??undefined;}
    const d={...old,name:i.name??old.name,profile:i.profile??old.profile,designBasis:i.designBasis??old.designBasis,layers};geo(()=>boundaries(d,0.01));
    return {events:[{type:'SectionTypeSet',payload:d}],summary:{section:old.id,layers:layers.map(l=>({id:l.id,materialId:l.materialId??null}))}};
  }
});
const RangesSchema = z.array(z.object({ from: Station, to: Station, section: z.string().describe("section type id or name") })).min(1);
const toRanges = (s: InfraState, rs: z.infer<typeof RangesSchema>): Range[] =>
  rs.map((r) => ({ from: parseStation(r.from), to: parseStation(r.to), section: byRef(s.sections, r.section, "Section type").id }));
const tunnelParent=(s:InfraState,ref:string|undefined,alignment:string,ranges:Range[])=>{if(!ref)return undefined;const parent=byRef(s.tunnels,ref,'Parent tunnel');if(parent.alignment!==alignment||ranges.some(r=>!parent.ranges.some(p=>r.from>=p.from-1e-6&&r.to<=p.to+1e-6)))throw new DomainError('Tunnel component must use its parent alignment and station interval.');return parent.id;};

const createTunnel = cmd({
  name: "infra_create_tunnel", title: "Create tunnel", permission: "infra.write",
  description: "Sweep section types along an alignment over station ranges (e.g. different support classes). The solids follow plan curves, spirals and vertical curves.",
  input: z.object({ name: z.string(), alignment: z.string(), ranges: RangesSchema,parentTunnel:z.string().optional() }),
  decide: (s, i) => {
    const alignment=byRef(s.alignments,i.alignment,'Alignment').id,ranges=toRanges(s,i.ranges);
    const d: TunnelDef = { id: next(s, "TN"), name: i.name, alignment, ranges,parentTunnel:tunnelParent(s,i.parentTunnel,alignment,ranges) };
    return { events: [{ type: "TunnelSet", payload: d }, { type: "CountersSet", payload: { ...s.counters } }],
             summary: { id: d.id, ranges: d.ranges.map((r) => `${kmLabel(r.from)}–${kmLabel(r.to)} ${s.sections[r.section].name}`) } };
  },
});

const createTunnels = cmd({
  name: "infra_create_tunnels", title: "Create separate tunnels", permission: "infra.write",
  description: "Create several independently selectable tunnel instances in one governed change. Each instance reuses an existing section type and follows its own alignment station range.",
  input: z.object({ tunnels: z.array(z.object({ name: z.string(), alignment: z.string(), ranges: RangesSchema,parentTunnel:z.string().optional() })).min(1).max(100) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    const created: Array<{ id: string; name: string; ranges: string[] }> = [];
    for (const t of i.tunnels) {
      const alignment=byRef(s.alignments,t.alignment,'Alignment').id,ranges=toRanges(s,t.ranges);
      const d: TunnelDef = { id: next(s, "TN"), name: t.name, alignment, ranges,parentTunnel:tunnelParent(s,t.parentTunnel,alignment,ranges) };
      events.push({ type: "TunnelSet", payload: d });
      created.push({ id: d.id, name: d.name, ranges: d.ranges.map((r) => `${kmLabel(r.from)}–${kmLabel(r.to)} ${s.sections[r.section].name}`) });
    }
    events.push({ type: "CountersSet", payload: { ...s.counters } });
    return { events, summary: { created } };
  },
});

const setRanges = cmd({
  name: "infra_set_tunnel_ranges", title: "Set tunnel ranges", permission: "infra.write",
  description: "Replace the station ranges / section assignments of a tunnel.",
  input: z.object({ tunnel: z.string(), name:z.string().trim().min(1).max(120).optional(), ranges: RangesSchema }),
  decide: (s, i) => {
    const t = byRef(s.tunnels, i.tunnel, "Tunnel");
    return { events: [{ type: "TunnelSet", payload: { ...t, name:i.name??t.name, ranges: toRanges(s, i.ranges) } }], summary: { id: t.id } };
  },
});

const setTunnelParents = cmd({
  name:'infra_set_tunnel_parents',title:'Attach tunnel components to parent structures',permission:'infra.write',
  description:'Link already modeled pipe or lining solids to their containing tunnel instance without recreating geometry or changing quantities. Each child must use the same alignment and lie within one parent station range.',
  input:z.object({links:z.array(z.object({tunnel:z.string(),parentTunnel:z.string()})).min(1).max(100)}),
  decide:(s,i)=>{const events:Decision['events']=[],seen=new Set<string>();for(const link of i.links){const child=byRef(s.tunnels,link.tunnel,'Tunnel component');if(seen.has(child.id))throw new DomainError(`Duplicate tunnel component ${child.id}.`);seen.add(child.id);const parentTunnel=tunnelParent(s,link.parentTunnel,child.alignment,child.ranges);if(parentTunnel===child.id)throw new DomainError('Tunnel component cannot parent itself.');events.push({type:'TunnelSet',payload:{...child,parentTunnel}});}return {events,summary:{linked:i.links.length,ids:[...seen]}};}
});

const del = cmd({
  name: "infra_delete", title: "Delete infra objects", permission: "infra.delete", effect: "destructive",
  description: "Delete alignments, section types or tunnels (objects that still use them must be deleted first).",
  input: z.object({ ids: z.array(z.string()).min(1) }),
  decide: (s, i) => {
    for (const id of i.ids) if (!s.families?.[id]&&!s.familyInstances?.[id]&&!s.alignments[id] && !s.sections[id] && !s.tunnels[id]&&!s.roads?.[id]&&!s.terrains?.[id]&&!s.earthworks?.[id]&&!s.earthworkZones?.[id]&&!s.profileReferences?.[id]) throw new DomainError(`${id} not found.`);
    const ids=[...new Set(i.ids.flatMap(id=>s.familyInstances?.[id]?[...s.familyInstances[id].members,id]:[id]))];
    return { events: ids.map((id) => ({ type: "Deleted", payload: { id } })), summary: { deleted: ids } };
  },
});

const setCrs = cmd({
  name: "infra_set_crs", title: "Set coordinate reference system", permission: "infra.write",
  description: "Name of the projected CRS of the coordinates (written to IFC), e.g. 'EPSG:5254' (TUREF / TM30).",
  input: z.object({ crs: z.string() }),
  decide: (_s, i) => ({ events: [{ type: "SettingsSet", payload: { crs: i.crs } }], summary: i }),
});

const summary = qry({
  name: "infra_summary", title: "Infra summary", permission: "infra.read",
  description: "Alignments (stations, length), section types (areas) and tunnels (ranges).",
  input: z.object({}),
  run: ({ state: s }) => ({
    crs: s.crs ?? null,
    profileReferences:Object.values(s.profileReferences??{}),
    cadDrawings:Object.values(s.cadDrawings??{}),cadRegions:Object.values(s.cadRegions??{}),
    earthworks:Object.values(s.earthworks??{}),earthworkZones:Object.values(s.earthworkZones??{}),
    terrains:Object.values(s.terrains??{}).map(t=>({id:t.id,name:t.name,revision:t.revision,triangles:t.statistics.triangles})),
    roads:Object.values(s.roads??{}).map(r=>({id:r.id,name:r.name,alignment:r.alignment,from:r.from,to:r.to,layers:r.layers.map(l=>({id:l.id,name:l.name,materialId:l.materialId}))})),
    alignments: Object.values(s.alignments).map((d) => { const [a, b] = stationRange(d); return { id: d.id, name: d.name, from: kmLabel(a), to: kmLabel(b), length_m: +(b - a).toFixed(3),verticalStatus:verticalCoverage(align3d(d)).status,verticalCoverage:verticalCoverage(align3d(d)),verticalSource:verticalLineageStatus(s,d),source:cadLineageStatus(s,d) }; }),
    section_types: Object.values(s.sections).map((t) => ({ id: t.id, name: t.name, shape: t.profile.shape, layers: t.layers.map((l) => `${l.name} ${l.thickness} m`) })),
    tunnels: Object.values(s.tunnels).map((t) => ({ id: t.id, name: t.name, alignment: t.alignment, ranges: t.ranges.map((r) => `${kmLabel(r.from)}–${kmLabel(r.to)} ${s.sections[r.section]?.name}`) })),
  }),
});

const report = qry({
  name: "infra_alignment_report", title: "Alignment report", permission: "infra.read",
  description: "Element table (line / clothoid / arc with start km, length, radius) and PVI table (grades, curve lengths).",
  input: z.object({ alignment: z.string() }),
  run: ({ state: s }, i) => {
    const d = byRef(s.alignments, i.alignment, "Alignment"), a = align3d(d);
    return {
      definition:d,sourceStatus:cadLineageStatus(s,d),verticalSourceStatus:verticalLineageStatus(s,d),verticalCoverage:verticalCoverage(a),verticalStatus:verticalCoverage(a).status,
      horizontal: a.h.map((e) => ({ id:e.id,type: e.kind, from: kmLabel(e.s0), length_m: +e.length.toFixed(3),
        radius_m: e.kind === "arc" ? +(1 / Math.abs(e.k0)).toFixed(3) : e.kind === "clothoid" ? `${e.k0 ? (1 / Math.abs(e.k0)).toFixed(0) : "∞"}→${e.k1 ? (1 / Math.abs(e.k1)).toFixed(0) : "∞"}` : null,
        turn: e.k0 + e.k1 > 0 ? "left" : e.k0 + e.k1 < 0 ? "right" : null })),
      vertical: d.pvis.map((p, k) => ({ pvi: kmLabel(p.station), z: p.z, curve_m: p.curve ?? 0,
        grade_out_pct: k < d.pvis.length - 1 ? +(((d.pvis[k + 1].z - p.z) / (d.pvis[k + 1].station - p.station)) * 100).toFixed(4) : null })),
    };
  },
});

const station = qry({
  name: "infra_station", title: "Point at station", permission: "infra.read",
  description: "3D point, bearing, grade and curvature of an alignment at a station.",
  input: z.object({ alignment: z.string(), station: Station }),
  run: ({ state: s }, i) => {
    const a = align3d(byRef(s.alignments, i.alignment, "Alignment"));
    const st = parseStation(i.station);
    const hp=geo(()=>evalH(a.h,st));
    if(!hasVerticalAt(a.v,st))return {verticalCoverage:verticalCoverage(a),station:kmLabel(st),x:hp.x,y:hp.y,z:null,azimuth_rad:hp.az,direction:[Math.cos(hp.az),Math.sin(hp.az)],radius_m:hp.k?1/Math.abs(hp.k):null,segment:hp.element.id??null,verticalStatus:verticalCoverage(a).status};
    const p = geo(() => point3d(a, st));
    const bearing = ((90 - (p.az * 180) / Math.PI) % 360 + 360) % 360;
    return { verticalStatus:verticalCoverage(a).status,verticalCoverage:verticalCoverage(a),engineering:{x:p.x,y:p.y,z:p.z,grade:p.grade},segment:hp.element.id??null,station_m:st,grade:p.grade,azimuth_rad:p.az,direction:[Math.cos(p.az),Math.sin(p.az),p.grade],station: kmLabel(st), x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), bearing_deg_from_north: +bearing.toFixed(5),
             grade_pct: +(p.grade * 100).toFixed(4), radius_m: p.k ? +(1 / Math.abs(p.k)).toFixed(3) : null };
  },
});

function tunnelGeo(s: InfraState, ref: string, tol?: number) {
  const t = byRef(s.tunnels, ref, "Tunnel"), a = align3d(s.alignments[t.alignment]);
  return { t, a, geometry: geo(() => tunnelGeometry(a, t.ranges, s.sections, localOrigin(a), tol)) };
}

const quantities = qry({
  name: "infra_tunnel_quantities", title: "Tunnel quantities", permission: "infra.read",
  description: "Per station range and in total: excavation, overbreak, layer volumes (from the swept solids), areas, rock bolts, TBM rings.",
  input: z.object({ tunnel: z.string() }),
  run: ({ state: s }, i) => { const { t, geometry } = tunnelGeo(s, i.tunnel),result=tunnelQuantities(geometry);
    if(t.parentTunnel){
      const ranges=result.ranges.map(({areas_m2,volumes_m3,...range})=>({...range,areas_m2:Object.fromEntries(Object.entries(areas_m2 as Record<string,unknown>).filter(([key])=>!['clear','excavation','payment_line'].includes(key))),volumes_m3:Object.fromEntries(Object.entries(volumes_m3 as Record<string,unknown>).filter(([key])=>!['excavation','overbreak'].includes(key)))}));
      const totals=Object.fromEntries(Object.entries(result.totals).filter(([key])=>!['excavation_m3','overbreak_m3'].includes(key)));
      return {tunnel:t.name,parentTunnel:t.parentTunnel,quantityScope:'component material only; no additional excavation',ranges,totals};
    }
    return { tunnel: t.name, ...result }; },
});

const render = qry({
  name: "infra_render", title: "Render infra drawing", permission: "infra.read",
  description: "Image of an alignment plan, longitudinal profile, a section type, or a shaded 3D view of a tunnel (optionally limited to a station range).",
  input: z.object({ view: z.enum(["plan", "profile", "section", "3d"]), alignment: z.string().optional(), tunnel: z.string().optional(),
                    section_type: z.string().optional(), from: Station.optional(), to: Station.optional() }),
  run: ({ state: s }, i) => {
    let svg: string;
    if (i.view === "section") svg = sectionSvg(byRef(s.sections, i.section_type ?? "", "Section type"));
    else {
      const t = i.tunnel ? byRef(s.tunnels, i.tunnel, "Tunnel") : undefined;
      const d = byRef(s.alignments, i.alignment ?? t?.alignment ?? "", "Alignment"), a = align3d(d);
      const tun = t ? { ranges: t.ranges, sections: s.sections } : undefined;
      if (i.view === "plan") svg = planSvg(d.name, a, d.points, tun);
      else if (i.view === "profile") svg = profileSvg(d.name, a, d.pvis, tun);
      else {
        if (!t) throw new DomainError("3D view needs a tunnel.");
        const f = i.from !== undefined ? parseStation(i.from) : -Infinity, to = i.to !== undefined ? parseStation(i.to) : Infinity;
        const rs = t.ranges.map((r) => ({ ...r, from: Math.max(r.from, f), to: Math.min(r.to, to) })).filter((r) => r.to > r.from);
        if (!rs.length) throw new DomainError("No tunnel in that station range.");
        svg = geo(() => threeDSvg(`${t.name} · 3D ${kmLabel(rs[0].from)}–${kmLabel(rs[rs.length - 1].to)}`, a, rs, s.sections));
      }
    }
    return { __image: { base64: Buffer.from(toPng(svg)).toString("base64"), mimeType: "image/png" }, view: i.view };
  },
});

export function infraIfcText(s: InfraState, project: string, includeExcavation = false,materials:Record<string,{id:string;name:string}>={}) {
  const als = Object.values(s.alignments);
  const origin = als.length ? localOrigin(align3d(als[0])) : [0, 0, 0] as [number, number, number];
  return infraIfc({
    projectKey: project, projectName: project, origin, crs: s.crs, includeExcavation,materials,
    alignments: als.map((d) => ({ id: d.id, name: d.name, a: align3d(d) })),
    tunnels: Object.values(s.tunnels).map((t) => {
      const a = align3d(s.alignments[t.alignment]);
      const precise = tunnelGeometry(a, t.ranges, s.sections, origin).map((rg) =>
        ({ Excavation: meshVolume(rg.excavation), ...Object.fromEntries(rg.layers.map((l) => [l.name, meshVolume(l.mesh)])) }));
      return { id: t.id, name: t.name, volumes: precise,
               geometry: tunnelGeometry(a, t.ranges, s.sections, origin, EXPORT_TOL.tol, EXPORT_TOL.ringTol) };
    }),
  });
}

const exportIfc = qry({
  name: "infra_export_ifc", title: "Export infra IFC", permission: "infra.export",
  description: "IFC4 into the project's export storage: tunnel layers as tessellated solids (optionally the excavation), the alignment as a 3D polyline, georeferenced (IfcMapConversion).",
  input: z.object({ name: z.string().optional().describe("artifact file name without folders"), include_excavation: z.boolean().default(false),
                    path: z.unknown().optional().describe("REMOVED: passing a path is an error") }),
  run: async ({ state, project, platform }, i) => {
    if (i.path !== undefined) throw new DomainError("The 'path' argument is no longer supported; use 'name'.", "INVALID_EXPORT_PATH");
    const base = i.name !== undefined ? parseArtifactBaseName(i.name) : safeBaseName(`${project}-infra`);
    const bim=await platform.state<{materials:Record<string,{id:string;name:string}>}|undefined>(project,'bim');
    const text = geo(() => infraIfcText(state, project, i.include_excavation,bim?.materials??{}));
    return { artifact: platform.requireArtifacts().save(project, "ifc", base, text),...([...Object.keys(state.roads??{}),...Object.keys(state.terrains??{}),...Object.keys(state.earthworks??{}),...Object.keys(state.earthworkZones??{}),...Object.keys(state.profileReferences??{})].length?{excluded_resources:[...Object.keys(state.roads??{}),...Object.keys(state.terrains??{}),...Object.keys(state.earthworks??{}),...Object.keys(state.earthworkZones??{}),...Object.keys(state.profileReferences??{})],warning:'Road/terrain/earthworks/zone/profile-reference resources are not included in the legacy IFC4 alignment/tunnel export. IFC4.3 road/terrain interoperability is not implemented.'}:{}) };
  },
});

export const infraModule: ModuleDef<InfraState> = {
  id: "infra", title: "Infrastructure (alignments, tunnels)", initialState, apply, validate,
  eventVersions: { InfrastructureFamilySet:1,FamilyInstanceSet:1,ComponentTypeSet:1,ProfileReferenceSet:1,CivilNavigationSet:1, CadAlignmentReviewSet:1,CadDrawingSet:1,CadRegionSet:1,AlignmentSet: 1, SectionTypeSet: 1, TunnelSet: 1,RoadCorridorSet:1,TerrainSet:1,EarthworksSet:1,EarthworkZoneSet:1, Deleted: 1, CountersSet: 1, SettingsSet: 1 },
  tools: [createAlignment, updateAlignment, createSections, updateSection, createTunnel, createTunnels, setRanges, setTunnelParents, del, setCrs,
          summary, report, station, quantities, render, exportIfc,setProfileReference,...civilNavigationTools(parseStation),...cadTools,...roadTools(align3d,parseStation),...componentTypeTools,...familyTools,...terrainTools,...earthworksTools(align3d,parseStation)],
};
