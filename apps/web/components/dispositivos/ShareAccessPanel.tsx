"use client";

import { useEffect, useState, type FormEvent } from "react";
import { UserPlus, X } from "lucide-react";
import { INPUT_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

interface Grant {
  userId: string;
  email: string;
}

/**
 * Compartir acceso a un equipo (multi-usuario) — solo se monta para el
 * dueño real (`DeviceList` ya filtra por `agent.ownerId === currentUserId`,
 * el Gateway lo vuelve a verificar del lado del servidor igual). Invitar y
 * revocar surten efecto de inmediato en el Gateway, sin esperar a que el
 * Edge Agent se reconecte.
 */
export function ShareAccessPanel({ edgeAgentId }: { edgeAgentId: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump para forzar un refetch desde un event handler (invitar/revocar) sin
  // llamar setState directo dentro del efecto — mismo criterio que
  // SecuenciasClient.tsx/AutomatizacionesClient.tsx.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(edgeAgentId)}/grants`, { cache: "no-store" });
        const data = await response.json();
        if (!cancelled) setGrants(data.grants ?? []);
      } catch {
        if (!cancelled) setGrants([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [edgeAgentId, reloadKey]);

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim()) return;
    setInviting(true);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(edgeAgentId)}/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "No se pudo invitar.");
        return;
      }
      setEmail("");
      setReloadKey((key) => key + 1);
    } catch {
      setError("KAN no está disponible en este momento.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(userId: string) {
    await fetch(`/api/agents/${encodeURIComponent(edgeAgentId)}/grants/${encodeURIComponent(userId)}`, { method: "DELETE" });
    setReloadKey((key) => key + 1);
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <p className="text-xs font-medium text-ink-muted">Compartir acceso</p>

      {!loading && grants.length > 0 && (
        <ul className="flex flex-col gap-1">
          {grants.map((grant) => (
            <li key={grant.userId} className="flex items-center justify-between gap-2 rounded-lg bg-surface-3/70 px-2.5 py-1.5 text-xs">
              <span className="truncate text-ink-muted">{grant.email}</span>
              <button
                type="button"
                onClick={() => handleRevoke(grant.userId)}
                aria-label={`Revocar acceso de ${grant.email}`}
                title="Revocar acceso"
                className="press shrink-0 rounded-md p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleInvite} className="flex items-center gap-2">
        <input
          type="email"
          placeholder="Invitar por email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={`flex-1 ${INPUT_CLASSES}`}
        />
        <button type="submit" disabled={inviting || !email.trim()} className={SECONDARY_BUTTON_CLASSES}>
          <span className="flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            {inviting ? "Invitando…" : "Invitar"}
          </span>
        </button>
      </form>

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
