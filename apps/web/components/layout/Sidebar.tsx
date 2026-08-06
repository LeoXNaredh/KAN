"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  Cpu,
  Workflow,
  FolderKanban,
  Settings,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

const NAV_ITEMS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/conversacion", label: "Conversación", icon: MessageSquare },
  { href: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { href: "/automatizaciones", label: "Automatizaciones", icon: Workflow },
  { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
  { href: "/configuracion", label: "Configuración", icon: Settings },
  { href: "/logs", label: "Logs", icon: ScrollText },
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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-line bg-surface-2 p-4 transition-transform duration-base md:static md:z-auto md:w-56 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="text-sm font-semibold tracking-wide text-accent">KAN</span>
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
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                  active ? "bg-accent/10 text-accent" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
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
