# DESIGN_SYSTEM.md — KAN Design System v3 "Kukulkán"

> Alcance: **`apps/web` únicamente**. `apps/desktop` (panel técnico del Edge Agent) no adopta estos tokens todavía — ver `docs/17-plan-implementacion-v0.2.md`. Catálogo vivo de referencia: `apps/web/app/(shell)/design-system/page.tsx` (no está en el Sidebar — es documentación de desarrollo, no una sección de producto).

## Principios

v3 reemplaza a v2 "Aurora" (violeta→cian genérico) con una identidad propia: **Kukulkán**, la serpiente emplumada maya asociada a la sabiduría y el viento — de ahí "KAN". Negro profundo real (no un violeta oscurecido) como base, un único acento elegido por el usuario (5 presets) en vez de un gradiente de marca fijo de dos colores, y una estética deliberadamente más "HUD de Iron Man" que "panel de SaaS": animaciones marcadas (no easing suave tipo Apple), geometría angular, un núcleo animado (`KANAvatar`) como centro de la identidad en vez de un ícono de marca chico en el Sidebar.

Se mantiene de v2: oscuro por defecto (forzado vía clase en `app/layout.tsx`, no `prefers-color-scheme`), sin librería de animación, superficies de vidrio (`.glass`), y el criterio de tokens-no-valores-sueltos.

## Color

Tokens definidos en `apps/web/app/globals.css` (`:root` = light, `:root.dark` = el que se usa en la práctica — dark forzado).

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--kan-accent` | `#00ff9d` (verde esmeralda) por default | igual | **El único color que el usuario elige** — ver "Identidad KAN" abajo. Todo lo demás se deriva de esta variable. |
| `surface` | `#0a0a0a` | `#f6f5fb` | Fondo de página |
| `surface-2` | `#111111` | `#ffffff` | Tarjetas/paneles (`Card`, siempre con `.glass`) |
| `surface-3` | `#1a1a1a` | `#f0eefa` | Overlays: drawer móvil, filas internas de tabla/lista, futuros modales |
| `line` | `#262626` | `#e3e0f0` | Borde por defecto |
| `line-strong` | `#3d3d3d` | `#c9c4e0` | Borde en hover/foco |
| `ink` | `#f2f2f0` | `#14121f` | Texto primario |
| `ink-muted` | `#9c9c98` | `#524f6c` | Texto secundario, encabezados de sección |
| `ink-faint` | `#63635f` | `#8a87a3` | Texto terciario, captions, placeholders |
| `accent` | `= var(--kan-accent)` | `color-mix(kan-accent, 82% black)` | Acciones primarias, nav activo, foco, avatar. Oscurecido en light para contraste AA — tal cual en dark. |
| `accent-2` | `= accent` | `= accent` | Monocromático a propósito (v2 tenía un segundo color de marca fijo, cian) — `--gradient-accent`/glow se derivan de un único acento. |
| `success` / `warning` / `danger` | emerald/amber/red vivos | emerald/amber/red 600 | `StatusDot` y estados — nunca controlados por `--kan-accent`, son semántica de estado, no de marca |

Uso: siempre como utility de Tailwind (`bg-surface-2`, `text-ink-muted`, `border-line`, etc.) — nunca un valor hex suelto en un componente. Estos tokens **deben aparecer como texto literal completo** en el código fuente (ej. `bg-surface-2`, no una interpolación `bg-${variable}`) porque Tailwind descubre las utilities a usar escaneando el código fuente en build time, no evaluándolo en runtime.

## Identidad KAN — acento personalizable

El usuario elige el color de acento en **Configuración → Identidad visual** (`ThemeAccentPicker.tsx`), entre 5 presets:

| Preset | Hex | Selector CSS |
|---|---|---|
| Verde esmeralda maya (default) | `#00ff9d` | ninguno — es el valor base de `:root` |
| Dorado | `#f5a623` | `[data-kan-accent="gold"]` |
| Azul profundo | `#0066ff` | `[data-kan-accent="blue"]` |
| Rojo | `#ff3333` | `[data-kan-accent="red"]` |
| Blanco | `#ffffff` | `[data-kan-accent="white"]` |

Mecanismo (`apps/web/lib/kan/theme.ts`): el atributo `data-kan-accent` en `<html>` + `localStorage["kan:accent"]`. Preferencia 100% visual y local al navegador — nunca pasa por Supabase ni por ningún puerto/adaptador del backend. Un script inline en `app/layout.tsx` (`KAN_ACCENT_INLINE_SCRIPT`) aplica el atributo antes del primer paint para evitar el flash del acento default al recargar con una preferencia guardada.

## Gradiente, glass y glow

Utilidades hechas a mano en `globals.css` (no generables por `@theme` porque son efectos compuestos, no un solo color) — se usan como clases literales junto a utilities de Tailwind:

- **`.text-gradient`** — texto con el gradiente de marca (`bg-clip-text` + transparente). Reservado a la marca "KAN" del Sidebar.
- **`.bg-gradient-accent`** — relleno sólido en gradiente (acento → acento oscurecido, monocromático). Botón primario, nav activo, núcleo de `KANAvatar`, burbuja de usuario en el chat, botón de voz en reposo.
- **`.bg-gradient-accent-soft`** — versión ~16% de opacidad para chips de ícono. Existe porque el modificador de opacidad de Tailwind (`/15`) no aplica a clases hechas a mano — nunca escribir `bg-gradient-accent/15`.
- **`.glass`** — `background: color-mix(surface-2, transparent) + backdrop-blur`. Base de `Card`, `Sidebar`, `TopBar` (sticky), inputs de formulario, el panel de `KANLayout`.
- **`.glow-accent` / `.glow-accent-sm`** — `box-shadow` ambiental del color de acento. Hover de `Card` interactiva, badge, botón de voz, nav activo, núcleo de `KANAvatar`.
- Glow de un color semántico puntual (success/warning/danger) se hace con `style={{ boxShadow: '0 0 Npx -Mpx var(--color-X)' }}` inline, no con una clase nueva.

Glow ambiental de fondo: `body::before` en `globals.css` — dos radiales monocromáticos del acento elegido, fijas al viewport, opacidad baja (`--aurora-opacity`) y a la deriva muy lenta (`aurora-drift`, 24s). `body::after` agrega una grilla técnica de líneas finas (no puntos — más "schematic" que "textura decorativa"). Ninguno de los dos interfiere con contenido ni clicks (`z-index: -1`, `pointer-events: none` implícito por estar detrás).

## KANAvatar y los 3 estados (`KANLayout`)

El núcleo animado de KAN (`components/kan/KANAvatar.tsx`) es el centro de la identidad visual — un anillo angular girando (`.kan-ring`, `repeating-conic-gradient` recortado a anillo con `mask`, sin SVG ni librería) alrededor de un núcleo con glow que reacciona a `activity`:

| `activity` | Cuándo | Animación del núcleo |
|---|---|---|
| `idle` | Sin actividad | `kan-core-idle` — respiración lenta (3.2s) |
| `listening` | Grabando voz (push-to-talk o wake word) | `kan-core-listening` — pulso rápido (0.9s) + `.kan-ring-fast` (anillo gira 4s en vez de 18s) |
| `thinking` | Esperando respuesta del backend | `kan-core-thinking` — parpadeo de opacidad (1s) |
| `speaking` | Leyendo la respuesta en voz alta | `kan-core-speaking` — escala en Y tipo waveform (0.6s) |

`KANLayout.tsx` orquesta los 3 estados del pedido de producto sobre un **único** `KANAvatar` (nunca se desmonta uno para montar otro — la animación fluida es CSS `transition` sobre `top/left/transform`, coordinado con `useKANState`):

1. **"home"** (Estado 1) — sin mensajes todavía. Avatar centrado, grande, con la barra de input siempre visible debajo.
2. **"working"** (Estados 2 y 3 del pedido original) — desde el primer mensaje. El mismo avatar se desliza a la esquina inferior derecha (`scale(0.42)`, ~80px) mientras el panel (mensajes + widgets del Dashboard) ocupa el espacio principal; `activity` (`thinking`/`speaking`) sigue reflejándose en el avatar ya achicado — es la misma posición para "KAN trabajando" y "KAN respondiendo", el pedido original los distinguía por actividad, no por layout.

`useKANState` (`lib/kan/useKANState.ts`) deriva `phase`/`activity` directo de `useConversation` (`lib/chat/useConversation.ts` — la lógica de chat/voz/streaming, extraída de `ConversationPanel` para que `KANHome` y la presentación "clásica" de `/conversacion` la compartan sin duplicarla) — nunca un estado paralelo que pueda desincronizarse.

**Wake word** (`lib/kan/useWakeWord.ts`): Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), reconocimiento continuo local al navegador (nunca pasa por el Gateway). Detecta variantes fonéticas de "KAN" (`kan|khan|can|cannes|canes`, case-insensitive, palabra completa) y dispara el micrófono real (`useVoiceInput`). Se apaga solo mientras hay algo más escuchando/hablando (push-to-talk activo, sesión en vivo, o KAN leyendo una respuesta) para no autodispararse ni pisar una grabación en curso. Sin soporte en Safari/Firefox — `isWakeWordSupported()` permite ocultar UI relacionada si hiciera falta; hoy el hook simplemente no hace nada si el navegador no lo soporta.

**Mobile**: el panel de "working" adopta forma de sheet (`rounded-t-3xl`, sin borde inferior, animación `.kan-sheet` de entrada desde abajo) por debajo del breakpoint `sm`; la navegación lateral minimalista del panel (`sideNav`) se oculta en mobile — la navegación completa sigue disponible vía el `Sidebar` existente (hamburguesa en `TopBar`).

## Tipografía

Sin fuente nueva: Geist Sans (UI) y Geist Mono (`apps/web/app/layout.tsx`, ya cargadas vía `next/font/google`). Escala por rol, no por tamaño arbitrario:

| Rol | Clases |
|---|---|
| Saludo de `KANHome` (único "hero" de la interfaz) | `text-2xl font-semibold tracking-tight text-ink` |
| Título de página (`<h1>`) | `text-lg font-semibold text-ink` |
| Encabezado de sección (`<h2>`) | `text-sm font-medium text-ink-muted` (opcional `uppercase tracking-wide`) |
| Cuerpo | `text-sm text-ink` |
| Caption / metadata | `text-xs text-ink-faint` |
| Mono (IDs técnicos, auditoría) | `font-mono text-xs text-ink-muted` |

## Espaciado y radios

Escala de espaciado de Tailwind sin cambios — el criterio es de uso, no de valores nuevos: `gap-1.5`/`gap-2` dentro de un control compuesto (ej. icono + texto), `gap-3` por defecto entre elementos de una tarjeta, `gap-4` entre tarjetas de una sección, `gap-6` entre bloques de página.

Cuatro niveles de radio, consistentes en todo el Dashboard:
- `rounded-lg` — filas internas de lista/tabla.
- `rounded-xl` — botones, inputs, badges, chips de ícono.
- `rounded-2xl` — tarjetas y paneles (`Card`), estados vacíos.
- `rounded-full` — puntos de estado, avatares, el botón de voz, pills secundarias, `KANAvatar`.

## Movimiento

Tokens `--duration-fast` (150ms), `--duration-base` (300ms), `--duration-slow` (500ms) en `@theme`, usables como `duration-fast`/`duration-base`/`duration-slow`.

- `duration-fast` — micro-interacciones: hover, foco, escala de botones.
- `duration-base` — transiciones de panel (drawer móvil), la elevación de `Card` interactiva al hover, y el keyframe `.fade-in` con el que aparecen las tarjetas al montar.
- `duration-slow` — el desplazamiento del avatar entre "home"/"working" en `KANLayout` (`ease-[cubic-bezier(0.34,1.56,0.64,1)]` — un rebote leve, no el ease suave de `.fade-in`), y `.kan-sheet` (entrada del panel).
- `aurora-drift` (24s) — deriva del glow de fondo. `glow-pulse` (2s, clase `.animate-glow-pulse`) — pulso de énfasis puntual (logo del Sidebar).
- `kan-core-idle`/`kan-core-listening`/`kan-core-thinking`/`kan-core-speaking` y `kan-ring-spin`/`kan-ring-fast` — ver "KANAvatar" arriba. Deliberadamente **no** suaves tipo Apple: easing marcado, escalas perceptibles (pedido explícito del rediseño de identidad — "más dinámicas tipo Iron Man HUD").

Sin librería de animación — coherente con que el resto del proyecto no depende de una. Todas las animaciones nuevas de v3 son CSS puro (`transform`, `box-shadow`, `mask`, keyframes), igual que v1/v2.

## Iconografía

`lucide-react` (SVG, un solo grosor de trazo, tree-shakeable, MIT). Tamaño por defecto `h-4 w-4` en línea con texto, `h-5 w-5`/`h-6 w-6` cuando el icono es el elemento principal de una tarjeta, `h-8 w-8` en el botón de voz. Siempre `aria-hidden="true"` — el texto adyacente es lo que transmite el significado a lectores de pantalla.

## Componentes (`apps/web/components/`)

- **`Card`** (`ui/`) — superficie base (`.glass border border-line/80 rounded-2xl` + sombra ambiental), prop `padding` (`sm`/`md`/`lg`) y `interactive`.
- **`Badge`** (`ui/`) — pastilla con degradado suave y glow.
- **`StatusDot`** (`ui/`) — punto de color + texto, niveles `online`/`warning`/`offline`.
- **`HeroStatus`** (`dashboard/`) — el estado de KAN como un ícono + una frase.
- **`KANAvatar`** (`kan/`) — el núcleo animado, puramente presentacional (tamaño/`activity`, no sabe de layout ni de chat). Reusable fuera de `KANLayout` (ej. catálogo de `/design-system`).
- **`KANLayout`** (`kan/`) — el shell de los 3 estados, ver arriba. Recibe `phase`/`activity` ya calculados — no conoce chat/voz.
- **`KANHome`** (`kan/`) — compone `useConversation` + `useKANState` + `useWakeWord` + `KANLayout`; es lo que `DashboardClient` monta como pantalla principal. `panelExtras` recibe los widgets del Dashboard (dispositivos, plugins, actividad) ya resueltos, sin duplicar su fetch.
- **`ConversationPanel`** (`dashboard/`) — presentación "clásica" (burbujas), usada a pantalla completa en `/conversacion` y antes también en el Dashboard compacto. Consume el mismo `useConversation` que `KANHome`.
- **`ThemeAccentPicker`** (`configuracion/`) — el selector de 5 swatches, ver "Identidad KAN" arriba.

## Terminología (regla dura, no solo estilo)

Ningún nombre interno se muestra al usuario — "Gateway", "Edge Agent", "Core", "Plugin Manager", el `id` de un paquete npm (`kan-plugin-*`) o el `kind` crudo de un dispositivo son bugs de producto si aparecen en la UI. Equivalencias ya establecidas:

| Interno | Humano |
|---|---|
| Gateway / Edge Agent / Core (como estados separados) | Un solo estado, ver `HeroStatus` arriba |
| "Edge Agent" (como nombre de equipo vinculado) | `Tu equipo (Windows)` / `Estación N` (ver `DeviceList.tsx`) |
| "N plugin(s) cargado(s)" / "Plugins activos" | "Lo que KAN puede hacer ahora" (`PluginCard`, solo `displayName`, nunca el `id` del paquete) |
| Nombre técnico de una tool (`read_sensor`, `kan_set_memory`) | Frase genérica por categoría — ver `lib/chat/translateToolCall.ts` |
| "Jobs" / "Automatizaciones" | "Recordatorios" / "Tareas programadas" |

## Jerarquía de controles de voz

`VoiceButton` (push-to-talk) es el control primario: círculo de `h-14 w-14`, `bg-accent`, vive directo en la barra de input de `KANHome`/`ConversationPanel`. `LiveVoiceButton` (conversación en vivo/duplex) y `ScreenShareButton` son secundarios a propósito — pill chica para que un usuario nuevo no dude cuál probar primero. El **wake word** (decir "KAN") es un cuarto camino hacia el mismo `useVoiceInput.start()` — no un control nuevo, activa el mismo micrófono que `VoiceButton`.

## Qué NO cambia

`apps/desktop` sigue con su propio tema ad-hoc (`apps/desktop/src/renderer/src/index.css`) — no es parte de este incremento. Ningún puerto, caso de uso ni contrato del Core/Gateway/Edge Agent se toca; esto es exclusivamente la capa de presentación de `apps/web`.
