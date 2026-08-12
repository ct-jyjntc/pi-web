import { clearGithubAccount } from "@/lib/accounts-store";

export async function POST() {
  clearGithubAccount();
  return Response.json({ ok: true });
}
