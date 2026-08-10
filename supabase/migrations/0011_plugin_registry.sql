-- Catálogo de plugins sidecar instalables bajo demanda (ADR-056, Fase 4).
-- Alcance de este incremento: solo paquetes oficiales de KAN, publicados a
-- mano (sin pipeline de publish, ver ADR-056) — no un marketplace público
-- (docs/09, Año 2). Sin user_id: mismo criterio que audit_entries/
-- edge_agent_pairings — el catálogo no pertenece a ningún usuario.

create table if not exists public.plugin_registry (
  id text primary key,
  version text not null,
  display_name text not null,
  kind text not null check (kind in ('device-driver', 'integration', 'processing')),
  runtime text not null check (runtime in ('in-process-ts', 'python-sidecar')),
  permissions jsonb not null,
  description text,
  storage_object_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plugin_registry enable row level security;

-- Sin policies a propósito (ADR-026, mismo criterio que audit_entries): el
-- catálogo se sirve exclusivamente a través del Gateway (GET
-- /v1/plugins/catalog, service_role key) — nunca por consulta directa del
-- cliente contra Supabase, ni siquiera de lectura.
