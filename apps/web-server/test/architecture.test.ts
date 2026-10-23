/** Phase 11 · the web layer: the model tree groups by SEMANTIC category (never by engine), details, plan, IFC. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

test("the model tree has separate Floors / Ceilings / Roofs / Stairs / Railings / Rooms / Spaces groups; details carry category and engine", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const app = buildApp({ platform });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token as string;
  const call = (method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  const tool = async (name: string, input: unknown) => { const r = await call("POST", `/api/projects/ofis/tools/${name}`, { input }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  await tool("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3.2 }] });
  await tool("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "slab", name: "D", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "ceiling", name: "C", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "stair", name: "S", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 }, { kind: "railing", name: "RL", height: 1, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  await tool("bim_create_walls", { walls: [{ storey: "00", type: "DD", points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true, height: 3 }] });
  for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]])
    await tool("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: a, endpoint: "end" }, { wall: b, endpoint: "start" }] });
  await tool("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "00", x: 3, y: 3 }, { category: "mechanical.space", storey: "00", x: 3, y: 3 }] });
  const sq = [[0, 0], [10, 0], [10, 6], [0, 6]];
  await tool("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "00", type: "D", outline: sq }, { category: "architecture.ceiling", storey: "00", type: "C", outline: sq, offset: 2.7 },
    { category: "architecture.roof", storey: "01", type: "R", outline: sq, slope: { azimuth: 90, pitch: 15 } }] });
  await tool("bim_create_stairs", { stairs: [{ storey: "00", type: "S", start: [1, 1], end: [5, 1], riser_count: 16 }] });
  await tool("bim_create_railings", { railings: [{ storey: "01", type: "RL", path: [[0, 0], [10, 0]] }] });

  const tree = (await call("GET", "/api/projects/ofis/tree")).json() as { groups: Record<string, { id: string }[]> }[];
  const groups: Record<string, string[]> = {};
  for (const st of tree) for (const [g, items] of Object.entries(st.groups)) (groups[g] ??= []).push(...items.map((i) => i.id));
  assert.deepEqual(Object.keys(groups).sort(), ["ceiling", "railing", "roof", "room", "slab", "space", "stair", "wall"],
    "semantic groups: never 'boundary', 'path' or a merged 'spatial'");
  assert.deepEqual([groups.slab, groups.ceiling, groups.roof, groups.stair, groups.railing, groups.room, groups.space],
    [["S-0001"], ["CE-0001"], ["RF-0001"], ["STR-0001"], ["RL-0001"], ["SP-0001"], ["SP-0002"]]);
  assert.equal(groups.slab.length, 1);
  for (const [id, category, engine] of [["CE-0001", "architecture.ceiling", "boundary"], ["STR-0001", "architecture.stair", "stair"], ["RL-0001", "architecture.railing", "path"]]) {
    const d = (await call("GET", `/api/projects/ofis/elements/${id}`)).json();
    assert.deepEqual([d.taxonomy.category, d.engine], [category, engine]);
    assert.ok(d.representation && d.placement_info && d.quantities, `${id}: representation, placement and quantities in the detail`);
  }
  assert.equal((await call("GET", "/api/projects/ofis/plan/00.png")).statusCode, 200);
  const ifc = await call("GET", "/api/projects/ofis/model.ifc");
  assert.equal(ifc.statusCode, 200);
  for (const cls of ["IFCCOVERING", "IFCROOF", "IFCSTAIR", "IFCRAILING"]) assert.ok(ifc.body.includes(`${cls}(`), cls);
});
