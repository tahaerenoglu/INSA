/** Phase 1 · Task 2: exports go only to server-controlled, per-project storage. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, MemoryStores, ArtifactStore, Actor } from "@insa/core";
import { bimModule } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const reason = (r: string) => (e: unknown) => (e as any).reason === r;

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "insa-exp-"));
  const root = path.join(base, "data");
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), artifacts: new ArtifactStore(root) });
  return { base, root: fs.realpathSync(root), p };
}
async function model(p: Platform, project: string, name = "Örnek Ofis") {
  await p.execute(user, project, "bim_set_project", { name });
  await p.execute(user, project, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
}
/** every file under base, relative */
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? files(path.join(dir, d.name)).map((f) => path.join(d.name, f)) : [d.name]);

test("1+2+8 · IFC and FRAG exports succeed and stay inside <root>/<project>/exports; results carry metadata, not paths", async () => {
  const { p, root } = setup();
  await model(p, "ofis");
  const ifc: any = (await p.execute(user, "ofis", "bim_export_ifc", {}) as any).result;
  const frag: any = (await p.execute(user, "ofis", "bim_export_frag", { name: "viewer copy" }) as any).result;
  assert.deepEqual(Object.keys(ifc.artifact).sort(), ["bytes", "createdAt", "id", "kind", "project", "sha256"]);
  assert.equal(ifc.artifact.id, "Örnek_Ofis.ifc"); assert.equal(frag.artifact.id, "viewer copy.frag");
  assert.equal(ifc.path, undefined);
  for (const a of [ifc.artifact, frag.artifact]) {
    const full = path.join(root, "ofis", "exports", a.id);
    assert.ok(fs.realpathSync(full).startsWith(path.join(root, "ofis", "exports") + path.sep));
    assert.equal(fs.statSync(full).size, a.bytes);
  }
  assert.match(fs.readFileSync(path.join(root, "ofis", "exports", ifc.artifact.id), "utf8"), /FILE_SCHEMA\(\('IFC4'\)\)/);
  assert.deepEqual(files(root).sort(), ["ofis/exports/viewer copy.frag", "ofis/exports/Örnek_Ofis.ifc"].map((f) => f.split("/").join(path.sep)).sort());
});

test("3+4+5 · traversal, nested traversal and absolute paths are rejected (as name and as the removed path argument)", async () => {
  const { p, base } = setup();
  await model(p, "ofis");
  const before = files(base);
  const bad = ["../x", "../../outside", "a/../../b", "sub/x", "..\\..\\x", "/tmp/abs", "C:\\abs", "/etc/passwd", "..", ".", ".hidden"];
  for (const name of bad)
    for (const tool of ["bim_export_ifc", "bim_export_frag"])
      await assert.rejects(p.execute(user, "ofis", tool, { name }), reason("INVALID_EXPORT_PATH"), `${tool} ${name}`);
  for (const pathArg of ["/tmp/pwned.ifc", "../../pwned.ifc", "exports/x.ifc", ""])
    await assert.rejects(p.execute(user, "ofis", "bim_export_ifc", { path: pathArg }), reason("INVALID_EXPORT_PATH"));
  assert.deepEqual(files(base), before, "no file written anywhere");
  assert.equal(fs.existsSync("/tmp/pwned.ifc"), false);
});

test("6 · malformed names are rejected; server-chosen names are sanitised", async () => {
  const { p } = setup();
  await model(p, "ofis", "A/B\\C:..*?<>|  proje\u0000");
  for (const name of ["", " ", "x\u0000y", "a\nb", "con", "NUL.ifc", "x".repeat(101), "trailing.", "trailing ", "a:b", "a*b", "a|b"])
    await assert.rejects(p.execute(user, "ofis", "bim_export_ifc", { name }), reason("INVALID_EXPORT_PATH"), JSON.stringify(name));
  const r: any = (await p.execute(user, "ofis", "bim_export_ifc", {}) as any).result;
  assert.match(r.artifact.id, /^[\p{L}\p{N}][\p{L}\p{N}_.-]*\.ifc$/u);
  assert.ok(!r.artifact.id.includes(".."));
});

test("7 · project A cannot write into project B's storage", async () => {
  const { p, root } = setup();
  await model(p, "proje-a"); await model(p, "proje-b");
  await p.execute(user, "proje-b", "bim_export_ifc", { name: "b-model" });
  for (const name of ["../proje-b/exports/b-model", "../../proje-b/exports/b-model", "proje-b/exports/b-model"])
    await assert.rejects(p.execute(user, "proje-a", "bim_export_ifc", { name }), reason("INVALID_EXPORT_PATH"));
  const bBefore = fs.readFileSync(path.join(root, "proje-b", "exports", "b-model.ifc"));
  await p.execute(user, "proje-a", "bim_export_ifc", { name: "b-model" });            // same name, own project
  assert.deepEqual(fs.readFileSync(path.join(root, "proje-b", "exports", "b-model.ifc")), bBefore);
  assert.ok(fs.existsSync(path.join(root, "proje-a", "exports", "b-model.ifc")));
  assert.throws(() => p.requireArtifacts().resolve("proje-a", "../proje-b/exports/b-model.ifc"), reason("INVALID_EXPORT_PATH"));
});

test("8 · a symlinked export directory cannot redirect writes outside the root", async () => {
  const { p, root, base } = setup();
  await model(p, "ofis");
  const outside = path.join(base, "outside"); fs.mkdirSync(outside);
  fs.mkdirSync(path.join(root, "ofis"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "ofis", "exports"));
  await assert.rejects(p.execute(user, "ofis", "bim_export_ifc", {}), reason("INVALID_EXPORT_PATH"));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("downloads resolve only existing artifacts of the same project", async () => {
  const { p } = setup();
  await model(p, "ofis");
  const r: any = (await p.execute(user, "ofis", "bim_export_ifc", { name: "m" }) as any).result;
  const store = p.requireArtifacts();
  assert.ok(store.resolve("ofis", r.artifact.id).path.endsWith("m.ifc"));
  for (const id of ["../../events.jsonl", "..%2F..%2Fx.ifc", "x.txt", "/etc/passwd"]) assert.throws(() => store.resolve("ofis", id), reason("INVALID_EXPORT_PATH"), id);
  assert.throws(() => store.resolve("ofis", "missing.ifc"), reason("ARTIFACT_NOT_FOUND"));
  assert.deepEqual(store.list("ofis").map((a) => a.id), ["m.ifc"]);
});

test("export tools fail with a generic internal error when no export storage is configured (no silent fallback to a path)", async () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  await model(p, "ofis");
  await assert.rejects(p.execute(user, "ofis", "bim_export_ifc", {}), /not configured/);
});
