---
name: Feature
about: Algo nuevo que KAN todavía no hace
title: "[Feature] "
labels: enhancement
---

## Qué necesita poder hacer el usuario

<!-- Describilo desde el lado del usuario ("KAN, imprime esta pieza"),
no desde la implementación ("agregar un endpoint nuevo"). -->

## Por qué

<!-- Qué problema resuelve, o a qué punto del prompt maestro /
docs/09-roadmap.md / docs/10-backlog-y-tareas.md responde. -->

## Alcance

- [ ] ¿Esto es un plugin nuevo, o una capacidad nueva de un plugin existente? (Regla del proyecto: si se puede implementar como plugin, no toca el Core — ver README.md → CORE.)
- [ ] ¿Requiere una decisión de arquitectura nueva? Si sí, va a necesitar un ADR en `docs/00-analisis-y-decisiones.md` antes de implementarse.
- [ ] ¿Toca acciones sobre hardware físico? Si sí, indicar la severidad esperada (`read-only` / `reversible` / `irreversible-material` / `safety-critical`, ADR-004).

## Criterio de aceptación

<!-- Cómo se sabe que esto está terminado -- qué comando/flujo debería
funcionar al final que hoy no funciona. -->
