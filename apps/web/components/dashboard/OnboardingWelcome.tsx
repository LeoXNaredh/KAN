import Link from "next/link";
import { MessageSquareText, Cpu, Mic } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";

const STEPS = [
  {
    icon: MessageSquareText,
    title: "Contale algo",
    body: "Escribile como le escribirías a una persona — preguntale qué puede hacer, o simplemente charlá.",
    href: "/conversacion",
    cta: "Ir a Conversación",
  },
  {
    icon: Cpu,
    title: "Conectá tu primer dispositivo",
    body: "Vinculá el equipo donde tenés algo conectado (una impresora, un microcontrolador, lo que sea) para que KAN pueda actuar sobre él.",
    href: "/dispositivos",
    cta: "Ir a Dispositivos",
  },
  {
    icon: Mic,
    title: "Probá hablarle",
    body: "El micrófono está siempre a mano en la conversación — no hace falta escribir si preferís hablar.",
    href: "/conversacion",
    cta: "Probar la voz",
  },
] as const;

/**
 * Bienvenida guiada para un usuario sin memoria ni dispositivos todavía
 * (rediseño de interfaz, roadmap Línea B) — tres pasos concretos, no una
 * lista de opciones técnicas. Se deja de mostrar sola, apenas el usuario
 * tenga un recuerdo guardado o un dispositivo conectado (ver criterio en
 * `DashboardClient`).
 */
export function OnboardingWelcome({ displayName }: { displayName: string | undefined }) {
  return (
    <Card className="fade-in flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium text-ink">
          {displayName ? `Bienvenido, ${displayName}.` : "Bienvenido."}
        </h2>
        <p className="mt-1 text-sm text-ink-faint">
          KAN es un asistente que entiende lenguaje natural y puede actuar sobre tus dispositivos, recordar cosas
          sobre vos, y ayudarte con tareas del día a día. Así arrancás:
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <Reveal
            key={step.title}
            delay={index * 60}
            className="flex flex-col gap-2 rounded-xl border border-line/60 bg-surface-3/60 p-3 transition-all duration-fast hover:-translate-y-0.5 hover:border-accent/40 hover:bg-surface-3"
          >
            <div className="flex items-center gap-2">
              <span className="bg-gradient-accent flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                {index + 1}
              </span>
              <step.icon className="h-4 w-4 text-accent" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-ink">{step.title}</p>
            <p className="flex-1 text-xs text-ink-faint">{step.body}</p>
            <Link href={step.href} className="press text-xs font-medium text-accent hover:underline">
              {step.cta} →
            </Link>
          </Reveal>
        ))}
      </div>
    </Card>
  );
}
