/** Hecho estructurado por usuario (ADR-015, docs/17) — no texto libre, no RAG. */
export interface MemoryEntry {
  userId: string;
  category: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Taxonomía fija (ADR-035) compartida entre las tools internas de memoria
 * (packages/core/src/application/memoryTools.ts) y el selector de
 * /configuracion en apps/web — no restringe `MemoryEntry.category` en sí
 * (sigue siendo `string`, no rompe datos ya guardados con otra categoría),
 * es una restricción hacia adelante para mantener consistencia.
 */
export const MEMORY_CATEGORIES = ["dispositivos", "preferencias", "proyectos", "general"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
