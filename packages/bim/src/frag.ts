/**
 * .frag output: the IFC produced by the kernel is converted with ThatOpen's
 * official IfcImporter (web-ifc geometry). Same source, two outputs.
 */
import * as path from "node:path";
import { createRequire } from "node:module";
import * as FRAGS from "@thatopen/fragments";

const require = createRequire(import.meta.url);

function webIfcDir(): string {
  return path.dirname(require.resolve("web-ifc")) + path.sep;
}

export async function ifcToFrag(ifc: string | Uint8Array): Promise<Uint8Array> {
  const importer = new FRAGS.IfcImporter();
  importer.wasm = { path: webIfcDir(), absolute: true };
  const bytes = typeof ifc === "string" ? new TextEncoder().encode(ifc) : ifc;
  // silence web-ifc's console chatter (it would corrupt an MCP stdio stream)
  const log = console.log, info = console.info;
  console.log = console.info = (...a: unknown[]) => console.error(...a);
  try {
    return await importer.process({ bytes });
  } finally {
    console.log = log; console.info = info;
  }
}
