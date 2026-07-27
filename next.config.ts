import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // Minimal server bundle for Electron packaging (see electron/main.js + dist:dmg)
  output: "standalone",
  // Keep output tracing inside pi-web. On Windows, an inferred workspace root
  // can traverse protected user-profile junctions such as Application Data.
  outputFileTracingRoot: __dirname,
  // Parent Desktop/ sometimes has a package-lock.json — pin Turbopack root to this app.
  turbopack: {
    root: __dirname,
  },
  experimental: {
    optimizePackageImports: ["@lobehub/icons"],
    // Default is 10MB; uploads allow up to ~101MB wire body before our 413 checks run.
    proxyClientMaxBodySize: "105mb",
  },
  serverExternalPackages: [
    "undici",
    "node-pty",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  allowedDevOrigins: ['192.168.*.*'],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
