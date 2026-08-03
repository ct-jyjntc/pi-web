/**
 * Desktop SPA entry — same AppShell as web, no Next.js runtime.
 */
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/AppShell";
import "@/app/globals.css";

const el = document.getElementById("root");
if (!el) {
  throw new Error("#root missing");
}

createRoot(el).render(
  <StrictMode>
    <Suspense fallback={null}>
      <AppShell />
    </Suspense>
  </StrictMode>,
);
