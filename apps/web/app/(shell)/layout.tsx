import type { ReactNode } from "react";
import { ShellChrome } from "@/components/layout/ShellChrome";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserCached();

  return <ShellChrome user={user}>{children}</ShellChrome>;
}
