-- Persistencia real del audit trail del Gateway (docs/16 P3, ADR-026),
-- reemplaza JsonlAuditStore (packages/gateway-core). Sin user_id: el
-- Gateway no tiene sesión de usuario (vive en la LAN del Edge Agent, no en
-- apps/web — mismo razonamiento que ADR-019/ADR-021 sobre jobs/notificaciones).

create table if not exists public.audit_entries (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor text not null check (actor in ('llm', 'user', 'system')),
  action text not null,
  subject text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_entries_at_idx on public.audit_entries (at desc);

alter table public.audit_entries enable row level security;

-- Sin policies a propósito (ADR-026): el Gateway escribe con la
-- service_role key (ignora RLS por diseño), no con la anon key + sesión de
-- usuario como el resto de las tablas. Sin ninguna policy para
-- anon/authenticated, esta tabla queda deny-by-default real para cualquiera
-- que solo tenga la anon key pública — ni lectura ni escritura directa.
