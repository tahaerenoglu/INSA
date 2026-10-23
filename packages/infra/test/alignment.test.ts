import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHorizontal, evalElement, evalH, evalV, checkVertical, point3d, sampleStations, hLength, PI } from "../src/alignment.js";

const near = (a: number, b: number, tol: number, msg = "") => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b} (tol ${tol})`);

test("clothoid end point matches the Fresnel series", () => {
  const R = 800, Ls = 120, th = Ls / (2 * R);
  const e = evalElement({ kind: "clothoid", s0: 0, length: Ls, start: [0, 0], az0: 0, k0: 0, k1: 1 / R }, Ls);
  near(e.x, Ls * (1 - th ** 2 / 10 + th ** 4 / 216 - th ** 6 / 9360), 1e-7, "x");
  near(e.y, Ls * (th / 3 - th ** 3 / 42 + th ** 5 / 1320), 1e-7, "y");
  near(e.az, th, 1e-12, "heading");
});

test("arc-only curve: length and tangent points are exact", () => {
  const R = 500;
  const pis: PI[] = [{ x: 0, y: 0 }, { x: 1000, y: 0, radius: R }, { x: 1000 + 1000 * Math.cos(Math.PI / 6), y: 1000 * Math.sin(Math.PI / 6) }];
  const h = buildHorizontal(pis, 0);
  const D = Math.PI / 6, T = R * Math.tan(D / 2);
  assert.deepEqual(h.map((e) => e.kind), ["line", "arc", "line"]);
  near(h[1].s0, 1000 - T, 1e-9, "PC station");
  near(hLength(h), 2000 - 2 * T + R * D, 1e-9, "total length");
  const end = evalH(h, hLength(h));
  near(end.x, pis[2].x, 1e-9); near(end.y, pis[2].y, 1e-9);
});

test("spiral-arc-spiral: continuity of position, heading and curvature; p and k match the classic series", () => {
  const R = 600, Ls = 100;
  const pis: PI[] = [{ x: 0, y: 0 }, { x: 900, y: 50, radius: R, spiral: Ls }, { x: 1500, y: 600, radius: 400, spiral: 80 }, { x: 2400, y: 700 }];
  const h = buildHorizontal(pis, 1000);
  assert.deepEqual(h.map((e) => e.kind), ["line", "clothoid", "arc", "clothoid", "line", "clothoid", "arc", "clothoid", "line"]);
  for (let i = 1; i < h.length; i++) {
    const a = evalElement(h[i - 1], h[i - 1].length);
    near(a.x, h[i].start[0], 1e-9, `x@${i}`); near(a.y, h[i].start[1], 1e-9, `y@${i}`);
    near(a.az, h[i].az0, 1e-9, `az@${i}`); near(a.k, h[i].k0, 1e-12, `k@${i}`);
    near(h[i - 1].s0 + h[i - 1].length, h[i].s0, 1e-9, `station@${i}`);
  }
  const e = evalElement({ kind: "clothoid", s0: 0, length: Ls, start: [0, 0], az0: 0, k0: 0, k1: 1 / R }, Ls);
  const ths = Ls / (2 * R);
  near(e.y - R * (1 - Math.cos(ths)), Ls ** 2 / (24 * R) - Ls ** 4 / (2688 * R ** 3), 1e-6, "shift p");
  near(e.x - R * Math.sin(ths), Ls / 2 - Ls ** 3 / (240 * R ** 2) + Ls ** 5 / (34560 * R ** 4), 1e-8, "k (3-term series)");
  const end = evalH(h, h[h.length - 1].s0 + h[h.length - 1].length);
  near(end.x, 2400, 1e-6); near(end.y, 700, 1e-6);
});

test("geometric errors are reported, not silently accepted", () => {
  assert.throws(() => buildHorizontal([{ x: 0, y: 0 }, { x: 100, y: 0, radius: 50, spiral: 200 }, { x: 200, y: 20 }]), /deflection/);
  assert.throws(() => buildHorizontal([{ x: 0, y: 0 }, { x: 100, y: 0, radius: 3000 }, { x: 150, y: 80 }]), /exceeds|overlaps/);
  assert.throws(() => checkVertical([{ station: 0, z: 0 }, { station: 100, z: 1, curve: 300 }, { station: 200, z: 0 }]), /overlaps/);
});

test("vertical curve: continuity and the mid-ordinate (g2-g1)L/8 at the PVI", () => {
  const v = [{ station: 0, z: 100 }, { station: 500, z: 110, curve: 200 }, { station: 1000, z: 95 }];
  checkVertical(v);
  const g1 = 10 / 500, g2 = -15 / 500, L = 200;
  near(evalV(v, 500).z, 110 + ((g2 - g1) * L) / 8, 1e-9, "mid ordinate");
  for (const s of [400, 600]) {
    near(evalV(v, s - 1e-7).z, evalV(v, s + 1e-7).z, 1e-6, `z continuity @${s}`);
    near(evalV(v, s - 1e-7).grade, evalV(v, s + 1e-7).grade, 1e-6, `grade continuity @${s}`);
  }
  near(evalV(v, 250).z, 105, 1e-9); near(evalV(v, 750).z, 102.5, 1e-9);
});

test("sampling: every chord stays within the sagitta tolerance in plan and profile", () => {
  const a = { h: buildHorizontal([{ x: 0, y: 0 }, { x: 600, y: 0, radius: 350, spiral: 60 }, { x: 900, y: 400 }]),
              v: [{ station: 0, z: 50 }, { station: 300, z: 56, curve: 160 }, { station: 800, z: 48 }] };
  const tol = 0.002;
  const st = sampleStations(a, 0, 800, tol);
  let worst = 0;
  for (let i = 1; i < st.length; i++) {
    const p = point3d(a, st[i - 1]), q = point3d(a, st[i]), m = point3d(a, (st[i - 1] + st[i]) / 2);
    const cx = (p.x + q.x) / 2, cy = (p.y + q.y) / 2, cz = (p.z + q.z) / 2;
    worst = Math.max(worst, Math.hypot(m.x - cx, m.y - cy), Math.abs(m.z - cz));
  }
  assert.ok(worst <= tol * 1.05, `worst sagitta ${worst}`);
  assert.ok(st.length < 400, `${st.length} stations`);
});
