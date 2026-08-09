import { Loader2 } from "lucide-react";

export default function ShellLoading() {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
      <p className="text-sm text-ink-faint">Cargando…</p>
    </div>
  );
}
