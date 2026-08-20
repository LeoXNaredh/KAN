import Link from "next/link";
import { Cpu, Sliders, Bell, Factory } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

const BENEFITS = [
  {
    icon: Cpu,
    title: "Conectá tu Arduino o Raspberry Pi y KAN lo reconoce solo",
  },
  {
    icon: Sliders,
    title: "Controlá motores, sensores y actuadores por voz o por chat",
  },
  {
    icon: Bell,
    title: "Recibí alertas en tu celular cuando algo sale de rango",
  },
  {
    icon: Factory,
    title: "Funciona para makers y para industria",
  },
];

/**
 * Landing pública en "/" (sin sesión) — Server Component estático, sin
 * ShellChrome (vive fuera del route group (shell), ver app/page.tsx).
 * Reusa Card/PRIMARY_BUTTON_CLASSES/tokens de color existentes, ningún
 * estilo nuevo.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-16">
      <div className="flex w-full max-w-3xl flex-col items-center gap-10 text-center">
        <div className="flex flex-col items-center gap-4">
          <h1 className="bg-gradient-accent bg-clip-text text-3xl font-semibold text-transparent sm:text-4xl">
            KAN — Controlá tu hardware con inteligencia artificial
          </h1>
          <p className="max-w-xl text-sm text-ink-faint sm:text-base">
            El asistente que conecta, entiende y opera tus dispositivos reales — sin escribir código.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {BENEFITS.map(({ icon: Icon, title }) => (
            <Card key={title} padding="md" className="flex flex-col items-center gap-3 text-center sm:items-start sm:text-left">
              <div className="bg-gradient-accent-soft flex h-10 w-10 items-center justify-center rounded-xl">
                <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
              </div>
              <p className="text-sm text-ink">{title}</p>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={PRIMARY_BUTTON_CLASSES}>
            Empezar gratis
          </Link>
          <Link href="/docs" className={SECONDARY_BUTTON_CLASSES}>
            Ver documentación
          </Link>
        </div>
      </div>
    </div>
  );
}
