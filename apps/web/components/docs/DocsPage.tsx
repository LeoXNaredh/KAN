import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Rocket, Sparkles, Factory, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

const NAV_ITEMS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "primeros-pasos", label: "Primeros pasos", icon: Rocket },
  { id: "que-podes-hacer", label: "Qué podés hacer", icon: Sparkles },
  { id: "para-industria", label: "Para industria", icon: Factory },
  { id: "preguntas-frecuentes", label: "Preguntas frecuentes", icon: HelpCircle },
];

function DocEntry({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <p className="text-sm text-ink-faint">{children}</p>
    </div>
  );
}

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="mb-3 text-lg font-semibold text-ink">{title}</h2>
      <Card className="flex flex-col gap-5">{children}</Card>
    </section>
  );
}

/**
 * Documentación pública en /docs (sin sesión) — vive fuera de (shell), sin
 * ShellChrome, misma idea que LandingPage.tsx. Nav por anclas simples (sin
 * JS de scroll-spy): el contenido es estático y no justifica esa complejidad
 * extra.
 */
export function DocsPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-4 sm:px-8">
        <div>
          <p className="text-sm font-semibold text-ink">Documentación de KAN</p>
          <p className="text-xs text-ink-faint">Guía para usar KAN, sin necesidad de saber programar.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/" className={SECONDARY_BUTTON_CLASSES}>
            Volver al inicio
          </Link>
          {signedIn && (
            <Link href="/inicio" className={PRIMARY_BUTTON_CLASSES}>
              Ir a KAN
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8 lg:flex-row lg:items-start">
        <nav
          aria-label="Secciones de la documentación"
          className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-8 lg:w-52 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {label}
            </a>
          ))}
        </nav>

        <main className="flex min-w-0 flex-1 flex-col gap-8">
          <DocSection id="primeros-pasos" title="Primeros pasos">
            <DocEntry title="Cómo crear una cuenta">
              Entrá a /signup y creá tu cuenta con email y contraseña, o con Google. No hace falta ninguna tarjeta ni
              instalar nada todavía.
            </DocEntry>
            <DocEntry title="Cómo descargar la app de escritorio">
              Para controlar hardware real necesitás la app de escritorio de KAN (Windows, macOS o Linux) — es la que
              se conecta a tus dispositivos por USB y le avisa al resto de KAN que están online.
            </DocEntry>
            <DocEntry title="Cómo conectar tu primer dispositivo (Arduino, ESP32 o Raspberry Pi Pico)">
              Conectá tu placa por USB a la computadora donde corre la app de escritorio. Después andá a /dispositivos
              en la web, generá un código de vinculación y pegalo en la app de escritorio — desde ese momento tu
              equipo queda vinculado a tu cuenta.
            </DocEntry>
            <DocEntry title="Cómo verificar que KAN lo reconoció">
              Volvé a /dispositivos: tu equipo va a aparecer con estado &quot;en línea&quot; y, debajo, la lista de
              placas que detectó automáticamente.
            </DocEntry>
          </DocSection>

          <DocSection id="que-podes-hacer" title="Qué podés hacer">
            <DocEntry title="Controlar hardware por chat o por voz">
              Escribile a KAN o hablale — &quot;prendé el ventilador&quot;, &quot;subí el motor al 80%&quot; — y KAN
              traduce eso a la acción concreta sobre tu dispositivo.
            </DocEntry>
            <DocEntry title="Configurar alertas cuando algo sale de rango">
              Definí un umbral para cualquier sensor (temperatura, humedad, lo que sea que reporte tu placa) y KAN te
              avisa apenas se sale de ese rango.
            </DocEntry>
            <DocEntry title="Crear secuencias automáticas">
              Encadená varios pasos — por ejemplo &quot;prender bomba, esperar 10 segundos, apagar bomba&quot; — y
              ejecutalos con un solo comando en vez de uno por uno.
            </DocEntry>
            <DocEntry title="Ver los sensores en tiempo real">
              La pantalla de sensores muestra las últimas lecturas de cada dispositivo conectado a medida que van
              llegando, sin recargar la página.
            </DocEntry>
          </DocSection>

          <DocSection id="para-industria" title="Para industria">
            <DocEntry title="Cómo invitar a tu equipo">
              Desde /dispositivos, el dueño de un equipo puede invitar a otras personas por email para que también
              vean y controlen esos mismos dispositivos.
            </DocEntry>
            <DocEntry title="Cómo programar acciones por horario">
              En /automatizaciones podés programar que KAN dispare una secuencia de pasos en un horario fijo o de
              forma recurrente, sin que nadie tenga que estar ejecutándola a mano.
            </DocEntry>
            <DocEntry title="Cómo exportar el historial">
              En /logs tenés el historial completo de actividad, con filtros por texto, actor y fecha, y un botón
              para exportarlo como CSV.
            </DocEntry>
          </DocSection>

          <DocSection id="preguntas-frecuentes" title="Preguntas frecuentes">
            <DocEntry title="¿Necesito saber programar?">No. Todo se maneja por chat, voz o desde la interfaz web.</DocEntry>
            <DocEntry title="¿Funciona sin internet?">
              Por ahora necesita conexión para el chat con IA, pero el control local de tus dispositivos funciona
              igual sin internet.
            </DocEntry>
            <DocEntry title="¿Qué dispositivos son compatibles?">
              Por ahora: Arduino, ESP32 y Raspberry Pi Pico conectados por USB a la app de escritorio. KAN sigue
              sumando soporte para más hardware.
            </DocEntry>
            <DocEntry title="¿Es seguro?">
              Sí — antes de ejecutar una acción física irreversible o riesgosa, KAN te pide confirmarla
              explícitamente en vez de ejecutarla sola. Ninguna acción de ese tipo se dispara sin tu aprobación.
            </DocEntry>
          </DocSection>
        </main>
      </div>
    </div>
  );
}
