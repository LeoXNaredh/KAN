-- Producción viene rechazando SupabaseConversationRepository.save() con
-- "null value in column 'title' of relation 'conversations' violates
-- not-null constraint": el título se deriva on-the-fly de la primera línea
-- del primer mensaje (deriveConversationTitle, @kan/core) y solo se
-- persiste una vez que el usuario lo edita a mano o el use case lo fija
-- explícitamente — save() manda `title: null` en el resto de los casos, a
-- propósito (ver comentario en SupabaseConversationRepository.save()).
--
-- Ninguna migración de este repo agrega ese NOT NULL — ni 0002
-- (conversations_messages, la crea) ni 0013 (conversation_title, la agrega
-- vía `add column`, sin restricción). La base de producción quedó con una
-- restricción que no está commiteada acá, agregada por fuera de este flujo
-- de migraciones (a mano en el dashboard, o una migración corrida
-- directo contra la base y nunca guardada en el repo).

alter table public.conversations
alter column title drop not null;
