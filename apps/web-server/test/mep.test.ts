/** Phase 13 · the model tree groups MEP route elements by SEMANTIC category (never "mep_network"); element detail carries connectors / system / route. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

test("tree groups: pipes, ducts, cable trays, conduits; detail: category, engine, system, route, world route, length, connectors, junction", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const app = buildApp({ platform });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token as string;
  const call = (method: "GET" | "POST", url: string, payload?: unknown) => app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  const tool = async (name: string, input: unknown) => { const r = await call("POST", `/api/projects/ofis/tools/${name}`, { input }); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const R = (x: number, y: number, offset: number, storey = "00") => ({ storey, at: [x, y], offset });
  await tool("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3.2 }] });
  await tool("bim_create_types", { types: [{ kind: "pipe", name: "P", diameter: 0.025 }, { kind: "duct", name: "D", shape: "round", diameter: 0.3 }, { kind: "cable_tray", name: "T", width: 0.3, height: 0.1 }, { kind: "conduit", name: "C", diameter: 0.02 }] });
  await tool("bim_create_mep_systems", { systems: [{ name: "DCW", domain: "piping", classification: "domestic_cold_water" }, { name: "SA", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  await tool("bim_create_pipes", { pipes: [{ type: "P", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { type: "P", system: "DCW", route: [R(4, 0, 0.5), R(4, 0, 0.5, "01")] }] });
  await tool("bim_create_ducts", { ducts: [{ type: "D", system: "SA", route: [R(0, 3, 2.5), R(5, 3, 2.5)] }] });
  await tool("bim_create_cable_trays", { cable_trays: [{ type: "T", system: "PWR", route: [R(0, 5, 2.8), R(5, 5, 2.8)] }] });
  await tool("bim_create_conduits", { conduits: [{ type: "C", system: "PWR", route: [R(0, 6, 2.8), R(5, 6, 2.8)] }] });
  await tool("bim_connect_mep", { connectors: [{ element: "ME-0001", connector: "end" }, { element: "ME-0002", connector: "start" }] });
  const tree = (await call("GET", "/api/projects/ofis/tree")).json() as { groups: Record<string, { id: string }[]> }[];
  const groups: Record<string, string[]> = {};
  for (const st of tree) for (const [g, items] of Object.entries(st.groups)) (groups[g] ??= []).push(...items.map((i) => i.id));
  assert.deepEqual(Object.keys(groups).sort(), ["electrical.cable_tray", "electrical.conduit", "mechanical.duct", "plumbing.pipe"], "semantic groups: never 'mep_network' or 'mep_segment'");
  assert.deepEqual([groups["plumbing.pipe"], groups["mechanical.duct"], groups["electrical.cable_tray"], groups["electrical.conduit"]], [["ME-0001", "ME-0002"], ["ME-0003"], ["ME-0004"], ["ME-0005"]]);
  const d = (await call("GET", "/api/projects/ofis/elements/ME-0002")).json();
  assert.deepEqual([d.taxonomy.category, d.engine, d.system.name, d.world_route[1][2], Math.round(d.length * 10) / 10, d.connectors.map((c: any) => [c.connector, c.junction])], ["plumbing.pipe", "mep_network", "DCW", 3.7, 3.2, [["start", "MJ-0001"], ["end", null]]]);
  const ifc = await call("GET", "/api/projects/ofis/model.ifc");
  for (const cls of ["IFCPIPESEGMENT(", "IFCDUCTSEGMENT(", "IFCCABLECARRIERSEGMENT(", "IFCDISTRIBUTIONPORT(", "IFCDISTRIBUTIONSYSTEM(", "IFCRELCONNECTSPORTS("]) assert.ok(ifc.body.includes(cls), cls);
});
