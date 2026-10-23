/** Shared runtime: platform + modules + store selection + actor from the environment. */
import * as path from "node:path";
import {filesModule} from "@insa/files";
import { modelingModule } from './modeling.js';
import { Platform, FileStores, PostgresStores, StoreProvider, Actor, ApprovalMode, ArtifactStore, DomainError } from "@insa/core";
import { bimModule,georefProblem,toLocal,toMap } from "@insa/bim";
import { infraModule,platformTerrainCoordinates,loadTerrain,terrainSignature,roadTerrainCompatibility,validateCadCoordinates,validateVerticalCoordinates } from "@insa/infra";

export const DATA = process.env.INSA_DATA ?? path.resolve("data");
export const DEFAULT_PROJECT = process.env.INSA_PROJECT ?? "default";

/** INSA_PG_URL set -> PostgreSQL (multi-user, multi-process); otherwise JSON files in INSA_DATA. */
export function createStores(): StoreProvider {
  return process.env.INSA_PG_URL ? new PostgresStores(process.env.INSA_PG_URL) : new FileStores(DATA);
}

export function createPlatform(stores: StoreProvider = createStores(),artifacts:ArtifactStore=new ArtifactStore(DATA)): Platform {
  const platform=new Platform({ modules: [bimModule, infraModule, filesModule, modelingModule], stores, artifacts,
                        validateProject(after,before,terrainProject) {
                          const materials=after.get('bim')?.materials??{},g=after.get('bim')?.project?.georef;
                          for(const alignment of Object.values(after.get('infra')?.alignments??{}) as any[]){if(alignment.cadSource&&alignment.cadSource.identity!==before.get('infra')?.alignments?.[alignment.id]?.cadSource?.identity){if(!g||georefProblem(g))throw new DomainError('CAD conversion requires a valid project georeference.','INCOMPATIBLE_CRS');validateCadCoordinates(after.get('infra'),g,alignment.cadSource.configuration);}}
                          for(const a of Object.values(after.get('infra')?.alignments??{}) as any[]){if(a.verticalSource&&a.verticalSource.revision!==before.get('infra')?.alignments?.[a.id]?.verticalSource?.revision){if(!g||georefProblem(g))throw new DomainError('Vertical conversion requires a valid existing georeference.','INCOMPATIBLE_CRS');validateVerticalCoordinates(after.get('infra'),g,a.verticalSource.configuration);}}
                          for(const terrain of Object.values(after.get('infra')?.terrains??{}) as any[]){
                            if(!g||georefProblem(g))throw new DomainError('Terrain import requires a valid existing BIM project georeference.','INCOMPATIBLE_CRS');
                            if(terrain.sourceCrs.toUpperCase()!==g.crs.name.trim().toUpperCase())throw new DomainError('Terrain/project CRS differs; reprojection is unsupported.','INCOMPATIBLE_CRS');
                            if(terrain.verticalDatum.name&&g.crs.verticalDatum&&terrain.verticalDatum.name!==g.crs.verticalDatum)throw new DomainError('Terrain/project vertical datums differ; conversion is unsupported.','INCOMPATIBLE_DATUM');
                            if(terrain.materialId&&!materials[terrain.materialId])throw new DomainError('Terrain BIM material does not exist or is in use.','INVALID_REFERENCE');
                            if(terrain.asset!==`terrain-${terrain.sourceHash}.xml`||terrain.geometrySignature!==terrainSignature(terrain.sourceHash,terrain.surfaceName,terrain.xyUnit,terrain.zUnit))throw new DomainError('Invalid terrain asset/signature.','INVALID_TERRAIN');
                            if(terrain.geometrySignature!==before.get('infra')?.terrains?.[terrain.id]?.geometrySignature)loadTerrain(artifacts,terrainProject,terrain);
                          }

                          for(const d of Object.values(after.get('infra')?.earthworks??{}) as any[]){const terrain=after.get('infra')?.terrains?.[d.terrain];roadTerrainCompatibility(after.get('infra')?.crs,terrain,g);if(d.revision!==before.get('infra')?.earthworks?.[d.id]?.revision)loadTerrain(artifacts,terrainProject,terrain);}
                          const owners=[...Object.values(after.get('infra')?.sections??{}),...Object.values(after.get('infra')?.roads??{}),...Object.values(after.get('infra')?.componentTypes??{}).map((t:any)=>({id:t.id,layers:[t.layer]}))] as any[];
                          for(const section of owners)
                            for(const layer of section.layers) if(layer.materialId&&!materials[layer.materialId]) {
                              const removed=before.get('bim')?.materials?.[layer.materialId];
                              throw new DomainError(`${section.id}/${layer.id}: BIM material ${layer.materialId} ${removed?'is in use':'does not exist in this project'}.`,removed?'RESOURCE_IN_USE':'INVALID_REFERENCE');
                            }
                        },
                        approvalMode: (process.env.INSA_APPROVAL as ApprovalMode) ?? "auto" });
  platformTerrainCoordinates.set(platform,{toLocal,toMap});return platform;
}

export function actorFromEnv(prefix: string, fallback: Actor): Actor {
  const e = (k: string) => process.env[`${prefix}_${k}`];
  return {
    id: e("ID") ?? fallback.id,
    name: e("NAME") ?? fallback.name,
    kind: (e("KIND") as Actor["kind"]) ?? fallback.kind,
    roles: e("ROLES")?.split(",").map((r) => r.trim()).filter(Boolean) ?? fallback.roles,
  };
}

