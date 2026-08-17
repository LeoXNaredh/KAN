/**
 * Tonos sintéticos del boot sequence (BootSequence.tsx) — generados en
 * código vía Web Audio API, sin archivos de audio externos. Todo se agenda
 * de una vez sobre el reloj del propio AudioContext (`ctx.currentTime +
 * delaySec`), más preciso que encadenar `setTimeout` y no depende de que el
 * render/JS timers vayan exactamente al ritmo de las animaciones CSS.
 */
interface ToneSpec {
  frequency: number;
  delaySec: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
}

function playTone(ctx: AudioContext, { frequency, delaySec, duration = 0.12, type = "sine", gain = 0.05 }: ToneSpec): void {
  const startTime = ctx.currentTime + delaySec;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  // Envolvente corta (ataque rápido, decaimiento exponencial) — un tono sin
  // esto suena como un click brusco al empezar/terminar, no un "blip" de HUD.
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.05);
}

/**
 * Crea el AudioContext y agenda la secuencia completa del boot — nunca
 * lanza: los navegadores bloquean audio sin gesto previo del usuario en la
 * primera carga (autoplay policy), y eso es exactamente el caso de un boot
 * sequence; sin sonido, la secuencia visual sigue igual (sonido opcional,
 * degradación silenciosa, mismo criterio que useSpeechSynthesis.ts).
 * Devuelve `undefined` si Web Audio no está disponible o falla al crearse.
 */
export function scheduleBootSounds(): AudioContext | undefined {
  if (typeof window === "undefined") return undefined;

  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return undefined;

  try {
    const ctx = new AudioContextClass();
    void ctx.resume().catch(() => {});

    // Letras "K", "A", "N" — blips cortos y agudos, en step con kan-boot-letter.
    playTone(ctx, { frequency: 1180, delaySec: 0.08, duration: 0.05, type: "square", gain: 0.025 });
    playTone(ctx, { frequency: 1320, delaySec: 0.22, duration: 0.05, type: "square", gain: 0.025 });
    playTone(ctx, { frequency: 1480, delaySec: 0.36, duration: 0.05, type: "square", gain: 0.025 });

    // Avatar materializando — un tono grave, sostenido, en kan-boot-avatar-in.
    playTone(ctx, { frequency: 96, delaySec: 0.6, duration: 0.55, type: "sine", gain: 0.05 });

    // Paneles desplegándose — arpegio ascendente (A4, C#5, E5).
    playTone(ctx, { frequency: 440, delaySec: 1.15, duration: 0.14, type: "triangle", gain: 0.035 });
    playTone(ctx, { frequency: 554.37, delaySec: 1.27, duration: 0.14, type: "triangle", gain: 0.035 });
    playTone(ctx, { frequency: 659.25, delaySec: 1.4, duration: 0.2, type: "triangle", gain: 0.035 });

    return ctx;
  } catch {
    return undefined;
  }
}
