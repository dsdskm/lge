import fs from "fs";
import https from "https";
import path from "path";

import { App, ExpressAdapter, IPlugin } from "@microsoft/teams.apps";
import { ConsoleLogger } from "@microsoft/teams.common/logging";
import { DevtoolsPlugin } from "@microsoft/teams.dev";

const sslOptions = {
  key: process.env.SSL_KEY_FILE ? fs.readFileSync(process.env.SSL_KEY_FILE) : undefined,
  cert: process.env.SSL_CRT_FILE ? fs.readFileSync(process.env.SSL_CRT_FILE) : undefined,
};

// Workaround for SDK bug in v2.0.6+: ExpressAdapter uses `instanceof http.Server`
// which fails for https.Server (extends tls.Server, not http.Server).
// Fix: create the adapter, then replace its internal http.Server with our https.Server.
const adapter = new ExpressAdapter();
if (sslOptions.cert && sslOptions.key) {
  const httpsServer = https.createServer(sslOptions, (adapter as any).express);
  (adapter as any).server = httpsServer;
}

// Only use DevtoolsPlugin locally — it crashes on Azure App Service
// because it calls parseInt() on the named pipe PORT value.
const plugins: IPlugin[] = [];
if (process.env.SSL_KEY_FILE) {
  plugins.push(new DevtoolsPlugin());
}
const app = new App({
  logger: new ConsoleLogger("tab", { level: "debug" }),
  plugins: plugins,
  httpServerAdapter: adapter,
  skipAuth: true,
});

const isDev = process.env.NODE_ENV !== "production";
const repoRoot = path.join(__dirname, "../..");

async function mountTab() {
  if (isDev) {
    // Serve the tab straight from source via Vite's dev middleware, so `pnpm dev` needs no build step.
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: repoRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
    const expressApp = (adapter as any).express;
    expressApp.use(vite.middlewares);
    expressApp.use("/tabs/home", async (req: any, res: any, next: any) => {
      try {
        const template = fs.readFileSync(path.join(repoRoot, "index.html"), "utf-8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.tab("home", path.join(__dirname, "../client"));
  }
}

(async () => {
  await mountTab();
  await app.start(process.env.PORT || 3978);
})();
