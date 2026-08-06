import type { ReactNode } from "react";

export function DashboardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">{children}</div>;
}
