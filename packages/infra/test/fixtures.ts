import { Platform, MemoryStores, Actor } from "@insa/core";
import { infraModule } from "../src/index.js";

export const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };
export function platform() { return new Platform({ modules: [infraModule], stores: new MemoryStores() }); }

/** ~2.2 km NATM rail tunnel in ITRF96 / TM30-like coordinates (Istanbul). */
export async function buildTunnel(p: Platform, project = "demiryolu") {
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(ai, project, tool, input);
    if (r.status !== "applied") throw new Error(JSON.stringify(r));
    return r.summary;
  };
  await run("infra_set_crs", { crs: "EPSG:5254" });
  const al = await run("infra_create_alignment", { name: "Ana Hat", start_station: "0+000",
    horizontal: [{ x: 412000, y: 4561000 }, { x: 412900, y: 4561250, radius: 1200, spiral: 150 },
                 { x: 413700, y: 4561050, radius: 900, spiral: 120 }, { x: 414300, y: 4561350 }],
    vertical: [{ station: 0, z: 62 }, { station: 1100, z: 75.2, curve: 600 }, { station: 2400, z: 64.8 }] });
  await run("infra_create_section_types", { types: [
    { name: "NATM B2", profile: { shape: "horseshoe", crown_radius: 5.6, spring_y: 3.2, wall_bottom_y: 0.6, invert_depth: 1.5 },
      layers: [{ name: "İç kaplama", thickness: 0.4, material: "C30/37" }, { name: "Püskürtme beton", thickness: 0.25, material: "C25/30 lifli" }],
      overbreak: 0.15, bolts: { per_round: 12, spacing: 1.5, length: 4 } },
    { name: "NATM C3", profile: { shape: "horseshoe", crown_radius: 5.6, spring_y: 3.2, wall_bottom_y: 0.6, invert_depth: 1.5 },
      layers: [{ name: "İç kaplama", thickness: 0.45, material: "C30/37" }, { name: "Püskürtme beton", thickness: 0.3, material: "C25/30 lifli" }],
      overbreak: 0.2, bolts: { per_round: 16, spacing: 1.2, length: 6 } }] });
  const tn = await run("infra_create_tunnel", { name: "T1 Tüneli", alignment: "Ana Hat", ranges: [
    { from: "0+150", to: "1+050", section: "NATM B2" }, { from: "1+050", to: "1+420", section: "NATM C3" }, { from: "1+420", to: "2+300", section: "NATM B2" }] });
  return { alignment: al.id as string, tunnel: tn.id as string };
}
