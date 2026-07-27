import { NextResponse } from "next/server";
import {
  GITHUB_LATEST_RELEASE_API,
  GITHUB_RELEASES_URL,
  GITHUB_REPO,
  getAppVersion,
  isUpdateAvailable,
} from "@/lib/app-version";

export const dynamic = "force-dynamic";

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
};

export async function GET() {
  const currentVersion = getAppVersion();
  return NextResponse.json({
    currentVersion,
    repo: GITHUB_REPO,
    releasesUrl: GITHUB_RELEASES_URL,
  });
}

/**
 * Check GitHub Releases for a newer version.
 * POST keeps the intentional "user clicked check" semantics and avoids accidental caching.
 */
export async function POST() {
  const currentVersion = getAppVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "pi-web-update-check",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(GITHUB_LATEST_RELEASE_API, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 404) {
      return NextResponse.json({
        currentVersion,
        updateAvailable: false,
        latestVersion: null,
        releaseUrl: GITHUB_RELEASES_URL,
        message: "no_releases",
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        {
          error: `GitHub API ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
          currentVersion,
        },
        { status: 502 },
      );
    }

    const release = (await res.json()) as GitHubRelease;
    const latestVersion = (release.tag_name || release.name || "").trim();
    if (!latestVersion) {
      return NextResponse.json(
        { error: "Latest release has no version tag", currentVersion },
        { status: 502 },
      );
    }

    const updateAvailable = isUpdateAvailable(currentVersion, latestVersion);
    const releaseUrl = release.html_url?.trim() || GITHUB_RELEASES_URL;

    return NextResponse.json({
      currentVersion,
      latestVersion: latestVersion.replace(/^v/i, ""),
      latestTag: latestVersion,
      updateAvailable,
      releaseUrl,
      releaseName: release.name ?? latestVersion,
      publishedAt: release.published_at ?? null,
      prerelease: release.prerelease === true,
      repo: GITHUB_REPO,
      releasesUrl: GITHUB_RELEASES_URL,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: aborted
          ? "Update check timed out"
          : error instanceof Error
            ? error.message
            : String(error),
        currentVersion,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
