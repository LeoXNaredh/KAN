import { Loader2 } from "lucide-react";

export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
    </div>
  );
}
