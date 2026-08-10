/**
 * Wire constants for the RAINFLOWTB subscription provider (Pi-Web).
 * Server-only, shared with lib/rainflowtb-provider.ts.
 *
 * RAINFLOWTB runs the LocalApi OAuth broker service (see LocalApi repo,
 * docs/pi-web-oauth.md) at api.rainflowtb.com. Override the instance URL
 * with RAINFLOWTB_BASE_URL when testing against a staging instance.
 */
export const RAINFLOWTB_PROVIDER_ID = "rainflowtb";
export const RAINFLOWTB_DISPLAY_NAME = "RAINFLOWTB";
export const RAINFLOWTB_BASE_URL = (
  process.env.RAINFLOWTB_BASE_URL || "https://api.rainflowtb.com"
).replace(/\/+$/, "");

/** Wallet channel: OpenAI-compatible proxy, billed from the wallet balance. */
export const RAINFLOWTB_WALLET_BASE_URL = `${RAINFLOWTB_BASE_URL}/v1`;
/** Subscription channel: same proxy shape, gated by the Coding Plan. */
export const RAINFLOWTB_CODING_BASE_URL = `${RAINFLOWTB_BASE_URL}/coding/v1`;

export const RAINFLOWTB_LOGIN_URL = `${RAINFLOWTB_BASE_URL}/oauth/login`;
export const RAINFLOWTB_CHECK_URL = `${RAINFLOWTB_BASE_URL}/oauth/check`;
export const RAINFLOWTB_TOKEN_URL = `${RAINFLOWTB_BASE_URL}/oauth/token`;
export const RAINFLOWTB_REFRESH_URL = `${RAINFLOWTB_BASE_URL}/oauth/refresh`;
