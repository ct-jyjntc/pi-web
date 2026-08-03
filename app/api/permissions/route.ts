/**
 * Permissions API — mode (yolo) + fine-grained policy document for the
 * @gotgenes/pi-permission-system extension config.
 */
import { NextResponse } from "next/server";
import { getPermissionMode, setPermissionMode, type PermissionMode } from "@/lib/permission-mode";
import {
  defaultPermissionPolicy,
  ensurePermissionPolicyFile,
  readPermissionPolicy,
  writePermissionPolicy,
  type PermissionPolicyDocument,
} from "@/lib/permission-policy";

export const dynamic = "force-dynamic";

// GET /api/permissions — mode + policy
export async function GET() {
  try {
    const mode = getPermissionMode();
    const { path, exists, policy } = readPermissionPolicy();
    return NextResponse.json({
      ...mode,
      policyPath: path,
      policyExists: exists,
      policy,
      defaultPolicy: defaultPermissionPolicy(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// POST /api/permissions
//  body: { mode: "ask" | "full" }
//     or { action: "ensure" }
//     or { action: "reset-defaults" }
//     or { action: "save-policy", policy: { ... } }
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      mode?: string;
      action?: string;
      policy?: PermissionPolicyDocument;
    };

    if (body.action === "ensure") {
      const ensured = ensurePermissionPolicyFile();
      return NextResponse.json({
        ok: true,
        created: ensured.created,
        path: ensured.path,
        policy: ensured.policy,
        ...getPermissionMode(),
      });
    }

    if (body.action === "reset-defaults") {
      const yolo = getPermissionMode().yoloMode;
      const policy = writePermissionPolicy({
        ...defaultPermissionPolicy(),
        yoloMode: yolo,
      }).policy;
      return NextResponse.json({ ok: true, policy, ...getPermissionMode() });
    }

    if (body.action === "save-policy") {
      if (!body.policy || typeof body.policy !== "object" || Array.isArray(body.policy)) {
        return NextResponse.json({ error: "policy object required" }, { status: 400 });
      }
      // Preserve yoloMode from current mode if omitted.
      const current = getPermissionMode();
      const next: PermissionPolicyDocument = {
        ...body.policy,
        yoloMode: typeof body.policy.yoloMode === "boolean"
          ? body.policy.yoloMode
          : current.yoloMode,
      };
      if (!next.permission || typeof next.permission !== "object") {
        return NextResponse.json({ error: "policy.permission object required" }, { status: 400 });
      }
      const { path, policy } = writePermissionPolicy(next);
      return NextResponse.json({ ok: true, path, policy, ...getPermissionMode() });
    }

    // Backward-compatible mode toggle.
    const mode = body.mode === "full" ? "full" : body.mode === "ask" ? "ask" : null;
    if (!mode) {
      return NextResponse.json(
        { error: 'mode must be "ask" or "full", or pass action ensure|reset-defaults|save-policy' },
        { status: 400 },
      );
    }
    const state = setPermissionMode(mode as PermissionMode);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
