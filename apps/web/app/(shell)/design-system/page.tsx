import {
  Cpu,
  MessageSquare,
  Mic,
  Bot,
  Printer,
  Zap,
  FlaskConical,
  CircuitBoard,
  Puzzle,
  Menu,
  Send,
  Wrench,
  Sparkles,
  LayoutDashboard,
  Workflow,
  FolderKanban,
  Settings,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusDot } from "@/components/ui/StatusDot";

const COLOR_TOKENS = [
  { name: "surface", className: "bg-surface" },
  { name: "surface-2", className: "bg-surface-2" },
  { name: "surface-3", className: "bg-surface-3" },
  { name: "line", className: "bg-line" },
  { name: "line-strong", className: "bg-line-strong" },
  { name: "ink", className: "bg-ink" },
  { name: "ink-muted", className: "bg-ink-muted" },
  { name: "ink-faint", className: "bg-ink-faint" },
  { name: "accent", className: "bg-accent" },
  { name: "success", className: "bg-success" },
  { name: "warning", className: "bg-warning" },
  { name: "danger", className: "bg-danger" },
];

const ICONS: Array<{ name: string; icon: LucideIcon }> = [
  { name: "LayoutDashboard", icon: LayoutDashboard },
  { name: "MessageSquare", icon: MessageSquare },
  { name: "Cpu", icon: Cpu },
  { name: "Workflow", icon: Workflow },
  { name: "FolderKanban", icon: FolderKanban },
  { name: "Settings", icon: Settings },
  { name: "ScrollText", icon: ScrollText },
  { name: "Menu", icon: Menu },
  { name: "Mic", icon: Mic },
  { name: "Send", icon: Send },
  { name: "Wrench", icon: Wrench },
  { name: "Puzzle", icon: Puzzle },
  { name: "Sparkles", icon: Sparkles },
  { name: "CircuitBoard", icon: CircuitBoard },
  { name: "Bot", icon: Bot },
  { name: "Printer", icon: Printer },
  { name: "Zap", icon: Zap },
  { name: "FlaskConical", icon: FlaskConical },
];

/**
 * Catálogo vivo del Design System — compañero de DESIGN_SYSTEM.md.
 * Deliberadamente NO está en el Sidebar (docs/17): es documentación de
 * desarrollo, no una sección de producto.
 */
export default function DesignSystemPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-ink">Design System v1</h1>
        <p className="text-sm text-ink-faint">
          Catálogo vivo de tokens y componentes de KAN. Ver DESIGN_SYSTEM.md para la referencia completa.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Color</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {COLOR_TOKENS.map((token) => (
            <div key={token.name} className="flex flex-col gap-2">
              <div className={`h-16 rounded-lg border border-line ${token.className}`} />
              <span className="font-mono text-xs text-ink-muted">{token.name}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Tipografía</h2>
        <Card className="flex flex-col gap-3">
          <p className="text-lg font-semibold text-ink">Título de página — text-lg font-semibold</p>
          <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
            Encabezado de sección — text-sm font-medium uppercase
          </p>
          <p className="text-sm text-ink">Cuerpo — text-sm</p>
          <p className="text-xs text-ink-faint">Caption / metadata — text-xs</p>
          <p className="font-mono text-xs text-ink-muted">Mono — font-mono text-xs (tool calls, IDs, auditoría)</p>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Radios</h2>
        <div className="flex flex-wrap items-end gap-4">
          {[
            ["rounded-lg", "rounded-lg"],
            ["rounded-xl", "rounded-xl"],
            ["rounded-full", "rounded-full"],
          ].map(([label, className]) => (
            <div key={label} className="flex flex-col items-center gap-2">
              <div className={`h-16 w-16 border border-line bg-surface-2 ${className}`} />
              <span className="text-xs text-ink-faint">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Espaciado</h2>
        <div className="flex items-end gap-4">
          {[2, 3, 4, 6].map((n) => (
            <div key={n} className="flex flex-col items-center gap-2">
              <div
                className="rounded border border-accent/40 bg-accent/20"
                style={{ width: `${n * 4}px`, height: `${n * 4}px` }}
              />
              <span className="text-xs text-ink-faint">gap-{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Iconografía (lucide-react)</h2>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
          {ICONS.map(({ name, icon: Icon }) => (
            <div
              key={name}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-surface-2 p-3"
            >
              <Icon className="h-5 w-5 text-ink" aria-hidden="true" />
              <span className="text-center text-[10px] text-ink-faint">{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Componentes</h2>
        <div className="flex flex-wrap gap-4">
          <Card padding="sm">Card (padding sm)</Card>
          <Card>Card (padding md, por defecto)</Card>
          <Card padding="lg">Card (padding lg)</Card>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Badge>Badge</Badge>
          <StatusDot level="online" label="Online" />
          <StatusDot level="warning" label="Warning" />
          <StatusDot level="offline" label="Offline" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-ink-muted">Movimiento</h2>
        <p className="text-sm text-ink-muted">
          <code className="font-mono text-xs text-ink">duration-fast</code> (150ms) para micro-interacciones (hover,
          foco). <code className="font-mono text-xs text-ink">duration-base</code> (300ms) para transiciones de
          paneles y el fade-in de montaje. <code className="font-mono text-xs text-ink">duration-slow</code> (500ms)
          reservado para cambios de layout más grandes.
        </p>
      </section>
    </div>
  );
}
