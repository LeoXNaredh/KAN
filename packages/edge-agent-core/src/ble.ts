/**
 * Subpath separado a propósito (ADR-060) — `NobleBleScanner.ts` importa
 * `@abandonware/noble` de forma estática; si ese import se re-exportara
 * desde el índice principal de este paquete, cualquier consumidor (incluido
 * `apps/web`, que nunca toca hardware Bluetooth) heredaría el riesgo de que
 * noble reviente al cargar. Mismo criterio que `./browser` — un subpath
 * aparte, importado solo por quien lo necesita (`apps/desktop`), con
 * `import()` dinámico + try/catch en el punto de construcción (mismo patrón
 * ya usado ahí para `@kan/plugin-raspberry-pi`).
 */
export { NobleBleScanner } from "./infra/NobleBleScanner";
