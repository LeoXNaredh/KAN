-- Placeholder de esquema — sin CRUD todavía. El Dashboard de este
-- incremento solo cuenta filas (0 hoy) para la tarjeta "Proyectos".

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects enable row level security;

create policy "projects_manage_own" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
