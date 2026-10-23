/** Phase 12 · the model tree groups structural elements by SEMANTIC category, never by engine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

test("tree groups: structure.brace / pile / shear_wall / slab / footing / foundation_slab plus the architectural ones, each separate", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const app = buildApp({ platform });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token as string;
  const call = (method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  const tool = async (name: string, input: unknown) => { const r = await call("POST", `/api/projects/ofis/tools/${name}`, { input }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  await tool("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3.2 }] });
  await tool("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "M", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "P", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "column", name: "PL", profile: { shape: "circle", d: 0.4 } }, { kind: "beam", name: "B", profile: { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 } }] });
  await tool("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [8, 0], height: 3 }, { category: "structure.shear_wall", storey: "00", type: "DD", start: [0, 6], end: [8, 6], height: 3 }] });
  await tool("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "01", type: "B", start: [0, 3], end: [8, 3], z: 3 }, { category: "structure.column", storey: "00", type: "PL", at: [2, 2], height: 3 }] });
  await tool("bim_create_braces", { braces: [{ storey: "00", type: "B", start: [0, 0], end: [4, 0], end_storey: "01" }] });
  await tool("bim_create_piles", { piles: [{ storey: "00", type: "PL", at: [2, 2], length: 8 }] });
  const sq = [[0, 0], [8, 0], [8, 6], [0, 6]];
  await tool("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "01", type: "D", outline: sq }, { category: "architecture.floor", storey: "01", type: "D", outline: sq },
    { category: "structure.foundation_slab", storey: "00", type: "M", outline: sq, offset: -0.5 }] });
  await tool("bim_create_footings", { footings: [{ storey: "00", type: "P", center: [2, 2], length: 1, width: 1, offset: -0.5 }] });
  const tree = (await call("GET", "/api/projects/ofis/tree")).json() as { groups: Record<string, { id: string }[]> }[];
  const groups: Record<string, string[]> = {};
  for (const st of tree) for (const [g, items] of Object.entries(st.groups)) (groups[g] ??= []).push(...items.map((i) => i.id));
  assert.deepEqual(Object.keys(groups).sort(), ["beam", "column", "slab", "structure.brace", "structure.footing", "structure.foundation_slab", "structure.pile", "structure.shear_wall", "structure.slab", "wall"],
    "semantic groups: never 'profile_member', 'boundary' or one 'wall' group for shear walls");
  assert.deepEqual([groups["structure.brace"], groups["structure.pile"], groups["structure.shear_wall"], groups.wall, groups.beam, groups.column, groups.slab, groups["structure.slab"]],
    [["BR-0001"], ["PL-0001"], ["W-0002"], ["W-0001"], ["B-0001"], ["C-0001"], ["S-0001"], ["SSL-0001"]]);
  const braceTreeItem = (tree as { groups: Record<string, { id: string; category: string; categoryLabel: string; discipline: string }[]> }[]).flatMap(st => st.groups["structure.brace"] ?? []).find(x => x.id === "BR-0001");
  assert.deepEqual([braceTreeItem?.category, braceTreeItem?.discipline], ["structure.brace", "structure"], "tree items expose their semantic category and discipline for alternate grouping");
  const d = (await call("GET", "/api/projects/ofis/elements/BR-0001")).json();
  assert.deepEqual([d.taxonomy.category, d.engine, d.world.end[2]], ["structure.brace", "profile_member", 3.2]);
  const ifc = await call("GET", "/api/projects/ofis/model.ifc");
  for (const cls of ["IFCMEMBER(", "IFCPILE(", "IFCFOOTING(", "IFCISHAPEPROFILEDEF("]) assert.ok(ifc.body.includes(cls), cls);
});


