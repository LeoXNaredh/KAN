-- Memoria estructurada por usuario (ADR-015, docs/17): hechos categorizados
-- (dispositivos, preferencias, proyectos, horarios), no un motor de
-- búsqueda semántica. Vacía en este incremento — el esquema queda listo
-- para cuando P2 implemente el CRUD real.

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category, key)
);

alter table public.memories enable row level security;

create policy "memories_manage_own" on public.memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
