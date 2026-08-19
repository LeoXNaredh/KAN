import { Cpu, Bell, Workflow } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Reveal } from "@/components/ui/Reveal";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

const EXAMPLES = [
  { icon: Cpu, text: "Conectá tu Arduino o Raspberry Pi y te cuento qué encontré" },
  { icon: Bell, text: "Avisame cuando un sensor salga de rango" },
  { icon: Workflow, text: "Coordiná varios dispositivos en secuencia" },
] as const;

/**
 * Pantalla de bienvenida de primera vez — a diferencia de `OnboardingWelcome`
 * (tarjeta liviana embebida en el home del chat, sigue mostrándose mientras
 * el usuario siga sin memorias/dispositivos), esta reemplaza por completo el
 * contenido de la página hasta que el usuario hace clic en "Empezar": es la
 * primera impresión, no una guía persistente. Gateada en `DashboardClient`
 * por `isNewUser` + `localStorage`, para no volver a aparecer nunca una vez
 * vista (ver criterio de esa combinación ahí).
 */
export function FirstRunWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card padding="lg" className="fade-in w-full max-w-md text-center">
        <p className="text-xl font-medium tracking-tight text-ink">Hola, soy KAN.</p>
        <p className="mt-1 text-sm text-ink-faint">Puedo controlar y monitorear tu hardware desde acá.</p>

        <ul className="mt-6 flex flex-col gap-3 text-left">
          {EXAMPLES.map((example, index) => (
            <Reveal key={example.text} as="li" delay={index * 80} className="flex items-start gap-3">
              <span className="bg-gradient-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white">
                <example.icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="pt-1 text-sm text-ink-muted">{example.text}</span>
            </Reveal>
          ))}
        </ul>

        <button type="button" onClick={onStart} className={`mt-7 w-full ${PRIMARY_BUTTON_CLASSES}`}>
          Empezar
        </button>
      </Card>
    </div>
  );
}
