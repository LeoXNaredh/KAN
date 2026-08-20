-- Suscripciones de Web Push por usuario (notificaciones push al celular
-- cuando se dispara una alerta) — tabla separada de push_tokens (Expo/
-- apps/mobile): el shape de una suscripción Web Push real (endpoint + par
-- de claves p256dh/auth) es estructuralmente distinto a un token simple, no
-- entra en esa tabla sin romper su propósito original.

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.web_push_subscriptions enable row level security;

-- El usuario gestiona sus propias filas desde apps/web (sesión propia,
-- mismo patrón que push_tokens); el Gateway las lee con service_role al
-- disparar una alerta (no le hace falta policy propia).
create policy "web_push_subscriptions_manage_own" on public.web_push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
