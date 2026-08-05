/**
 * Single owner for renderer → agent runtime calls.
 *
 * Every `/api/*` request and every event stream goes through here, so the
 * transport underneath can change without touching the ~50 call sites.
 *
 * Desktop (`window.piApi`) talks to the runtime over Electron IPC. The runtime
 * used to be an HTTP server that also served this app's code-split chunks, so
 * loading the agent SDK — seconds of synchronous work — stalled the JavaScript
 * the window needed to render. Off HTTP, a slow runtime can only delay data.
 *
 * `apiFetch` resolves to a real `Response` either way, so `res.ok` / `res.json()`
 * and every other call-site expectation behave identically.
 */

type StreamMessage = {
  t: "open" | "chunk" | "end" | "err";
  streamId: string;
  status?: number;
  headers?: Record<string, string>;
  /** base64 — the IPC channel is JSON, see daemon/ipc-host.mjs */
  chunk?: string;
  message?: string;
};

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked to stay under the argument-count limit on large uploads.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

type PiApi = {
  request: (payload: {
    path: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    bodyEncoding?: "utf8" | "base64";
    requestId: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  abort: (requestId: string) => void;
  streamOpen: (payload: { streamId: string; path: string }) => void;
  streamClose: (streamId: string) => void;
  onStreamEvent: (callback: (message: StreamMessage) => void) => () => void;
};

declare global {
  interface Window {
    piApi?: PiApi;
  }
}

function bridge(): PiApi | undefined {
  return typeof window === "undefined" ? undefined : window.piApi;
}

/** The slice of `EventSource` the app actually uses. */
export type ApiStream = {
  addEventListener: (type: string, handler: (event: MessageEvent) => void) => void;
  removeEventListener: (type: string, handler: (event: MessageEvent) => void) => void;
  set onmessage(handler: ((event: MessageEvent) => void) | null);
  set onerror(handler: ((event: Event) => void) | null);
  /** Mirrors `EventSource.readyState`: 0 connecting, 1 open, 2 closed. */
  readonly readyState: number;
  close: () => void;
};

/** `EventSource.CLOSED` without depending on the DOM class being the transport. */
export const API_STREAM_CLOSED = 2;

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const api = bridge();
  if (!api) return fetch(path, init);

  const headers = new Headers(init?.headers);
  const headerObject: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerObject[key] = value;
  });

  let body: string | undefined;
  let bodyEncoding: "utf8" | "base64" | undefined;
  if (init?.body != null) {
    if (typeof init.body === "string") {
      body = init.body;
      bodyEncoding = "utf8";
    } else {
      // Uint8Array / ArrayBuffer / FormData / Blob / URLSearchParams: let Request
      // do the encoding, then forward the bytes plus the content-type it picked.
      const encoded = new Request("http://desktop.invalid/", {
        method: init.method && init.method.toUpperCase() !== "GET" ? init.method : "POST",
        body: init.body as BodyInit,
      });
      body = bytesToBase64(new Uint8Array(await encoded.arrayBuffer()));
      bodyEncoding = "base64";
      const contentType = encoded.headers.get("content-type");
      if (contentType && !headers.has("content-type")) headerObject["content-type"] = contentType;
    }
  }

  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Tell the runtime to stop too. Without this an aborted request keeps running
  // there and its work queues ahead of whatever the user is now waiting for.
  requestSeq += 1;
  const requestId = `c${requestSeq}`;
  const onAbort = () => api.abort(requestId);
  init?.signal?.addEventListener("abort", onAbort, { once: true });

  let reply;
  try {
    reply = await api.request({
      path,
      method: (init?.method || "GET").toUpperCase(),
      headers: headerObject,
      body,
      bodyEncoding,
      requestId,
    });
  } finally {
    init?.signal?.removeEventListener("abort", onAbort);
  }

  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // 204/205/304 must not carry a body or the Response constructor throws.
  const empty = reply.status === 204 || reply.status === 205 || reply.status === 304;
  const replyBody = empty ? null : base64ToArrayBuffer(reply.body);
  return new Response(replyBody, {
    status: reply.status,
    headers: reply.headers,
  });
}

/**
 * Minimal `text/event-stream` framing. EventSource does this for us over HTTP;
 * over IPC we receive raw bytes and have to split events ourselves.
 * Exported for lib/api-transport.test.mjs.
 */
export function createSseParser(emit: (type: string, data: string) => void) {
  const decoder = new TextDecoder();
  let buffer = "";
  return (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffer);
      if (!boundary) break;
      const raw = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);

      let type = "message";
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line === "" || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") type = value;
        else if (field === "data") data.push(value);
      }
      if (data.length > 0 || type !== "message") emit(type, data.join("\n"));
    }
  };
}

let requestSeq = 0;
let streamSeq = 0;

export function apiStream(path: string): ApiStream {
  const api = bridge();
  if (!api) {
    const source = new EventSource(path);
    return {
      addEventListener: (type, handler) => source.addEventListener(type, handler as EventListener),
      removeEventListener: (type, handler) =>
        source.removeEventListener(type, handler as EventListener),
      set onmessage(handler: ((event: MessageEvent) => void) | null) {
        source.onmessage = handler;
      },
      set onerror(handler: ((event: Event) => void) | null) {
        source.onerror = handler;
      },
      get readyState() {
        return source.readyState;
      },
      close: () => source.close(),
    };
  }

  streamSeq += 1;
  const streamId = `s${streamSeq}`;
  const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let errorHandler: ((event: Event) => void) | null = null;
  let readyState = 0;

  const emit = (type: string, data: string) => {
    const event = new MessageEvent(type, { data });
    if (type === "message") messageHandler?.(event);
    for (const handler of listeners.get(type) ?? []) handler(event);
  };
  const parse = createSseParser(emit);

  const unsubscribe = api.onStreamEvent((message) => {
    if (message.streamId !== streamId) return;
    if (message.t === "open") {
      readyState = 1;
      return;
    }
    if (message.t === "chunk" && message.chunk) {
      parse(new Uint8Array(base64ToArrayBuffer(message.chunk)));
      return;
    }
    // `end` and `err` are both terminal: EventSource surfaces a closed stream as
    // an error event, and callers already branch on readyState to decide whether
    // to reconnect.
    readyState = API_STREAM_CLOSED;
    unsubscribe();
    errorHandler?.(new Event("error"));
  });

  api.streamOpen({ streamId, path });

  return {
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(handler);
    },
    removeEventListener: (type, handler) => {
      listeners.get(type)?.delete(handler);
    },
    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      messageHandler = handler;
    },
    set onerror(handler: ((event: Event) => void) | null) {
      errorHandler = handler;
    },
    get readyState() {
      return readyState;
    },
    close: () => {
      readyState = API_STREAM_CLOSED;
      unsubscribe();
      api.streamClose(streamId);
    },
  };
}
