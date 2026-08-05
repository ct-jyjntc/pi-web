"use client";

import { useEffect, useRef, useState } from "react";
import { encodeFilePathForApi } from "@/lib/file-paths";
import { apiStream, type ApiStream } from "@/lib/api-transport";

function getWatchUrl(filePath: string, sourceSessionId?: string | null): string {
  const encoded = encodeFilePathForApi(filePath);
  const params = new URLSearchParams({ type: "watch" });
  if (sourceSessionId) params.set("sessionId", sourceSessionId);
  return `/api/files/${encoded}?${params.toString()}`;
}

/**
 * Subscribe to file change SSE for the viewer. Returns live/static state,
 * content cache-bust token, and last reported size from the watch stream.
 */
export function useFileWatch(filePath: string, sourceSessionId?: string | null) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const esRef = useRef<ApiStream | null>(null);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = apiStream(getWatchUrl(filePath, sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch {
        /* ignore malformed watch payloads */
      }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, sourceSessionId]);

  return { watching, bust, size, setSize };
}
