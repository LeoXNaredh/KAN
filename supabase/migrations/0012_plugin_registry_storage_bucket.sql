-- Primer uso real de Supabase Storage en este repo (ADR-056, Fase 4).
-- ADR-018 había descartado Storage para imágenes de chat (base64 inline
-- alcanzaba); acá el caso es distinto — un artefacto binario de
-- instalación (`.tar.gz`, potencialmente decenas de MB con dependencias
-- como OpenCV, ver plugin-vision-py) que no tiene sentido guardar inline.

insert into storage.buckets (id, name, public)
values ('plugin-packages', 'plugin-packages', false)
on conflict (id) do nothing;

-- Sin policies para anon/authenticated en storage.objects para este bucket,
-- a propósito (mismo criterio que plugin_registry, ADR-026): el paquete
-- nunca se sirve por URL pública fija, solo por signed URL de vida corta
-- generada por el Gateway (`POST /v1/plugins/:id/download`) tras consumir
-- un PluginPackageTicket de un solo uso. service_role bypassa RLS por
-- diseño, así que el Gateway puede subir/leer sin necesitar ninguna policy.
