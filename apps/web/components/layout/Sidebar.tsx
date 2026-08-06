"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/conversacion", label: "Conversación" },
  { href: "/dispositivos", label: "Dispositivos" },
  { href: "/automatizaciones", label: "Automatizaciones" },
  { href: "/proyectos", label: "Proyectos" },
  { href: "/configuracion", label: "Configuración" },
  { href: "/logs", label: "Logs" },
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
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-zinc-800 bg-zinc-950 p-4 transition-transform duration-300 md:static md:z-auto md:w-56 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className="text-sm font-semibold tracking-wide text-sky-400">KAN</span>
        </div>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${
                  active
                    ? "bg-sky-500/10 text-sky-300"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
