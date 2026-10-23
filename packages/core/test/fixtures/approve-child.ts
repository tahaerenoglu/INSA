/** Child process: approves one proposal in a FileStores root and prints the outcome as JSON. */
import { Platform, FileStores, publicError } from "../../src/index.js";
import { demo } from "./demo.js";

const [root, project, proposalId, who] = process.argv.slice(2);
const p = new Platform({ modules: [demo], stores: new FileStores(root), approvalMode: "ai" });
const go = Number(process.env.START_AT ?? 0);
while (Date.now() < go) await new Promise((r) => setTimeout(r, 2));   // line up the children
try {
  const r = await p.approve({ id: who, name: who, kind: "human", roles: ["bim_manager"] }, project, proposalId);
  console.log(JSON.stringify({ ok: true, status: r.status }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, reason: publicError(e).reason }));
}
