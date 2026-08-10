import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { HeroStatus as HeroStatusData } from "@/lib/status/buildHeroStatus";

const ICON = { online: CheckCircle2, warning: AlertTriangle, offline: XCircle } as const;
const COLOR = { online: "text-success", warning: "text-warning", offline: "text-danger" } as const;

/** Estado único del Dashboard (rediseño de interfaz) — un ícono y una frase, nunca una grilla de infraestructura interna. */
export function HeroStatus({ status }: { status: HeroStatusData }) {
  const Icon = ICON[status.level];
  return (
    <div className="fade-in flex items-start gap-3">
      <Icon className={`h-6 w-6 shrink-0 ${COLOR[status.level]}`} aria-hidden="true" />
      <div>
        <p className={`text-base font-medium ${COLOR[status.level]}`}>{status.headline}</p>
        {status.detail && <p className="mt-0.5 text-sm text-ink-faint">{status.detail}</p>}
      </div>
    </div>
  );
}
