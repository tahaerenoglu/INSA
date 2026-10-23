import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { BimState, quantities, wallFrame, area, toIfc, svgToPng, planSvg, ifcToFrag } from "../src/index.js";
import { platform, buildSample, ai, human } from "./fixtures.js";

const OUT = "/tmp/insa-out";
fs.mkdirSync(OUT, { recursive: true });

test("sample building: walls, mitres, layers, quantities", async () => {
  const p = platform();
  const { walls0, walls1 } = await buildSample(p);
  const s = await p.state<BimState>("demo", "bim");
  assert.equal(walls0.length, 4); assert.equal(walls1.length, 4);
  const t = 0.28;
  // exterior_face: outer face of the walls is exactly the 12 x 8 m outline
  const band = 12 * 8 - (12 - 2 * t) * (8 - 2 * t);
  const fp = walls0.reduce((a, id) => a + area(wallFrame(s, s.elements[id] as any).footprint), 0);
  assert.ok(Math.abs(fp - band) < 1e-6, `mitred footprints ${fp} vs ring ${band}`);
  // exterior side faces outward for CCW and CW perimeters
  assert.equal((s.elements[walls0[0]] as any).exterior, "right");
  assert.equal((s.elements[walls1[0]] as any).exterior, "left");
  // net wall volume = ring * height - openings
  const h = 3.5;
  const openings = (1.0 * 2.1 + 1.5 * 1.5 * 2) * t;
  const net = walls0.reduce((a, id) => a + quantities(s, s.elements[id]).net_volume, 0);
  assert.ok(Math.abs(net - (band * h - openings)) < 1e-6, `net ${net}`);
  const slab = Object.values(s.elements).find((e) => e.kind === "boundary" && e.category === "architecture.floor")!;   // Phase 9: slabs are floor boundaries
  assert.ok(Math.abs(quantities(s, slab).volume - (96 - 2.5 * 2) * 0.2) < 1e-9);
  fs.writeFileSync(`${OUT}/expected.json`, JSON.stringify({ wall_net_volume_storey0: net, slab_volume: quantities(s, slab).volume }));
});

test("invariants: opening outside wall, overlap and missing storey are rejected", async () => {
  const p = platform();
  const { walls0 } = await buildSample(p);
  await assert.rejects(p.execute(ai, "demo", "bim_place_openings", { items: [{ kind: "opening", host: walls0[0], along: 11.9, width: 1, height: 1 }] }), /exceeds wall/);
  await assert.rejects(p.execute(ai, "demo", "bim_place_openings", { items: [{ kind: "window", host: walls0[0], along: 3.2, type: "Pencere 150x150", sill: 0.2 }] }), /overlaps/);
  await assert.rejects(p.execute(ai, "demo", "bim_create_walls", { walls: [{ storey: "99", type: "DD-28 Sıva+Taşyünü+Tuğla+Sıva", start: [0, 0], end: [1, 0] }] }), /not found/);
});

test("delete cascades and undo restores", async () => {
  const p = platform();
  const { walls0 } = await buildSample(p);
  const r: any = await p.execute(ai, "demo", "bim_delete_elements", { ids: [walls0[0]], cascade_hosted: true });
  assert.equal(r.summary.deleted.length, 5); // wall + 2 openings + door + window
  await p.execute(ai, "demo", "platform_undo", {});
  assert.ok((await p.state<BimState>("demo", "bim")).elements[walls0[0]]);
});

test("AI writes go through approval in 'ai' mode", async () => {
  const p = platform("ai");
  const r: any = await p.execute(ai, "demo", "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  assert.equal(r.status, "proposed");
  assert.equal(Object.keys((await p.state<BimState>("demo", "bim")).storeys).length, 0);
  await p.approve(human, "demo", r.proposalId);
  assert.equal(Object.keys((await p.state<BimState>("demo", "bim")).storeys).length, 1);
});

test("outputs: IFC, plan PNG and .frag from the same model", async () => {
  const p = platform();
  await buildSample(p);
  const s = await p.state<BimState>("demo", "bim");
  const ifc = toIfc(s, { projectKey: "demo" });
  assert.match(ifc, /FILE_SCHEMA\(\('IFC4'\)\)/);
  assert.equal(ifc, toIfc(s, { projectKey: "demo" }).replace(/'\d{4}-\d\d-\d\dT[\d:]+'/, ifc.match(/'\d{4}-\d\d-\d\dT[\d:]+'/)![0]), "deterministic");
  fs.writeFileSync(`${OUT}/sample.ifc`, ifc);
  for (const st of Object.values(s.storeys).slice(0, 2))
    fs.writeFileSync(`${OUT}/plan_${st.name.replace(/\s/g, "_")}.png`, svgToPng(planSvg(s, st, { showIds: true })));
  const frag = await ifcToFrag(ifc);
  assert.ok(frag.byteLength > 1000, `frag ${frag.byteLength} bytes`);
  fs.writeFileSync(`${OUT}/sample.frag`, frag);
});
