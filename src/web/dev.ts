import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import { createHarness } from "../core/harness";
import { createWebHost } from "./server";

const args = process.argv.slice(2);
function argument(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}
const host = argument("--host", "127.0.0.1");
const port = Number(argument("--port", "5173"));
if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === "0.0.0.0" || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Use a specific IPv4 address and a port between 1024 and 65535.");
}
const service = await createHarness();
const web = await createWebHost({ service, workspace: argument("--workspace", process.cwd()), host, port });
const vite = await createViteServer({
  configFile: false,
  root: "src/renderer",
  base: "/",
  plugins: [react(), {
    name: "forge-web-dev-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // Only this Web dev host relaxes the file-origin desktop CSP for React HMR.
        return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          .replace("connect-src 'none';", `connect-src 'self' ws://${host}:${port};`);
      },
    },
  }],
  server: {
    middlewareMode: true,
    allowedHosts: [host],
    hmr: { server: web.server, host, port },
    fs: { strict: true, allow: [process.cwd()], deny: ["**/.env*", "**/*.{crt,pem,key}", "**/.git/**", "**/.local/**", "**/.config/**", "**/.build/**"] },
  },
});
web.server.on("request", (request, response) => {
  void web.handle(request, response, () => vite.middlewares(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end("Web service unavailable");
  });
});
await new Promise<void>((done, reject) => {
  web.server.once("error", reject);
  web.server.listen(port, host, done);
});
console.log(`Forge Web Dev: ${web.origin}`);
console.log(`Workspace: ${web.workspace}`);
console.log(`Access passphrase: ${web.token}`);
console.log("Trusted LAN only (HTTP). One controlling page; runs survive reload/disconnect. Renderer HMR enabled; restart for backend changes.");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void Promise.allSettled([vite.close(), web.close()]).then(() => process.exit(0));
});
