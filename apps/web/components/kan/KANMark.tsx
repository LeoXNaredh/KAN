/**
 * Logomark de KAN — una "K" angular con un quiebre recto en vez de las
 * diagonales curvas de una K tipográfica normal, mismo criterio de
 * geometría angular del resto de la identidad Kukulkán (el anillo del
 * avatar, los bordes de las tarjetas). Trazo (`stroke`, no `fill`) para
 * quedar visualmente en la misma familia que los íconos de `lucide-react`
 * que ya usa el resto de la app — reemplaza el ícono genérico (`Sparkles`)
 * que tenía el Sidebar antes del rediseño de identidad.
 */
export function KANMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 4v16" />
      <path d="M6 12h4.5" />
      <path d="M10.5 12 18 4.5" />
      <path d="M10.5 12 18 19.5" />
    </svg>
  );
}
