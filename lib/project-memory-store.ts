/**
 * Client invalidation for Settings → Memory facts.
 * Disk writes stay in lib/project-memory.ts; this only triggers a refetch.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-transport";

export type ProjectMemoryFact = { id: string; text: string };

type Listener = () => void;

let revision = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function invalidateProjectMemory(): void {
  revision += 1;
  emit();
}

export function subscribeProjectMemory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProjectMemoryRevision(): number {
  return revision;
}

export function useProjectMemoryFacts(cwd: string | null): ProjectMemoryFact[] {
  const rev = useSyncExternalStore(
    subscribeProjectMemory,
    getProjectMemoryRevision,
    getProjectMemoryRevision,
  );
  const [facts, setFacts] = useState<ProjectMemoryFact[]>([]);

  useEffect(() => {
    if (!cwd) {
      setFacts([]);
      return;
    }
    let cancelled = false;
    void apiFetch(`/api/project-memory?cwd=${encodeURIComponent(cwd)}`)
      .then(async (res) => {
        const data = await res.json() as { facts?: ProjectMemoryFact[] };
        if (!cancelled && Array.isArray(data.facts)) {
          setFacts(data.facts.map((f) => ({ id: f.id, text: f.text })));
        }
      })
      .catch(() => {
        if (!cancelled) setFacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, rev]);

  return facts;
}
