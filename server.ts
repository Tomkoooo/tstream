import { loadEnvConfig } from "@next/env";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { attachSignaling } from "./src/server/io";

// `tsx server.ts` does not load .env* files; match Next.js so PORT etc. from .env.local apply.
loadEnvConfig(process.cwd());

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void (async () => {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "", true);
    void handle(req, res, parsedUrl);
  });

  attachSignaling(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
