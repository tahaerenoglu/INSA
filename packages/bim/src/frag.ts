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

let conversionQueue:Promise<unknown>=Promise.resolve();
export function ifcToFrag(ifc: string | Uint8Array, diagnostics?:{onGeometryWarning?:(id:number)=>void}): Promise<Uint8Array> {
 const convert=async()=>{
  const importer = new FRAGS.IfcImporter();
  importer.wasm = { path: webIfcDir(), absolute: true };
  const bytes = typeof ifc === "string" ? new TextEncoder().encode(ifc) : ifc;
  // silence web-ifc's console chatter (it would corrupt an MCP stdio stream)
  const log = console.log, info = console.info;
  console.log = console.info = (...a: unknown[]) => {
    const match=String(a[0]??'').match(/^Fragments: Problematic geometry: (\d+)/);
    if(match)diagnostics?.onGeometryWarning?.(Number(match[1]));
    console.error(...a);
  };
  try {
    return await importer.process({ bytes });
  } finally {
    console.log = log; console.info = info;
  }
 };
 // Importer diagnostics use global console methods; serialize conversions so
 // warnings cannot be attributed to another user's source model.
 const pending=conversionQueue.then(convert);conversionQueue=pending.catch(()=>{});return pending;
}
