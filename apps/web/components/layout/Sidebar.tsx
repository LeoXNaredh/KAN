"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";
import { MessageSquareText, Home, Cpu, Activity, Workflow, Route, FolderKanban, Settings, Plus, Trash2, Edit2, Check, X, type LucideIcon } from "lucide-react";
import { useRecentConversations } from "@/lib/conversations/useRecentConversations";
import { formatRelativeTime } from "@/lib/status/formatRelativeTime";
import { SkeletonText } from "@/components/ui/Skeleton";

// Orden por frecuencia de uso (rediseño de interfaz): la conversación es el
// modo primario de KAN, va primero. "Logs" sale del nivel superior — es
// jerga técnica de depuración, no algo que un usuario final necesite ver
// como sección de producto (sigue accesible desde Configuración).
const NAV_ITEMS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/conversacion", label: "Conversación", icon: MessageSquareText },
  { href: "/", label: "Inicio", icon: Home },
  { href: "/dispositivos", label: "Dispositivos", icon: Cpu },
  { href: "/sensores", label: "Sensores", icon: Activity },
  { href: "/secuencias", label: "Secuencias", icon: Route },
  { href: "/automatizaciones", label: "Recordatorios", icon: Workflow },
  { href: "/proyectos", label: "Proyectos", icon: FolderKanban },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

const RECENT_CONVERSATIONS_LIMIT = 5;

export function Sidebar({
  open,
  onClose,
  entering = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Boot sequence (BootSequence.tsx): mientras es true, el sidebar se mantiene oculto en cualquier viewport, sin importar `open`. */
  entering?: boolean;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Oculto durante el boot en cualquier breakpoint; fuera de eso, el
  // comportamiento de siempre (drawer en mobile via `open`, siempre visible
  // en desktop).
  const transformClasses = entering
    ? "-translate-x-full md:-translate-x-full"
    : open
      ? "translate-x-0 md:translate-x-0"
      : "-translate-x-full md:translate-x-0";

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        aria-modal={open ? true : undefined}
        role={open ? "dialog" : undefined}
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 bg-surface-2 p-4 transition-transform duration-base md:static md:z-auto md:w-60 ${transformClasses}`}
      >
        <div className="mb-6 px-2">
          <p className="text-lg font-medium tracking-tight text-accent">KAN</p>
          <p className="text-xs text-ink-faint">Asistente</p>
        </div>
        <nav aria-label="Principal" className="kan-scroll flex flex-1 flex-col gap-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Fragment key={item.href}>
                <Link
                  href={item.href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`press hud-button flex items-center gap-2.5 px-4 py-2 text-sm font-medium transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                    active ? "bg-surface-3 text-ink" : "text-ink-muted hover:bg-surface-3 hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                </Link>
                {item.href === "/conversacion" && (
                  <Suspense fallback={null}>
                    <RecentConversations onNavigate={onClose} />
                  </Suspense>
                )}
              </Fragment>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/**
 * Chats guardados (debajo de "Conversación", mismo criterio que
 * Claude/ChatGPT) — últimas `RECENT_CONVERSATIONS_LIMIT`, con "Nueva
 * conversación" siempre arriba de la lista. Sin sesión o sin chats
 * todavía, `conversations` llega vacío y esto no renderiza nada extra.
 */
function RecentConversations({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeId = pathname === "/conversacion" ? (searchParams.get("c") ?? undefined) : undefined;
  const { conversations, loading, refresh } = useRecentConversations(RECENT_CONVERSATIONS_LIMIT);

  return (
    <div className="mb-1 flex flex-col gap-0.5 pl-4">
      <Link
        href="/conversacion"
        onClick={onNavigate}
        className={`press hud-button flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors duration-fast ${
          activeId ? "text-ink-faint hover:bg-surface-3 hover:text-ink" : "bg-surface-3 text-ink"
        }`}
      >
        <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
        Nueva conversación
      </Link>
      {loading && (
        <div className="flex flex-col gap-1 px-3 py-1">
          <SkeletonText className="h-3 w-5/6" />
          <SkeletonText className="h-3 w-3/4" />
          <SkeletonText className="h-3 w-4/6" />
        </div>
      )}
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === activeId}
          onNavigate={onNavigate}
          onRefresh={() => {
            refresh();
            if (conversation.id === activeId) router.refresh();
          }}
          onDelete={() => {
            refresh();
            if (conversation.id === activeId) router.push("/conversacion");
          }}
        />
      ))}
    </div>
  );
}

function ConversationItem({
  conversation,
  active,
  onNavigate,
  onRefresh,
  onDelete,
}: {
  conversation: { id: string; title: string; updatedAt: string };
  active: boolean;
  onNavigate: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!editTitle.trim() || editTitle === conversation.title) {
      setIsEditing(false);
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle }),
      });
      if (res.ok) {
        onRefresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("¿Seguro que deseas eliminar esta conversación?")) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, { method: "DELETE" });
      if (res.ok) {
        onDelete();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 px-3 py-1.5 text-xs bg-surface-3 hud-button">
        <input
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
          disabled={isSaving}
          className="flex-1 min-w-0 bg-transparent outline-none text-ink placeholder-ink-faint"
        />
        <button onClick={handleSave} disabled={isSaving} className="text-success hover:text-success/80">
          <Check className="h-3 w-3" />
        </button>
        <button onClick={() => setIsEditing(false)} disabled={isSaving} className="text-danger hover:text-danger/80">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={`group flex items-center justify-between px-3 py-1.5 text-xs transition-colors duration-fast hud-button ${active ? "bg-surface-3 text-ink" : "text-ink-faint hover:bg-surface-3 hover:text-ink"}`}>
      <Link
        href={`/conversacion?c=${encodeURIComponent(conversation.id)}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={conversation.title}
        className="flex-1 min-w-0 flex flex-col gap-0.5 press"
      >
        <span className="truncate">{conversation.title}</span>
        <span className="text-[10px] opacity-70">{formatRelativeTime(conversation.updatedAt)}</span>
      </Link>
      <div className="hidden group-hover:flex items-center gap-1.5 ml-2">
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditing(true); }}
          className="text-ink-faint hover:text-accent transition-colors"
          title="Renombrar"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(); }}
          disabled={isDeleting}
          className="text-ink-faint hover:text-danger transition-colors"
          title="Eliminar"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
