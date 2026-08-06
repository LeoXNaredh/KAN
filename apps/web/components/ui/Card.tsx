import type { HTMLAttributes, ReactNode } from "react";

const PADDING = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padding?: keyof typeof PADDING;
  /** Reduce el énfasis del borde/fondo cuando la tarjeta vive dentro de otra tarjeta. */
  interactive?: boolean;
}

/**
 * Superficie base del Design System (DESIGN_SYSTEM.md): reemplaza la clase
 * repetida `rounded-xl border border-line bg-surface-2 p-4` que antes vivía
 * copiada en cada tarjeta del Dashboard.
 */
export function Card({ children, padding = "md", interactive = false, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-line bg-surface-2 ${PADDING[padding]} ${
        interactive ? "transition-colors hover:border-line-strong" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
