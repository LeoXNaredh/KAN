/** Hecho estructurado por usuario (ADR-015, docs/17) — no texto libre, no RAG. */
export interface MemoryEntry {
  userId: string;
  category: string;
  key: string;
  value: unknown;
  updatedAt: string;
}
