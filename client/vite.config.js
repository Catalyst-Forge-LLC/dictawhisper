import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function apiOrigin() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    const port = cfg.http?.port ?? 8008;
    const host = cfg.http?.host && cfg.http.host !== "0.0.0.0" ? cfg.http.host : "127.0.0.1";
    return `http://${host}:${port}`;
  } catch {
    return "http://127.0.0.1:8008";
  }
}

const target = apiOrigin();

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 7777,
    strictPort: true,
    proxy: {
      "/socket.io": { target, ws: true },
      "/health": { target },
      "/status": { target },
      "/transcribe": { target },
      "/process": { target },
      "/audio": { target },
      "/tags": { target },
    },
  },
  preview: {
    port: 7777,
    strictPort: false,
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@use "src/variables.scss" as *;',
      },
    },
  },
});
