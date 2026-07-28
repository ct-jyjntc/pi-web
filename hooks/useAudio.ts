"use client";

import { useState, useRef, useCallback, useEffect } from "react";

function playTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  const freqs = [523.25, 659.25];
  freqs.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

function readLocalSoundPref(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("pi-sound-enabled");
  return stored === null ? true : stored === "true";
}

export function useAudio() {
  const [enabled, setEnabled] = useState<boolean>(() => readLocalSoundPref());

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Hydrate from server web-settings (source of truth across devices/restarts).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/web-settings")
      .then(async (res) => {
        const data = await res.json() as { settings?: { soundEnabled?: boolean } };
        if (cancelled || typeof data.settings?.soundEnabled !== "boolean") return;
        enabledRef.current = data.settings.soundEnabled;
        localStorage.setItem("pi-sound-enabled", String(data.settings.soundEnabled));
        setEnabled(data.settings.soundEnabled);
      })
      .catch(() => {
        // keep localStorage value
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ctxRef = useRef<AudioContext | null>(null);
  const getCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current && ctxRef.current.state !== "closed") return ctxRef.current;
    try {
      ctxRef.current = new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const unlockAudio = useCallback((force = false) => {
    if (!force && !enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== "suspended") return;
    ctx.resume().catch(() => {});
  }, [getCtx]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    if (next) unlockAudio(true);
    enabledRef.current = next;
    localStorage.setItem("pi-sound-enabled", String(next));
    setEnabled(next);
    void fetch("/api/web-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soundEnabled: next }),
    }).catch(() => {});
  }, [unlockAudio]);

  const setSoundEnabled = useCallback((next: boolean) => {
    if (next) unlockAudio(true);
    enabledRef.current = next;
    localStorage.setItem("pi-sound-enabled", String(next));
    setEnabled(next);
  }, [unlockAudio]);

  const playDone = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const play = () => {
      try {
        playTone(ctx);
      } catch {
        // AudioContext not available
      }
    };
    if (ctx.state === "suspended") {
      ctx.resume().then(play).catch(() => {});
      return;
    }
    play();
  }, [getCtx]);

  return {
    soundEnabled: enabled,
    onSoundToggle: toggle,
    setSoundEnabled,
    playDoneSound: playDone,
    unlockAudio,
    soundEnabledRef: enabledRef,
  };
}
