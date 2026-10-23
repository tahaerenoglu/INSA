import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHorizontal, sampleStations, Alignment3D } from "../src/alignment.js";
import { boundaries, boundary, polyArea, exactArea, SectionType, UV } from "../src/section.js";
import { frames, sweepSolid, sweepAnnulus, meshVolume, isClosedOriented } from "../src/sweep.js";

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const O: [number, number, number] = [0, 0, 0];
const tbm: SectionType = { id: "T", name: "TBM", profile: { shape: "circle", radius: 4.5, center_y: 2.2 },
  layers: [{ name: "Segment", thickness: 0.35 }], overbreak: 0.05, ring_length: 1.5 };
const natm: SectionType = { id: "N", name: "NATM B2", profile: { shape: "horseshoe", crown_radius: 5.2, spring_y: 3.0, wall_bottom_y: 0.5, invert_depth: 1.4 },
  layers: [{ name: "İç kaplama", thickness: 0.4 }, { name: "Püskürtme beton", thickness: 0.25 }], overbreak: 0.15 };

const straight = (grade = 0): Alignment3D => ({ h: buildHorizontal([{ x: 1000, y: 2000 }, { x: 1300, y: 2400 }]), v: [{ station: 0, z: 80 }, { station: 500, z: 80 + 500 * grade }] });

test("section areas: polygons converge to the exact template areas; boundaries keep vertex correspondence", () => {
  for (const t of [tbm, natm]) {
    const b = boundaries(t);
    b.offsets.forEach((o, i) => {
      const ex = exactArea(t.profile, o)!;
      assert.ok(rel(polyArea(b.rings[i]), ex) < 6e-5, `${t.name} offset ${o}: ${polyArea(b.rings[i])} vs ${ex}`);
    });
    assert.ok(new Set(b.rings.map((r) => r.length)).size === 1);
  }
  assert.throws(() => boundary({ shape: "horseshoe", crown_radius: 3, spring_y: 2, wall_bottom_y: 0, invert_depth: 4 }, 0, 0), /invert_depth/);
});

test("straight and level / straight and graded: volume = area x horizontal length (vertical sections)", () => {
  for (const g of [0, 0.025]) {
    const a = straight(g), st = sampleStations(a, 0, 500);
    const ring = boundaries(tbm).excavation;
    const mesh = sweepSolid(frames(a, st, [1000, 2000, 0]), ring);
    assert.ok(isClosedOriented(mesh), "closed & oriented");
    assert.ok(rel(meshVolume(mesh), polyArea(ring) * 500) < 1e-9, `grade ${g}: ${meshVolume(mesh)}`);
  }
});

test("curved tunnel: Pappus theorem holds for a centred and an off-centre section", () => {
  const R = 200;
  const a: Alignment3D = { h: buildHorizontal([{ x: 0, y: 0 }, { x: 300, y: 0, radius: R }, { x: 300 + 300 * Math.cos(1), y: 300 * Math.sin(1) }]),
                           v: [{ station: 0, z: 10 }, { station: 1000, z: 10 }] };
  const arc = a.h[1];
  const st = sampleStations(a, arc.s0, arc.s0 + arc.length, 0.0005);
  const centred = boundary(tbm.profile, 0, 0);
  const shifted: UV[] = centred.map(([x, y]) => [x + 3, y]);  // 3 m to the right (outside of this left-hand curve)
  for (const [ring, xc] of [[centred, 0], [shifted, 3]] as const) {
    const m = sweepSolid(frames(a, st, O), ring);
    assert.ok(isClosedOriented(m));
    const expected = polyArea(ring) * arc.length * (1 + xc / R);
    assert.ok(rel(meshVolume(m), expected) < 5e-6, `xc=${xc}: ${meshVolume(m)} vs ${expected}`);
  }
});

test("layer rings: closed solids whose volumes add up to the excavation", () => {
  const a = straight(0.01), st = sampleStations(a, 0, 500);
  const b = boundaries(natm), fr = frames(a, st, [1000, 2000, 0]);
  const clear = sweepSolid(fr, b.rings[0]);
  const layers = b.rings.slice(1).map((r, i) => sweepAnnulus(fr, b.rings[i], r));
  const exc = sweepSolid(fr, b.excavation);
  for (const m of [clear, ...layers, exc]) assert.ok(isClosedOriented(m), "closed");
  const sum = meshVolume(clear) + layers.reduce((x, m) => x + meshVolume(m), 0);
  assert.ok(rel(sum, meshVolume(exc)) < 1e-9, `${sum} vs ${meshVolume(exc)}`);
  assert.ok(rel(meshVolume(layers[0]), (polyArea(b.rings[1]) - polyArea(b.rings[0])) * 500) < 1e-9);
});
