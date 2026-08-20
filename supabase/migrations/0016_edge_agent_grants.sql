-- Acceso multi-usuario sobre un mismo Edge Agent: el dueño (el `user_id` que
-- lo reclamó en edge_agent_pairings) puede invitar a otros usuarios por
-- email. No reemplaza el pairing 1:1 (edge_agent_pairings sigue siendo la
-- fuente de verdad de "quién es el dueño real") — esto es una capa aditiva
-- de "a quién más le doy acceso".

create table if not exists public.edge_agent_grants (
  id uuid primary key default gen_random_uuid(),
  edge_agent_id text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (edge_agent_id, user_id)
);

create index if not exists edge_agent_grants_user_id_idx on public.edge_agent_grants (user_id);

alter table public.edge_agent_grants enable row level security;

-- El owner administra sus propios grants — verificado contra
-- edge_agent_pairings (misma fuente de verdad que resolveOwner() del
-- Gateway), no un campo separado que se pueda desincronizar del dueño real.
create policy "edge_agent_grants_owner_manage" on public.edge_agent_grants
  for all using (
    owner_id = auth.uid() and exists (
      select 1 from public.edge_agent_pairings p
      where p.edge_agent_id = edge_agent_grants.edge_agent_id
        and p.user_id = auth.uid()
        and p.claimed_at is not null
    )
  ) with check (
    owner_id = auth.uid() and exists (
      select 1 from public.edge_agent_pairings p
      where p.edge_agent_id = edge_agent_grants.edge_agent_id
        and p.user_id = auth.uid()
        and p.claimed_at is not null
    )
  );

-- El invitado puede ver (no modificar) sus propios accesos.
create policy "edge_agent_grants_invitee_read" on public.edge_agent_grants
  for select using (user_id = auth.uid());
