-- Pairing de Edge Agents con un usuario (docs/19 P2, incremento 3): un
-- código corto de un solo uso, generado por un usuario logueado en
-- apps/web, que el Edge Agent (apps/desktop) reclama para obtener un
-- secreto de larga vida (guardado hasheado, nunca en texto plano) y quedar
-- asociado a esa cuenta.

create table if not exists public.edge_agent_pairings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pairing_code text not null unique,
  pairing_secret_hash text,
  edge_agent_id text,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists edge_agent_pairings_secret_hash_idx on public.edge_agent_pairings (pairing_secret_hash);

alter table public.edge_agent_pairings enable row level security;

-- El usuario ve/crea sus propios códigos (anon key + sesión, generateCode()
-- desde apps/web). El claim lo hace el Gateway con la service_role key
-- (igual que audit_entries, ADR-026) porque quien reclama es el Edge Agent,
-- sin sesión de usuario — RLS no lo permitiría de otra forma.
create policy "edge_agent_pairings_manage_own" on public.edge_agent_pairings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
