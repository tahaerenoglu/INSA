import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Serve the version-matched Fragments worker locally instead of fetching it from unpkg (works behind company proxies).
const require = createRequire(import.meta.url);
const workerFile = join(dirname(require.resolve("@thatopen/fragments")), "Worker", "worker.mjs");
const fragmentsWorker = (): Plugin => ({
  name: "fragments-worker",
  configureServer(server) {
    server.middlewares.use("/fragments-worker.mjs", (_req, res) => {
      res.setHeader("content-type", "text/javascript");
      res.end(readFileSync(workerFile));
    });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "fragments-worker.mjs", source: readFileSync(workerFile) });
  },
});
const dracoFiles=['draco_decoder.js','draco_decoder.wasm','draco_wasm_wrapper.js'];
const dracoDir=join(dirname(require.resolve('three')),'../examples/jsm/libs/draco/gltf');
const dracoAssets=():Plugin=>({name:'local-map-draco',configureServer(server){server.middlewares.use('/draco/',(req,res,next)=>{const name=req.url?.slice(1);if(!name||!dracoFiles.includes(name))return next();res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');res.end(readFileSync(join(dracoDir,name)));});},generateBundle(){for(const name of dracoFiles)this.emitFile({type:'asset',fileName:'draco/'+name,source:readFileSync(join(dracoDir,name))});}});

export default defineConfig({
  plugins: [react(), fragmentsWorker(),dracoAssets()],
  server: { port: 5173, proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 6000 },
});
