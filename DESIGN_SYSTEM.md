# DESIGN_SYSTEM.md — KAN Design System v1

> Alcance: **`apps/web` únicamente**. `apps/desktop` (panel técnico del Edge Agent) no adopta estos tokens todavía — ver `docs/17-plan-implementacion-v0.2.md`. Catálogo vivo de referencia: `apps/web/app/(shell)/design-system/page.tsx` (no está en el Sidebar — es documentación de desarrollo, no una sección de producto).

## Principios

Heredados de [`VISION_PRODUCT_v0.2.md`](VISION_PRODUCT_v0.2.md) §3: minimalista, oscuro, elegante, sin exagerar. Cada decisión de este documento existe para que ningún componente nuevo tenga que reinventar color, tipografía o espaciado — solo componer los tokens y primitivas ya definidos.

## Color

Tokens definidos en `apps/web/app/globals.css` (`:root` = valores light preparados pero sin usar todavía, `:root.dark` = los que se usan hoy — dark-por-defecto vía clase, no `prefers-color-scheme`).

| Token | Dark | Light | Uso |
|---|---|---|---|
| `surface` | `#05070a` | `#f8fafc` | Fondo de página |
| `surface-2` | `#0b0e14` | `#ffffff` | Tarjetas/paneles (`Card`) |
| `surface-3` | `#12161f` | `#f1f5f9` | Overlays: drawer móvil, filas internas de tabla/lista, futuros modales |
| `line` | `#1f2430` | `#e2e8f0` | Borde por defecto |
| `line-strong` | `#2a3040` | `#cbd5e1` | Borde en hover/foco |
| `ink` | `#e6e9ef` | `#0a0e14` | Texto primario |
| `ink-muted` | `#9aa3b2` | `#475569` | Texto secundario, encabezados de sección |
| `ink-faint` | `#5b6472` | `#94a3b8` | Texto terciario, captions, placeholders |
| `accent` | `#0ea5e9` | `#0284c7` | Acciones primarias, nav activo, foco |
| `success` / `warning` / `danger` | emerald/amber/red 500 | emerald/amber/red 600 | `StatusDot` y estados |

Uso: siempre como utility de Tailwind (`bg-surface-2`, `text-ink-muted`, `border-line`, etc.) — nunca un valor hex suelto en un componente. Estos tokens **deben aparecer como texto literal completo** en el código fuente (ej. `bg-surface-2`, no una interpolación `bg-${variable}`) porque Tailwind descubre las utilities a usar escaneando el código fuente en build time, no evaluándolo en runtime.

## Tipografía

Sin fuente nueva: Geist Sans (UI) y Geist Mono (`apps/web/app/layout.tsx`, ya cargadas vía `next/font/google`). Escala por rol, no por tamaño arbitrario:

| Rol | Clases |
|---|---|
| Título de página (`<h1>`) | `text-lg font-semibold text-ink` |
| Encabezado de sección (`<h2>`) | `text-sm font-medium text-ink-muted` (opcional `uppercase tracking-wide`) |
| Cuerpo | `text-sm text-ink` |
| Caption / metadata | `text-xs text-ink-faint` |
| Mono (tool calls, IDs, auditoría) | `font-mono text-xs text-ink-muted` |

## Espaciado y radios

Escala de espaciado de Tailwind sin cambios — el criterio es de uso, no de valores nuevos: `gap-1.5`/`gap-2` dentro de un control compuesto (ej. icono + texto), `gap-3` por defecto entre elementos de una tarjeta, `gap-4` entre tarjetas de una sección, `gap-6` entre bloques de página.

Tres niveles de radio, consistentes en todo el Dashboard:
- `rounded-lg` — botones, inputs, badges.
- `rounded-xl` — tarjetas y paneles (`Card`).
- `rounded-full` — puntos de estado, avatares, el botón de voz.

## Movimiento

Tokens `--duration-fast` (150ms), `--duration-base` (300ms), `--duration-slow` (500ms) en `@theme`, usables como `duration-fast`/`duration-base`/`duration-slow`.

- `duration-fast` — micro-interacciones: hover, foco, escala de botones.
- `duration-base` — transiciones de panel (drawer móvil) y el keyframe `.fade-in` con el que aparecen las tarjetas al montar.
- `duration-slow` — reservado para cambios de layout más grandes, sin uso todavía.

Sin librería de animación — coherente con que el resto del proyecto no depende de una (ni siquiera en `apps/desktop`). Transiciones CSS simples (`transition-colors`, `transition-transform`) y el keyframe `.fade-in` cubren lo necesario para "sin exagerar".

## Iconografía

`lucide-react` (SVG, un solo grosor de trazo, tree-shakeable, MIT) reemplaza los emoji usados en el incremento anterior. Tamaño por defecto `h-4 w-4` en línea con texto, `h-5 w-5`/`h-6 w-6` cuando el icono es el elemento principal de una tarjeta, `h-8 w-8` en el botón de voz. Siempre `aria-hidden="true"` — el texto adyacente (label del nav, texto de `StatusDot`, etc.) es lo que transmite el significado a lectores de pantalla, el icono es refuerzo visual, no la única fuente de información.

Inventario actual: `LayoutDashboard`, `MessageSquare`, `Cpu`, `Workflow`, `FolderKanban`, `Settings`, `ScrollText` (nav del Sidebar) · `Menu` (abrir nav en móvil) · `Mic` (botón de voz) · `Send` (enviar mensaje) · `Wrench` (tool calls en el chat) · `Puzzle` (plugins activos) · `Sparkles` (placeholder "Próximamente") · `Cpu`/`CircuitBoard`/`Bot`/`Printer`/`Zap`/`FlaskConical` (tipos de dispositivo).

## Componentes (`apps/web/components/ui/`)

- **`Card`** — superficie base (`bg-surface-2 border border-line rounded-xl`), prop `padding` (`sm`/`md`/`lg`) y `interactive` (agrega hover de borde). Toda tarjeta del Dashboard la usa en vez de repetir sus clases.
- **`Badge`** — pastilla pequeña con acento (`bg-accent/10 border-accent/40 text-accent`), usada hoy en `PlaceholderPage`.
- **`StatusDot`** — punto de color + texto (nunca solo color, por accesibilidad), niveles `online`/`warning`/`offline` mapeados a `success`/`warning`/`danger`.

## Qué NO cambia

`apps/desktop` sigue con su propio tema ad-hoc (`apps/desktop/src/renderer/src/index.css`) — no es parte de este incremento. Ningún puerto, caso de uso ni contrato del Core/Gateway/Edge Agent se toca; esto es exclusivamente la capa de presentación de `apps/web`.
