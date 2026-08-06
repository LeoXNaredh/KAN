import { ConversationPanel } from "@/components/dashboard/ConversationPanel";

export default function ConversacionPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Conversación</h1>
        <p className="text-sm text-ink-faint">Habla con KAN.</p>
      </div>
      <div className="flex flex-1">
        <ConversationPanel />
      </div>
    </div>
  );
}
