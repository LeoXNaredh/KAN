"use client";

import { useState, type ReactNode } from "react";
import type { UserIdentity } from "@kan/core";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

export function ShellChrome({ user, children }: { user: UserIdentity | undefined; children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-surface text-ink">
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMenu={() => setMobileNavOpen(true)} user={user} />
        <main className="flex flex-1 flex-col gap-4 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
