"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { MessageSquareText, Home, Cpu, Workflow, FolderKanban, Settings, type LucideIcon } from "lucide-react";
import { KANMark } from "@/components/kan/KANMark";

// Orden por frecuencia de uso (rediseño de interfaz): la conversación es el
// modo primario de KAN, va primero. "Logs" sale del nivel superior — es
// jerga técnica de depuración, no algo que un usuario final necesite ver
// como sección de producto (sigue accesible desde Configuración).
const NAV_ITEMS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/conversacion", label: "Conversación", icon: MessageSquareText },
  { href: "/", label: "Inicio", icon: Home },
  { href: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { href: "/automatizaciones", label: "Recordatorios", icon: Workflow },
  { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        aria-modal={open ? true : undefined}
        role={open ? "dialog" : undefined}
        className={`glass kan-grid-bg fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-line/80 p-4 transition-transform duration-base md:static md:z-auto md:w-60 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <span className="bg-gradient-accent glow-accent-sm animate-glow-pulse flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white">
            <KANMark className="h-4 w-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-gradient text-base font-bold tracking-tight">KAN</p>
            <p className="text-[10px] tracking-wide text-ink-faint uppercase">Asistente</p>
          </div>
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  active
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-transparent text-ink-muted hover:translate-x-0.5 hover:bg-surface-3 hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
