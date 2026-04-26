import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML_PATH = "/tmp/gitshow-email-preview/scan-complete.html";
const ICON_PATH = resolve(import.meta.dir, "../../../apps/web/public/icon-light.png");

const port = Number(process.env.PORT ?? 4321);
const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/icon-light.png") {
      try {
        return new Response(readFileSync(ICON_PATH), {
          headers: { "content-type": "image/png" },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      try {
        return new Response(readFileSync(HTML_PATH, "utf8"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      } catch (e) {
        return new Response(`render the email first: bun scripts/preview-email.ts\n${e}`, {
          status: 500,
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`email preview → http://localhost:${server.port}`);
