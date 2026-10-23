#!/usr/bin/env -S npx tsx
/**
 * Human-side governance CLI:
 *   insa proposals [all] | approve <id> | reject <id> [reason] | history [n] | undo | audit [n] | whoami   [--project p]
 */
import { publicError } from "@insa/core";
import { createPlatform, actorFromEnv, DEFAULT_PROJECT } from "./runtime.js";

const args = process.argv.slice(2);
const pi = args.indexOf("--project");
const project = pi >= 0 ? args.splice(pi, 2)[1] : DEFAULT_PROJECT;
const [cmd, ...rest] = args;
const p = createPlatform();
const user = actorFromEnv("INSA_USER", { id: process.env.USERNAME ?? process.env.USER ?? "user", name: "User", kind: "human", roles: ["bim_manager"] });
const show = (x: unknown) => console.log(JSON.stringify(x, null, 2));
try {
  switch (cmd) {
    case "proposals": show((await p.store(project).readProposals()).filter((x) => rest[0] === "all" || x.status === "pending")); break;
    case "approve": show(await p.approve(user, project, rest[0])); break;
    case "reject": show(await p.reject(user, project, rest[0], rest.slice(1).join(" ") || undefined)); break;
    case "history": show(await p.history(project, Number(rest[0] ?? 20))); break;
    case "undo": show(await p.execute(user, project, "platform_undo", rest[0] ? { command_id: rest[0] } : {})); break;
    case "audit": show(await p.store(project).readAudit(Number(rest[0] ?? 30))); break;
    case "whoami": show(p.whoami(user)); break;
    default: console.log("usage: insa <proposals [all]|approve <id>|reject <id> [reason]|history [n]|undo|audit [n]|whoami> [--project <id>]");
  }
} catch (e) {
  const pe = publicError(e);
  console.error(`Error [${pe.reason}]: ${pe.message}`);
  if (pe.internal) console.error(e);
  process.exitCode = 1;
}
await p.stores.close?.();
