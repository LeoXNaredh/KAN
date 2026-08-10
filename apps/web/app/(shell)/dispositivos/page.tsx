import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { DeviceList } from "@/components/dispositivos/DeviceList";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";
import { generatePairingCodeAction } from "@/lib/devices/actions";

export default async function DispositivosPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; expiresAt?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUserCached();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Dispositivos</h1>
        <p className="text-sm text-ink-faint">Tu entorno físico — todo lo que KAN puede tocar por vos.</p>
      </div>

      {user && <DeviceList />}

      {user && (
        <Card className="fade-in flex flex-col gap-4">
          <h2 className="text-sm font-medium text-ink-muted">Vincular un nuevo equipo</h2>
          <p className="text-xs text-ink-faint">
            Generá un código, abrí la app de escritorio de KAN y escribilo ahí — tenés 10 minutos antes de que venza.
          </p>

          {params.code && (
            <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-2">
              <span className="font-mono text-lg tracking-widest text-ink">{params.code}</span>
              {params.expiresAt && (
                <span className="text-xs text-ink-faint">Vence: {new Date(params.expiresAt).toLocaleTimeString()}</span>
              )}
            </div>
          )}

          <form action={generatePairingCodeAction}>
            <button type="submit" className={`self-start ${PRIMARY_BUTTON_CLASSES}`}>
              Generar código
            </button>
          </form>
        </Card>
      )}

      {user && (
        <p className="text-sm text-ink-faint">
          ¿Ya vinculaste un equipo?{" "}
          <Link href="/configuracion#plugins" className="text-accent hover:underline">
            Configurá sus plugins de hardware
          </Link>
          .
        </p>
      )}
    </div>
  );
}
