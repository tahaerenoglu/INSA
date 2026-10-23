import { z } from "zod";
/** Visual definition only: linked to semantic material by its existing Material.id. */
export const AppearanceSchema = z.object({
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  opacity: z.number().min(0).max(1).default(1),
  metallic: z.number().min(0).max(1).default(0),
  roughness: z.number().min(0).max(1).default(.8),
  textureSize: z.tuple([z.number().positive().max(1000), z.number().positive().max(1000)]).default([2,2]),
  baseColorTexture: z.string().regex(/^tex-[a-f0-9]{32}\.jpg$/).optional(),
  normalTexture: z.string().regex(/^tex-[a-f0-9]{32}\.jpg$/).optional(),
  roughnessTexture: z.string().regex(/^tex-[a-f0-9]{32}\.jpg$/).optional(),
  normalConvention: z.enum(["OpenGL", "DirectX"]).default("OpenGL"),
  source: z.object({ provider: z.literal("Poly Haven"), assetId: z.string().regex(/^[a-z0-9_]{1,100}$/), version: z.string().max(100), resolution: z.enum(["1k","2k"]), license: z.literal("CC0") }).strict().optional(),
}).strict();
export type MaterialAppearance = z.infer<typeof AppearanceSchema>;
