-- Visión Fase 1 (P3, ADR-018): imagen opcional adjunta a un mensaje "user",
-- persistida inline como base64 — ver ADR-018 en docs/00 sobre por qué no
-- Supabase Storage todavía y qué cambia si el uso real lo exige después.

alter table public.messages
  add column if not exists image_data text,
  add column if not exists image_mime_type text;
