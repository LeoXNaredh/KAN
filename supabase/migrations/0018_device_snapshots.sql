-- Backup/restore de código de dispositivo (docs/06, sistema de proyectos):
-- mismo criterio que plugin_registry/plugin-packages (0011/0012) — un
-- bucket privado de Storage para el contenido (puede ser binario grande,
-- un dump de flash) + una tabla de metadata liviana para listar/filtrar.

insert into storage.buckets (id, name, public)
values ('device-snapshots', 'device-snapshots', false)
on conflict (id) do nothing;

create table if not exists public.device_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  edge_agent_id uuid not null,
  device_id text not null,
  device_name text,
  device_kind text not null,
  backup_type text not null check (backup_type in ('source', 'binary', 'config')),
  label text,
  storage_object_path text not null,
  size_bytes bigint,
  file_count integer,
  created_at timestamptz not null default now()
);

create index if not exists device_snapshots_user_id_idx on public.device_snapshots (user_id);
create index if not exists device_snapshots_device_id_idx on public.device_snapshots (device_id);

alter table public.device_snapshots enable row level security;

-- Sin policies para anon/authenticated a propósito (mismo criterio que
-- audit_entries/plugin_registry, ADR-026): el Gateway escribe y lee con
-- service_role key (el Edge Agent no tiene sesión de usuario, solo el
-- secreto de pairing). apps/web nunca consulta esta tabla directo, siempre
-- vía las rutas autenticadas por JWT del Gateway (GET /v1/snapshots, GET
-- /v1/devices/:deviceId/snapshots).
