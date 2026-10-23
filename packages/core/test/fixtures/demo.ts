/** Test module: counts executions of its commands so "exactly once" can be asserted. */
import { z } from "zod";
import { DomainError } from "../../src/index.js";
import type { ModuleDef } from "../../src/index.js";

export interface DemoState { n: number; items: Record<string, number>; locked: boolean; }
export const decided = { inc: 0 };

export const demo: ModuleDef<DemoState> = {
  id: "demo", title: "Demo",
  initialState: () => ({ n: 0, items: {}, locked: false }),
  apply(s, e) {
    if (e.type === "Inc") s.n++;
    if (e.type === "Set") s.items[e.payload.key] = e.payload.value;
    if (e.type === "Lock") s.locked = true;
    return s;
  },
  tools: [
    { kind: "command", effect: "write", module: "demo", name: "demo_inc", title: "", description: "", permission: "bim.write",
      input: z.object({}),
      decide: (s) => {
        if (s.locked) throw new DomainError("demo is locked");
        decided.inc++;
        return { events: [{ type: "Inc", payload: {} }], summary: { n: s.n + 1 } };
      } },
    { kind: "command", effect: "write", module: "demo", name: "demo_set", title: "", description: "", permission: "bim.write",
      input: z.object({ key: z.string(), value: z.number() }), decide: (_s, i) => ({ events: [{ type: "Set", payload: i }], summary: i }) },
    { kind: "command", effect: "write", module: "demo", name: "demo_lock", title: "", description: "", permission: "bim.write",
      input: z.object({}), decide: () => ({ events: [{ type: "Lock", payload: {} }], summary: {} }) },
  ],
};
