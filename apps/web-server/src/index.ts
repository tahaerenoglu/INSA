/** Web server entry: API + (if built) the web app. `npm run web` */
import * as fs from "node:fs";
import * as path from "node:path";
import fastifyStatic from "@fastify/static";
import { createPlatform } from "../../manager-mcp/src/runtime.js";
import { buildApp } from "./app.js";

if (fs.existsSync('.env.google.local')) process.loadEnvFile('.env.google.local');
const platform = createPlatform();
const app = buildApp({ platform, logger: true, devLogin: process.env.INSA_DEV_LOGIN !== "0" });
const dist = path.resolve(import.meta.dirname, "../../web/dist");
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
}
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
console.log(`INSA web: http://localhost:${port}`);
