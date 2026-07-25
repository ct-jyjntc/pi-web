// electron-builder afterPack: force-copy Next standalone node_modules + bundled Node.
// FileMatcher injects an exclude for node_modules which strips deps from extraResources.
import { cpSync, existsSync, rmSync } from "fs";
import { join } from "path";

export default async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;

  const srcStandalone = join(projectDir, ".next", "standalone");
  const srcNm = join(srcStandalone, "node_modules");
  const srcBin = join(srcStandalone, "bin");
  if (!existsSync(srcNm)) {
    throw new Error(`Missing ${srcNm} — run npm run build:electron first`);
  }

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
      : join(appOutDir, "resources");

  const destStandalone = join(resourcesDir, "standalone");
  const destNm = join(destStandalone, "node_modules");
  const destBin = join(destStandalone, "bin");

  if (!existsSync(destStandalone)) {
    throw new Error(`Packaged standalone missing at ${destStandalone}`);
  }

  console.log(`[afterPack] Copying node_modules → ${destNm}`);
  rmSync(destNm, { recursive: true, force: true });
  cpSync(srcNm, destNm, { recursive: true });

  if (!existsSync(join(destNm, "next", "package.json"))) {
    throw new Error("afterPack: next package still missing after copy");
  }
  console.log("[afterPack] standalone/node_modules/next OK");

  // Self-contained Node runtime (users should not need a system Node install).
  if (existsSync(srcBin)) {
    console.log(`[afterPack] Copying bundled Node runtime → ${destBin}`);
    rmSync(destBin, { recursive: true, force: true });
    cpSync(srcBin, destBin, { recursive: true });
    const nodeName = process.platform === "win32" ? "node.exe" : "node";
    if (!existsSync(join(destBin, nodeName))) {
      throw new Error(`afterPack: bundled ${nodeName} missing — run bundle-runtime-node.mjs`);
    }
    console.log("[afterPack] standalone/bin/node OK");
  } else {
    console.warn("[afterPack] Warning: standalone/bin missing — app will require system Node");
  }
}
