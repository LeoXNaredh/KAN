import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { HeroStatus as HeroStatusData } from "@/lib/status/buildHeroStatus";

const ICON = { online: CheckCircle2, warning: AlertTriangle, offline: XCircle } as const;
const COLOR = { online: "text-success", warning: "text-warning", offline: "text-danger" } as const;
const GLOW = {
  online: "var(--color-success)",
  warning: "var(--color-warning)",
  offline: "var(--color-danger)",
} as const;
const RING = {
  online: "bg-success/10",
  warning: "bg-warning/10",
  offline: "bg-danger/10",
} as const;

/** Estado único del Dashboard (rediseño de interfaz) — un ícono y una frase, nunca una grilla de infraestructura interna. */
export function HeroStatus({ status }: { status: HeroStatusData }) {
  const Icon = ICON[status.level];
  return (
    <div className="fade-in flex items-center gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${RING[status.level]}`}
        style={{ boxShadow: `0 0 16px -2px ${GLOW[status.level]}` }}
      >
        <Icon className={`h-5 w-5 ${COLOR[status.level]}`} aria-hidden="true" />
      </span>
      <div>
        <p className={`text-base font-medium ${COLOR[status.level]}`}>{status.headline}</p>
        {status.detail && <p className="mt-0.5 text-sm text-ink-faint">{status.detail}</p>}
      </div>
    </div>
  );
}
