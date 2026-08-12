import {
  fetchGithubUser,
  GITHUB_OAUTH_SCOPES,
  githubOAuthClientId,
  pollGithubDeviceFlow,
  sleep,
  startGithubDeviceFlow,
} from "@/lib/github-oauth";
import { setGithubAccount } from "@/lib/accounts-store";

export const dynamic = "force-dynamic";

// GET /api/accounts/github/connect — SSE stream: device-code flow that stores
// the connected account server-side, then emits `success` with the user info.
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const clientId = githubOAuthClientId();
        const flow = await startGithubDeviceFlow(clientId, GITHUB_OAUTH_SCOPES);

        send(controller, {
          type: "device_code",
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          intervalSeconds: flow.intervalSeconds,
          expiresInSeconds: flow.expiresInSeconds,
        });

        const deadline = Date.now() + flow.expiresInSeconds * 1000;
        // RFC 8628: wait `interval` before the first poll, then keep that
        // interval (raise on slow_down, cap 10s).
        let intervalMs = Math.max(5, flow.intervalSeconds) * 1000;
        await sleep(intervalMs, abort.signal);
        while (Date.now() < deadline) {
          if (abort.signal.aborted) {
            send(controller, { type: "cancelled" });
            return;
          }
          const result = await pollGithubDeviceFlow(clientId, flow.deviceCode);
          if (result.status === "success") {
            const user = await fetchGithubUser(result.accessToken);
            setGithubAccount({
              token: result.accessToken,
              login: user.login,
              name: user.name,
              avatarUrl: user.avatarUrl,
              scopes: GITHUB_OAUTH_SCOPES.split(" "),
              connectedAt: Date.now(),
            });
            send(controller, {
              type: "success",
              login: user.login,
              name: user.name,
              avatarUrl: user.avatarUrl,
            });
            return;
          }
          if (result.status === "error") {
            send(controller, { type: "error", message: result.message });
            return;
          }
          if (result.slowDown) intervalMs = Math.min(intervalMs + 5_000, 10_000);
          await sleep(intervalMs, abort.signal);
        }
        send(controller, { type: "error", message: "The login code expired — please try again" });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        send(controller, {
          type: msg === "Login cancelled" ? "cancelled" : "error",
          message: msg,
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
