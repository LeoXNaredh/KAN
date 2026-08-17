import type { ReactNode } from "react";
import { ShellChrome } from "@/components/layout/ShellChrome";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { buildAuthUseCases } from "@/lib/auth/composition";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserCached();

  // Mismo use case que ya usaba `(shell)/page.tsx` para el Dashboard — acá
  // se resuelve de nuevo (una query liviana, dos COUNT) porque el InfoPanel
  // del rediseño eDEX-UI (memoria/proyectos) vive en `ShellChrome`, que
  // envuelve TODAS las rutas del shell, no solo el Dashboard.
  const summary = user
    ? await (await buildAuthUseCases()).getDashboardSummary.execute(user.userId).catch(() => undefined)
    : undefined;

  return (
    <ShellChrome user={user} summary={summary}>
      {children}
    </ShellChrome>
  );
}
