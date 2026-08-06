"use client";

import { useEffect, useState } from "react";
import type { SystemStatusResponse } from "./types";

const POLL_INTERVAL_MS = 15_000;

/**
 * Hook compartido entre TopBar y el Dashboard — cada consumidor sondea de
 * forma independiente (sin estado global) en favor de mantener este
 * incremento sin dependencias nuevas de manejo de estado.
 */
export function useSystemStatus(): { status: SystemStatusResponse | null; loading: boolean } {
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatusResponse;
        if (!cancelled) setStatus(data);
      } catch {
        // El Dashboard debe seguir mostrándose aunque /api/status falle.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { status, loading };
}
