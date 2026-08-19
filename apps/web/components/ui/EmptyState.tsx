import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

/**
 * Estado vacío consistente (antes: texto suelto distinto en cada pantalla) —
 * ícono grande + título + descripción, con un botón secundario opcional
 * cuando hay algo concreto que hacer al respecto (ej. ir a vincular un
 * dispositivo). Sin `action`, es puramente informativo.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Icon className="h-10 w-10 text-ink-faint" aria-hidden="true" />
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="max-w-xs text-sm text-ink-faint">{description}</p>
      {action && (
        <Link href={action.href} className={`mt-2 ${SECONDARY_BUTTON_CLASSES}`}>
          {action.label}
        </Link>
      )}
    </div>
  );
}
