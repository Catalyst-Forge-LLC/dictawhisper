import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readHttp() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
    return {
      port: cfg.http?.port ?? 8008,
      host: cfg.http?.host && cfg.http.host !== "0.0.0.0" ? cfg.http.host : "127.0.0.1",
      tailscale: cfg.http?.tailscale === true,
    };
  } catch {
    return { port: 8008, host: "127.0.0.1", tailscale: false };
  }
}

const http = readHttp();
const target = `http://${http.host}:${http.port}`;

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 7777,
    strictPort: true,
    host: http.tailscale || process.env.DICTA_TAILSCALE === "1" || process.env.DICTA_TAILSCALE === "true",
    proxy: {
      "/socket.io": { target, ws: true },
      "/health": { target },
      "/status": { target },
      "/transcribe": { target },
      "/process": { target },
      "/audio": { target },
      "/holding": { target },
      "/tags": { target },
      "/notes": { target },
      "/note": { target },
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
