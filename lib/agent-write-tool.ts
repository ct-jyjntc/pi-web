/**
 * Pi Web write tool — SDK write with workspace-turn journal recording.
 * Single owner for write-path mutation capture (pairs with agent-edit-tool).
 */
import { existsSync, readFileSync } from "fs";
import { mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { recordFileMutation } from "./workspace-turn-journal";

export type PiWebWriteToolOptions = {
  getSessionId?: () => string | undefined;
};

export function createPiWebWriteToolDefinition(
  cwd: string,
  options: PiWebWriteToolOptions = {},
): ReturnType<typeof createWriteToolDefinition> {
  return createWriteToolDefinition(cwd, {
    operations: {
      mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
      writeFile: async (absolutePath, content) => {
        let before: string | null = null;
        if (existsSync(absolutePath)) {
          try {
            before = readFileSync(absolutePath, "utf8");
          } catch {
            before = null;
          }
        }
        await fsWriteFile(absolutePath, content, "utf-8");
        const sessionId = options.getSessionId?.();
        if (sessionId) {
          recordFileMutation(sessionId, {
            path: absolutePath,
            kind: before == null ? "create" : "edit",
            before,
            after: content,
          });
        }
      },
    },
  });
}
