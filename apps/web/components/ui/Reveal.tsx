"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Envuelve contenido que debe animarse al entrar en el viewport (scroll
 * reveal) — usa un único IntersectionObserver por instancia y se desconecta
 * apenas dispara una vez (no se repite en cada scroll hacia arriba/abajo,
 * a propósito: en listas largas — logs, jobs, memorias — repetir la
 * animación en cada pasada distrae en vez de ayudar). `delay` (ms) permite
 * escalonar filas consecutivas de una misma lista, ej. `delay={index * 40}`.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -32px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
