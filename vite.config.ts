import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const root = __dirname;
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  version: string;
};
let piVersion = "unknown";
try {
  piVersion = (
    JSON.parse(
      readFileSync(
        path.join(root, "node_modules/@earendil-works/pi-coding-agent/package.json"),
        "utf8",
      ),
    ) as { version: string }
  ).version;
} catch {
  // optional
}

export default defineConfig({
  root: path.join(root, "desktop"),
  publicDir: path.join(root, "public"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": root,
      "next/navigation": path.join(root, "desktop/shims/next-navigation.tsx"),
      "next/dynamic": path.join(root, "desktop/shims/next-dynamic.tsx"),
      "next/image": path.join(root, "desktop/shims/next-image.tsx"),
    },
  },
  define: {
    "process.env.NEXT_PUBLIC_APP_VERSION": JSON.stringify(pkg.version),
    "process.env.NEXT_PUBLIC_PI_VERSION": JSON.stringify(piVersion),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
  },
  css: {
    postcss: path.join(root, "postcss.config.mjs"),
  },
  build: {
    outDir: path.join(root, "desktop-dist"),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
  },
  server: {
    host: "127.0.0.1",
    port: 30143,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:30142",
        changeOrigin: true,
      },
    },
  },
});
