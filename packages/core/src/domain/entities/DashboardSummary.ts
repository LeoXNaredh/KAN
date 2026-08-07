import type { UserProfile } from "./UserProfile";

/**
 * Resumen ya traducido a producto para el Dashboard (mismo principio que
 * docs/17 §3.1: la traducción de datos crudos vive del lado del servidor,
 * nunca duplicada en cada cliente). Conteos reales de tablas que sí existen
 * (`projects`, `memories`), aunque hoy siempre den 0 — nunca un número
 * inventado. Automatizaciones no tiene tabla todavía (P6, docs/17) y por
 * eso no aparece aquí — su tarjeta en el Dashboard es un placeholder puro.
 */
export interface DashboardSummary {
  profile: UserProfile;
  projectsCount: number;
  memoriesCount: number;
}
