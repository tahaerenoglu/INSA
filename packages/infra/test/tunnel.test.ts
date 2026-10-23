import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { InfraState, align3d, tunnelGeometry, localOrigin, isClosedOriented, boundaries, polyArea, infraIfcText, hLength } from "../src/index.js";
import { platform, buildTunnel, ai } from "./fixtures.js";

const OUT = "/tmp/infra-out";
fs.mkdirSync(OUT, { recursive: true });

test("realistic tunnel through the platform tools: solids are closed, volumes equal area x length", async () => {
  const p = platform();
  const { tunnel } = await buildTunnel(p);
  const s = await p.state<InfraState>("demiryolu", "infra");
  const t = s.tunnels[tunnel], a = align3d(s.alignments[t.alignment]);
  const g = tunnelGeometry(a, t.ranges, s.sections, localOrigin(a));
  for (const rg of g) for (const m of [rg.excavation, rg.payment, ...rg.layers.map((l) => l.mesh)]) assert.ok(isClosedOriented(m));
  const q: any = (await p.execute(ai, "demiryolu", "infra_tunnel_quantities", { tunnel: "T1 Tüneli" }) as any).result;
  q.ranges.forEach((row: any, i: number) => {
    const L = t.ranges[i].to - t.ranges[i].from, b = boundaries(s.sections[t.ranges[i].section]);
    const expected = polyArea(b.excavation) * L;            // symmetric section + vertical planes: V = A * L, even in curves
    assert.ok(Math.abs(row.volumes_m3.excavation - expected) / expected < 2e-5, `range ${i}: ${row.volumes_m3.excavation} vs ${expected}`);
  });
  assert.equal(q.totals.length_m, 2150);
  assert.equal(q.totals.rock_bolts_count, (Math.floor(900 / 1.5) + 1) * 12 + (Math.floor(370 / 1.2) + 1) * 16 + (Math.floor(880 / 1.5) + 1) * 12);
  fs.writeFileSync(`${OUT}/quantities.json`, JSON.stringify(q, null, 1));
});

test("geometry rules: ranges outside the alignment, overlapping ranges, short profiles are rejected", async () => {
  const p = platform();
  await buildTunnel(p);
  await assert.rejects(p.execute(ai, "demiryolu", "infra_set_tunnel_ranges", { tunnel: "T1 Tüneli", ranges: [{ from: "2+000", to: "9+000", section: "NATM B2" }] }), /outside the alignment/);
  await assert.rejects(p.execute(ai, "demiryolu", "infra_set_tunnel_ranges", { tunnel: "T1 Tüneli", ranges: [
    { from: 100, to: 600, section: "NATM B2" }, { from: 500, to: 900, section: "NATM C3" }] }), /overlap/);
  await assert.rejects(p.execute(ai, "demiryolu", "infra_update_alignment", { alignment: "Ana Hat", vertical: [{ station: 0, z: 60 }, { station: 1000, z: 70 }] }), /must cover/);
  await assert.rejects(p.execute(ai, "demiryolu", "infra_create_alignment", { name: "x", horizontal: [{ x: 0, y: 0 }, { x: 100, y: 0, radius: 2000 }, { x: 150, y: 90 }], vertical: [{ station: 0, z: 0 }, { station: 400, z: 0 }] }), /exceeds|overlaps/);
});

test("changing the alignment re-shapes the tunnel (it follows the new curve)", async () => {
  const p = platform();
  await buildTunnel(p);
  const before: any = (await p.execute(ai, "demiryolu", "infra_tunnel_quantities", { tunnel: "T1 Tüneli" }) as any).result;
  await p.execute(ai, "demiryolu", "infra_update_alignment", { alignment: "Ana Hat",
    horizontal: [{ x: 412000, y: 4561000 }, { x: 412900, y: 4561250, radius: 700, spiral: 100 }, { x: 413700, y: 4561050, radius: 900, spiral: 120 }, { x: 414300, y: 4561350 }] });
  const s = await p.state<InfraState>("demiryolu", "infra");
  const a = align3d(s.alignments["AL-001"]);
  assert.ok(hLength(a.h) > 2300);
  const after: any = (await p.execute(ai, "demiryolu", "infra_tunnel_quantities", { tunnel: "T1 Tüneli" }) as any).result;
  assert.equal(after.totals.length_m, before.totals.length_m); // same station ranges, new geometry
  const pt: any = (await p.execute(ai, "demiryolu", "infra_station", { alignment: "Ana Hat", station: "1+000" }) as any).result;
  assert.ok(pt.radius_m === null || pt.radius_m > 0);
});

test("drawings (plan, profile, section, 3D) and IFC export", async () => {
  const p = platform();
  await buildTunnel(p);
  for (const [view, args] of [["plan", { tunnel: "T1 Tüneli" }], ["profile", { tunnel: "T1 Tüneli" }], ["section", { section_type: "NATM C3" }],
                              ["3d", { tunnel: "T1 Tüneli", from: "0+700", to: "1+250" }]] as const) {
    const r: any = await p.execute(ai, "demiryolu", "infra_render", { view, ...args });
    const png = Buffer.from(r.result.__image.base64, "base64");
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    fs.writeFileSync(`${OUT}/${view}.png`, png);
  }
  const s = await p.state<InfraState>("demiryolu", "infra");
  const ifc = infraIfcText(s, "demiryolu", true);
  assert.match(ifc, /IFCMAPCONVERSION/); assert.match(ifc, /IFCTRIANGULATEDFACESET/);
  fs.writeFileSync(`${OUT}/tunnel.ifc`, ifc);
});
