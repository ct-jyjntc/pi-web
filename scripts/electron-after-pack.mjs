// electron-builder afterPack: force-copy Next standalone node_modules.
// FileMatcher injects an exclude for node_modules which strips deps from extraResources.
import { cpSync, existsSync, rmSync } from "fs";
import { join } from "path";

export default async function afterPack(context) {
  const projectDir = context.packager.projectDir;
  const appOutDir = context.appOutDir;
  const productFilename = context.packager.appInfo.productFilename;

  const srcNm = join(projectDir, ".next", "standalone", "node_modules");
  if (!existsSync(srcNm)) {
    throw new Error(`Missing ${srcNm} — run npm run build:electron first`);
  }

  const resourcesDir =
    context.electronPlatformName === "darwin"
      ? join(appOutDir, `${productFilename}.app`, "Contents", "Resources")
      : join(appOutDir, "resources");

  const destStandalone = join(resourcesDir, "standalone");
  const destNm = join(destStandalone, "node_modules");

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
}
