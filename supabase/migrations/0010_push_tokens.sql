-- Tokens de push de Expo por usuario (P7, ADR-040) — mismo patrón RLS que
-- memories/user_preferences: el usuario gestiona sus propias filas desde
-- apps/mobile (sesión propia); el Gateway los lee con service_role al
-- disparar una notificación de un job (no le hace falta policy propia).

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

create policy "push_tokens_manage_own" on public.push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
