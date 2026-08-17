-- Documentación + reconciliación de "schema drift" entre la base de
-- producción y las migraciones commiteadas en este repo (fix de auditoría
-- de backend #3). Dos diferencias encontradas hasta ahora, las dos en
-- `public.conversations.title`:
--
-- 1. NOT NULL — producción rechazaba SupabaseConversationRepository.save()
--    con "null value in column 'title' of relation 'conversations'
--    violates not-null constraint". Ninguna migración de este repo agrega
--    ese NOT NULL: 0002_conversations_messages.sql crea la columna
--    nullable (`title text`, sin restricción), y 0013_conversation_title.sql
--    la vuelve a agregar igual de nullable (`add column if not exists`).
--    Quedó puesta en producción por fuera de este flujo de migraciones —
--    probablemente a mano, desde el dashboard de Supabase. Ya se corrigió
--    en prod (corrida a mano en el SQL Editor) y se documentó en
--    0014_conversation_title_nullable.sql; el ALTER se repite acá de forma
--    idempotente para que cualquier otra base que haya quedado atrás (una
--    nueva, un entorno de staging, una restauración) llegue al mismo estado
--    sin depender de que alguien haya corrido 0014 primero.
--
-- 2. DEFAULT — verificado por introspección del esquema OpenAPI de
--    PostgREST (`GET /rest/v1/` con la service role key, después de aplicar
--    el fix de (1)): `title` tiene `default: "Nueva conversación"` en
--    producción, algo que tampoco agrega ninguna migración de este repo.
--    Inofensivo en la práctica — SupabaseConversationRepository.save()
--    siempre manda `title: null` de forma explícita, nunca omite la
--    columna, así que el default de Postgres nunca llega a activarse — pero
--    se documenta y se agrega acá para que el esquema commiteado deje de
--    divergir de lo que hay realmente en producción.
--
-- Ambos ALTER son idempotentes: correrlos de nuevo sobre una base que ya
-- está en este estado no falla ni cambia nada.

alter table public.conversations
alter column title drop not null;

alter table public.conversations
alter column title set default 'Nueva conversación';
