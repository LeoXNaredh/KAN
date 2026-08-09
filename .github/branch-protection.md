# Protección de rama — `main`

Esto **no se puede configurar desde el repo** (GitHub no tiene un archivo de config para branch protection en el árbol de código, es un ajuste de la API/dashboard del repositorio). Este documento es la checklist para activarlo a mano una sola vez.

## Dónde

`Settings` → `Branches` → `Branch protection rules` → `Add rule` (o `Add branch ruleset`, nombre nuevo en algunas cuentas) → `Branch name pattern`: `main`.

## Qué activar

- [ ] **Require a pull request before merging** — nadie pushea directo a `main`. (Esta misma sesión rompió esta regla varias veces antes de que este workflow existiera — ver `git log`. A partir de ahora no debería volver a pasar.)
  - [ ] `Require approvals`: al menos 1.
  - [ ] `Dismiss stale pull request approvals when new commits are pushed` — recomendado, evita aprobar un diff y mergear otro distinto.
- [ ] **Require status checks to pass before merging** — tildar los 4 jobs de `.github/workflows/ci.yml`:
  - [ ] `Lint`
  - [ ] `Typecheck`
  - [ ] `Test`
  - [ ] `Build (web + desktop)`
  - [ ] `Require branches to be up to date before merging` — recomendado, evita mergear contra una base vieja que ya no representa lo que hay en `main`.
- [ ] **Do not allow bypassing the above settings** — sin esto tildado, un admin (vos) puede saltarse la regla sin darse cuenta. Tildarlo fuerza a que hasta el dueño del repo pase por PR + CI verde.
- [ ] **Block force pushes** — un `git push --force` a `main` puede borrar historia; sin protección, nada lo impide.
- [ ] **Restrict deletions** — evita que alguien borre `main` por error.

## Qué NO hace falta (por ahora)

- `Require signed commits` — no hay ningún requisito de firma GPG en este proyecto hoy; agregarlo sin que el equipo tenga las claves configuradas solo bloquearía todos los merges.
- `Require linear history` — el repo no usa una convención de rebase-only todavía; forzarlo ahora rompería el flujo de merge commits que ya se usó en el historial existente.

## Cómo verificar que funcionó

Un push directo a `main` (sin pasar por PR) desde cualquier cuenta, incluida la del dueño del repo, debe ser rechazado por GitHub con un mensaje del estilo `protected branch hook declined`. Si un push directo todavía pasa, la regla no quedó bien aplicada — revisar que el patrón de nombre de rama sea exactamente `main` y que "Do not allow bypassing" esté tildado.
