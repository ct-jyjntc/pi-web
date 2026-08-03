/**
 * Minimal next/server shim for the desktop daemon.
 * Route handlers and lib/api-* only need NextRequest/NextResponse.json/next.
 */
export class NextRequest extends Request {
  /**
   * @param {string | URL | Request} input
   * @param {RequestInit & { duplex?: string }} [init]
   */
  constructor(input, init) {
    super(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    this.nextUrl = new URL(url);
  }
}

export class NextResponse extends Response {
  /**
   * @param {unknown} body
   * @param {ResponseInit} [init]
   */
  static json(body, init) {
    return Response.json(body, init);
  }

  /** Middleware-compatible no-op (daemon does not chain Next middleware). */
  static next() {
    return new NextResponse(null, {
      status: 200,
      headers: { "x-middleware-next": "1" },
    });
  }

  /**
   * @param {string} url
   * @param {ResponseInit} [init]
   */
  static redirect(url, init = {}) {
    const status = typeof init === "number" ? init : init.status ?? 307;
    const headers = new Headers(typeof init === "object" ? init.headers : undefined);
    headers.set("Location", String(url));
    return new NextResponse(null, { status, headers });
  }
}

export default { NextRequest, NextResponse };
