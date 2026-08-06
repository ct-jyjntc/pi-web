/**
 * Side-effect entry: register OAuth flow implementations for the packaged
 * pi-coding-agent single-file bundle.
 *
 * Upstream loads each flow with a *variable* dynamic import so browser bundlers
 * cannot follow `node:http` OAuth callback servers into the graph:
 *   importOAuthModule("./anthropic.ts") → import("./anthropic.js")
 *
 * That resolves relative to import.meta.url. After esbuild collapses coding-agent
 * into dist/index.js, those relative imports look for
 *   .../pi-coding-agent/dist/anthropic.js
 * which never exists (real files live under pi-ai/dist/auth/oauth/).
 *
 * Bun binaries call registerBunOAuthFlows() for the same reason. We register the
 * same static loaders so ModelRuntime.login works in the Electron install.
 *
 * Paths are relative file URLs (not package subpaths) so esbuild can resolve
 * them despite package.json "exports" not listing auth/oauth/*.
 *
 * IMPORTANT: these imports MUST resolve to the same physical path that the
 * coding-agent graph pulls in for load.js, otherwise esbuild emits two copies
 * of load.js and registerBundledOAuthFlowLoaders mutates the unused one.
 * coding-agent nests pi-ai under its own node_modules in the source tree.
 */
import { anthropicOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/anthropic.js";
import { githubCopilotOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/github-copilot.js";
import { kimiCodingOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/kimi-coding.js";
import { registerBundledOAuthFlowLoaders } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/load.js";
import { openaiCodexOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js";
import { openRouterOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openrouter.js";
import { createRadiusOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/radius.js";
import { xaiOAuth } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/xai.js";

registerBundledOAuthFlowLoaders({
  anthropic: () => anthropicOAuth,
  openaiCodex: () => openaiCodexOAuth,
  githubCopilot: () => githubCopilotOAuth,
  openrouter: () => openRouterOAuth,
  kimiCoding: () => kimiCodingOAuth,
  xai: () => xaiOAuth,
  radius: createRadiusOAuth,
});
