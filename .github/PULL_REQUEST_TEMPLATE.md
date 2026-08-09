## Qué cambia y por qué

<!-- El "por qué" importa más que el "qué" -- el diff ya muestra el qué. -->

## Cómo se probó

- [ ] `pnpm turbo run lint typecheck test` local, limpio.
- [ ] Probado manualmente en `apps/web` / `apps/desktop` / `apps/mobile` (marcar lo que aplique, borrar lo que no).
- [ ] Si toca un plugin de hardware: probado contra el dispositivo real, no solo el simulador (o explicar por qué no fue posible).

## Riesgo

<!-- ¿Este cambio puede afectar una acción sobre hardware físico
(irreversible-material / safety-critical, ADR-004)? ¿Toca autenticación,
permisos, o algo que ya esté en producción? -->

## Checklist

- [ ] Sin secretos ni credenciales en el diff.
- [ ] Documentación relevante actualizada (`docs/`, ADR en `docs/00-analisis-y-decisiones.md` si es una decisión de arquitectura nueva).
- [ ] Si agrega una variable de entorno nueva: reflejada en el `.env.example` correspondiente y en `README.md` → "Deploy en producción" si aplica a producción.
