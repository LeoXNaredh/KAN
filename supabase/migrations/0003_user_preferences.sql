-- Hechos estructurados clave/valor por usuario — mismo patrón que
-- ConfigStorePort/SafetyPolicyStore ya usan en el Edge Agent
-- (packages/edge-agent-core), aplicado ahora a nivel de usuario en la nube.

create table if not exists public.user_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_preferences enable row level security;

create policy "user_preferences_manage_own" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
