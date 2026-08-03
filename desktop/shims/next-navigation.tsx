/**
 * Client-side next/navigation shim for the desktop Vite SPA.
 * AppShell only needs useRouter().replace and one-shot useSearchParams.
 */
import { useCallback, useSyncExternalStore } from "react";

function subscribeHistory(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getSearch() {
  return window.location.search;
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribeHistory, getSearch, () => "");
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

export function useRouter() {
  const navigate = useCallback((href: string) => {
    const url = href.startsWith("?")
      ? `${window.location.pathname}${href}`
      : href.startsWith("/")
        ? href
        : `/${href}`;
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  return {
    replace: (href: string, _opts?: { scroll?: boolean }) => navigate(href),
    push: (href: string, _opts?: { scroll?: boolean }) => {
      const url = href.startsWith("?")
        ? `${window.location.pathname}${href}`
        : href.startsWith("/")
          ? href
          : `/${href}`;
      window.history.pushState(window.history.state, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    refresh: () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: async () => {},
  };
}

export function usePathname() {
  return useSyncExternalStore(
    subscribeHistory,
    () => window.location.pathname,
    () => "/",
  );
}

export function useParams(): Record<string, string> {
  return {};
}

// Keep a no-op import side-effect free helper for completeness.
export function redirect(_href: string): never {
  throw new Error("redirect() is not supported in the desktop SPA shim");
}

export function notFound(): never {
  throw new Error("notFound() is not supported in the desktop SPA shim");
}
