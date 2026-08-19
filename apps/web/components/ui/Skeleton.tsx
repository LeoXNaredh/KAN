/**
 * Bloque base de carga (`animate-pulse` + `bg-surface-2`, el mismo tono que
 * ya usa `Card` para su superficie — un skeleton debe leerse como "una
 * tarjeta real, todavía sin contenido", no como un tono nuevo). Las
 * variantes de abajo solo fijan tamaño/radio; `className` sigue disponible
 * para ajustar cualquiera de las tres al tamaño real de la fila que
 * reemplazan.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} />;
}

/** Línea de texto — título, fila de lista, campo de formulario. */
export function SkeletonText({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-4 w-full ${className}`} />;
}

/** Bloque tipo tarjeta (`rounded-2xl`, mismo radio que `Card` en DESIGN_SYSTEM.md). */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-20 w-full rounded-2xl ${className}`} />;
}

/** Avatar/ícono circular. */
export function SkeletonAvatar({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-10 w-10 rounded-full ${className}`} />;
}
