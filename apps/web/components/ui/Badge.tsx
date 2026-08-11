import type { ReactNode } from "react";

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="glow-accent-sm inline-flex items-center gap-1 rounded-full border border-accent/40 bg-gradient-to-r from-accent/15 to-accent-2/15 px-3 py-1 text-xs font-medium tracking-wide text-accent uppercase">
      {children}
    </span>
  );
}
