// Procesa el audio del micrófono en el hilo de audio (no el principal) y lo
// convierte a PCM16 — el AudioContext de entrada ya corre a 16kHz (ADR-044),
// así que acá solo hace falta el cast float32 -> int16, sin resamplear.
class Pcm16CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channelData = inputs[0]?.[0];
    if (channelData && channelData.length > 0) {
      const pcm16 = new Int16Array(channelData.length);
      for (let i = 0; i < channelData.length; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm16-capture-processor", Pcm16CaptureProcessor);
