import { ConversationPanel } from "@/components/dashboard/ConversationPanel";

export default function ConversacionPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ConversationPanel framed={false} />
    </div>
  );
}
