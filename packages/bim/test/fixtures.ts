import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule } from "../src/index.js";

export const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };
export const human: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };

export function platform(mode: "auto" | "ai" = "auto") {
  return new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: mode });
}

/** The sample building, built exactly like an AI session would: one tool call per step. */
export async function buildSample(p: Platform, project = "demo") {
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(ai, project, tool, input);
    if (r.status !== "applied") throw new Error(`${tool}: ${JSON.stringify(r)}`);
    return r.summary;
  };
  await run("bim_set_project", { name: "Örnek Ofis", number: "INSA-001", building: "A Blok", site: "İstanbul" });
  await run("bim_create_storeys", { storeys: [{ name: "00 Zemin", elevation: 0 }, { name: "01 Kat", elevation: 3.5 }, { name: "Çatı", elevation: 7 }] });
  await run("bim_create_grids", { grids: [
    { name: "A", start: [0, -1.5], end: [0, 9.5] }, { name: "B", start: [6, -1.5], end: [6, 9.5] }, { name: "C", start: [12, -1.5], end: [12, 9.5] },
    { name: "1", start: [-1.5, 0], end: [13.5, 0] }, { name: "2", start: [-1.5, 8], end: [13.5, 8] }] });
  await run("bim_create_types", { types: [
    { kind: "wall", name: "DD-28 Sıva+Taşyünü+Tuğla+Sıva", layers: [
      { material: "Dış Sıva", thickness: 0.02, function: "finish", color: "#e8e2d0" },
      { material: "Taşyünü", thickness: 0.05, function: "insulation", color: "#f2d16b" },
      { material: "Yatay Delikli Tuğla", thickness: 0.19, function: "structure", color: "#b5523b" },
      { material: "İç Sıva", thickness: 0.02, function: "finish", color: "#cfd6dc" }] },
    { kind: "slab", name: "D-20 Betonarme", layers: [
      { material: "Seramik", thickness: 0.01, function: "finish" }, { material: "Şap", thickness: 0.04, function: "substrate" },
      { material: "Betonarme C30", thickness: 0.15, function: "structure", color: "#9aa0a6" }] },
    { kind: "column", name: "K-50x50", profile: { shape: "rect", b: 0.5, h: 0.5 }, material: "Betonarme C30" },
    { kind: "beam", name: "KR-30x60", profile: { shape: "rect", b: 0.3, h: 0.6 }, material: "Betonarme C30" },
    { kind: "door", name: "Kapı 100x210", width: 1.0, height: 2.1 },
    { kind: "window", name: "Pencere 150x150", width: 1.5, height: 1.5 }] });
  const walls0 = await run("bim_create_walls", { walls: [{ storey: "00 Zemin", type: "DD-28 Sıva+Taşyünü+Tuğla+Sıva",
    points: [[0, 0], [12, 0], [12, 8], [0, 8]], closed: true, location_line: "exterior_face" }] });
  const walls1 = await run("bim_create_walls", { walls: [{ storey: "01 Kat", type: "DD-28 Sıva+Taşyünü+Tuğla+Sıva",
    points: [[0, 0], [0, 8], [12, 8], [12, 0]], closed: true, location_line: "exterior_face" }] });  // drawn clockwise on purpose
  await run("bim_create_slabs", { slabs: [
    { storey: "01 Kat", type: "D-20 Betonarme", outline: [[0, 0], [12, 0], [12, 8], [0, 8]], holes: [[[4, 3], [6.5, 3], [6.5, 5], [4, 5]]] },
    { storey: "Çatı", type: "D-20 Betonarme", outline: [[0, 0], [12, 0], [12, 8], [0, 8]] }] });
  await run("bim_create_columns", { columns: [{ storey: "00 Zemin", type: "K-50x50", points: [[6, 0.6], [6, 7.4]] }] });
  await run("bim_create_beams", { beams: [{ storey: "00 Zemin", type: "KR-30x60", start: [6, 0.6], end: [6, 7.4] }] });
  await run("bim_place_openings", { items: [
    { kind: "door", host: walls0.created[0], along: 3, type: "Kapı 100x210" },
    { kind: "window", host: walls0.created[0], along: 9, type: "Pencere 150x150" },
    { kind: "window", host: walls0.created[2], at: [3, 8], type: "Pencere 150x150" },
    { kind: "window", host: walls1.created[1], along: 6, type: "Pencere 150x150", sill: 1.0 }] });
  await run("bim_set_properties", { items: [{ ids: walls0.created, pset: "Pset_WallCommon", values: { IsExternal: true, FireRating: "EI 60" } }] });
  return { walls0: walls0.created as string[], walls1: walls1.created as string[] };
}
