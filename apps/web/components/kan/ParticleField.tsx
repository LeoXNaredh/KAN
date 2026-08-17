"use client";

import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 46;
const MAX_SPEED = 0.06;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

function createParticles(width: number, height: number): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * MAX_SPEED,
    vy: (Math.random() - 0.5) * MAX_SPEED,
    radius: Math.random() * 1.2 + 0.4,
  }));
}

/**
 * Fondo de partículas flotantes (rediseño eDEX-UI) — canvas puro, sin
 * librería: un puñado de puntos del color de acento a la deriva muy lenta,
 * detrás de todo el contenido (mismo z-index que `body::before`/`::after`).
 * Se salta la animación entera si `prefers-reduced-motion` está activo
 * (dibuja el frame inicial estático y no arranca el loop) — mismo criterio
 * de accesibilidad que el resto del rediseño (ver `@media` en globals.css),
 * aplicado acá a mano porque un `requestAnimationFrame` en loop no lo puede
 * frenar `animation-duration: 0.01ms` de CSS.
 */
export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles: Particle[] = [];
    let frameId: number | undefined;
    let width = 0;
    let height = 0;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = createParticles(width, height);
    }

    function accentColor(): string {
      return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#00ff9d";
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const color = accentColor();
      for (const particle of particles) {
        if (!reduceMotion) {
          particle.x += particle.vx;
          particle.y += particle.vy;
          if (particle.x < 0) particle.x = width;
          if (particle.x > width) particle.x = 0;
          if (particle.y < 0) particle.y = height;
          if (particle.y > height) particle.y = 0;
        }

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.fill();
      }
      // `prefers-reduced-motion`: dibuja el frame estático una sola vez, sin
      // reprogramar el próximo — el `requestAnimationFrame` en loop es
      // exactamente el tipo de movimiento continuo que ese ajuste pide evitar.
      if (!reduceMotion) frameId = window.requestAnimationFrame(draw);
    }

    resize();
    window.addEventListener("resize", resize);
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[-1]"
    />
  );
}
