/** Single uploaded file size cap for /api/files uploads. */
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

/** Sum of file sizes in one multipart upload. */
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;

/**
 * Complete wire-body budget for multipart uploads (files + boundaries/headers).
 * Must stay ≤ next.config experimental.proxyClientMaxBodySize.
 */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;

export const UPLOAD_FILE_TOO_LARGE_ERROR = "Each upload must be 25MB or smaller";
export const UPLOAD_TOTAL_TOO_LARGE_ERROR = "Uploads must total 100MB or less";
