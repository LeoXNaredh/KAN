import { ConversationPanel } from "@/components/dashboard/ConversationPanel";

/** `?c=<id>` (sidebar, "chats guardados"): reabre esa conversación en vez de arrancar en blanco. */
export default async function ConversacionPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;

  return (
    <div className="flex flex-1 flex-col">
      <ConversationPanel framed={false} initialConversationId={c || undefined} />
    </div>
  );
}
