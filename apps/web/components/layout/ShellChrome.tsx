"use client";

import { useState, type ReactNode } from "react";
import type { UserIdentity } from "@kan/core";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useBrowserEdgeAgent } from "@/lib/edgeAgent/useBrowserEdgeAgent";
import { SystemStatusProvider } from "@/lib/status/SystemStatusProvider";

export function ShellChrome({ user, children }: { user: UserIdentity | undefined; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Simulador corriendo en el propio tab (docs/19 continuación) — sobrevive
  // a la navegación client-side dentro del shell porque ShellChrome no se
  // desmonta al cambiar de ruta, solo `children`.
  useBrowserEdgeAgent(Boolean(user));

  return (
    <SystemStatusProvider>
      <div className="flex min-h-screen w-full bg-surface text-ink">
        <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onOpenMenu={() => setMobileNavOpen(true)} user={user} />
          <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </SystemStatusProvider>
  );
}
