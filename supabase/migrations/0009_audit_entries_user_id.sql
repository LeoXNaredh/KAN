-- Auditoría por usuario (docs/19 P2, incremento 5): el Gateway ya conoce el
-- usuario real detrás de casi toda entrada de audit_entries (verificado por
-- JWT, o el owner del Edge Agent involucrado) — antes solo se guardaba
-- `actor` (rol genérico: llm/user/system).

alter table public.audit_entries add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists audit_entries_user_id_idx on public.audit_entries (user_id);
