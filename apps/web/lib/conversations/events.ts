"use client";

// Notifica al sidebar (`useRecentConversations`) que una conversación se
// creó o recibió un mensaje nuevo, sin acoplar `useConversation` a los
// detalles de esa lista — un `CustomEvent` en `window` es más simple que un
// context/provider compartido entre `ShellChrome` (dueño del Sidebar) y las
// páginas que usan `useConversation` (no son ancestro/descendiente directo).
// Complementa al polling de 15s de `useRecentConversations`, no lo reemplaza:
// esto es lo que hace que el título aparezca en tiempo real apenas llega el
// primer mensaje, en vez de esperar hasta el próximo tick.
const CONVERSATION_UPDATED_EVENT = "kan:conversation-updated";

export function emitConversationUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONVERSATION_UPDATED_EVENT));
}

export function subscribeToConversationUpdates(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CONVERSATION_UPDATED_EVENT, callback);
  return () => window.removeEventListener(CONVERSATION_UPDATED_EVENT, callback);
}
