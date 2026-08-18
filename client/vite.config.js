import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { spawnSync } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_PORT = 7777;

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

function tailscaleIpv4() {
  const result = spawnSync("tailscale", ["ip", "-4"], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  const ip = (result.stdout || "").trim().split(/\s+/)[0];
  return ip || null;
}

function tailscaleBridgePlugin(ip, port) {
  return {
    name: "dicta-tailscale-bridge",
    configureServer(server) {
      /** @type {import("net").Server | undefined} */
      let bridge;
      const start = () => {
        bridge = net.createServer((client) => {
          const upstream = net.connect(port, "127.0.0.1");
          const close = () => {
            client.destroy();
            upstream.destroy();
          };
          client.pipe(upstream);
          upstream.pipe(client);
          client.on("error", close);
          upstream.on("error", close);
        });
        bridge.listen(port, ip, () => {
          console.log(`[tailscale] inbox http://${ip}:${port}/`);
        });
        bridge.on("error", (error) => {
          console.warn(`[tailscale] could not bind ${ip}:${port} (${error.message})`);
        });
      };
      const httpServer = server.httpServer;
      if (!httpServer) return;
      if (httpServer.listening) start();
      else httpServer.once("listening", start);
      httpServer.once("close", () => bridge?.close());
    },
  };
}

const http = readHttp();
const tailscaleOn =
  http.tailscale || process.env.DICTA_TAILSCALE === "1" || process.env.DICTA_TAILSCALE === "true";
const tailscaleIp = tailscaleOn ? tailscaleIpv4() : null;
const target = `http://${http.host}:${http.port}`;

if (tailscaleOn && !tailscaleIp) {
  console.warn(
    "[tailscale] enabled but `tailscale ip -4` did not return an address; inbox stays on 127.0.0.1:7777"
  );
}

export default defineConfig({
  plugins: [sveltekit(), ...(tailscaleIp ? [tailscaleBridgePlugin(tailscaleIp, UI_PORT)] : [])],
  server: {
    port: UI_PORT,
    strictPort: true,
    host: "127.0.0.1",
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
    port: UI_PORT,
    strictPort: false,
    host: "127.0.0.1",
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@use "src/variables.scss" as *;',
      },
    },
  },
});
