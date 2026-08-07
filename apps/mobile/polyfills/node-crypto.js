// Polyfill de "node:crypto" para Metro/Hermes (docs/18, incremento 2).
// @kan/core (Message.ts) importa `randomUUID` de "node:crypto" — correcto
// para sus consumidores reales (apps/web, tests bajo Node), pero Hermes no
// tiene ese módulo. Se resuelve solo acá (ver metro.config.js), sin tocar
// @kan/core: el paquete compartido sigue siendo correcto para Node.
import { randomUUID } from "expo-crypto";

export { randomUUID };
