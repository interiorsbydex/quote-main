import fs from "node:fs";
import path from "node:path";
import { type Server } from "node:http";

import express, { type Express } from "express";
import runApp from "./app";

export async function serveStatic(app: Express, _server: Server) {
  const distPath = path.resolve(import.meta.dirname, "public");
  const indexPath = path.resolve(distPath, "index.html");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Helper to send index.html with no-cache headers
  const sendIndexWithNoCache = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath);
  };

  // Explicitly handle root path to ensure no-cache headers
  app.get('/', sendIndexWithNoCache);

  // Serve static assets (JS/CSS with hashes) with long cache
  // Exclude index.html from static middleware - we handle it separately
  app.use(express.static(distPath, {
    maxAge: '1y',
    immutable: true,
    index: false, // Disable automatic index.html serving
    setHeaders: (res, filePath) => {
      // Extra safety: if any HTML gets through, don't cache it
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  // SPA fallback - serve index.html with no-cache for any unmatched routes
  app.use("*", sendIndexWithNoCache);
}

(async () => {
  await runApp(serveStatic);
})();
