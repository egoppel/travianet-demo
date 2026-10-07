import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/index.ts"],
  platform: "node",
  target: "node22",
  bundle: true,
  format: "esm",
  outfile: "dist/index.mjs",
  sourcemap: "linked",
  logLevel: "info",
  // pino-pretty is only used in development and loaded dynamically via a transport
  external: ["pino-pretty"],
  banner: {
    // CJS deps bundled into ESM still call require() for node built-ins
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
