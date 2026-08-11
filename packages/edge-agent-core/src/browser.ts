// Subconjunto de ./index.ts seguro para el navegador (el Simulador
// corriendo en apps/web, ver docs/19 continuación). Excluye a propósito
// JsonFileConfigStore, FileAndConsoleLogger y CoreWebSocketClient — los
// tres usan módulos de Node (`node:fs`, el paquete `ws`) que no existen en
// un tab. Sus equivalentes de navegador viven en ./infra/browser/*.
export * from "./domain/entities/Device";
export * from "./domain/entities/PluginInstance";
export * from "./domain/entities/PendingConfirmation";
export * from "./domain/entities/SafetyPolicyEntry";
export * from "./domain/ports/ConfigStorePort";
export * from "./domain/ports/LoggerPort";
export * from "./domain/ports/CoreConnectionPort";
export * from "./domain/ports/UpdaterPort";
export * from "./application/EdgeAgentBus";
export * from "./application/PluginManager";
export * from "./application/DeviceManager";
export * from "./application/PermissionManager";
export * from "./application/SafetyPolicyStore";
export * from "./application/CapabilityRegistry";
export * from "./infra/NoopUpdater";
export * from "./infra/browser/LocalStorageConfigStore";
export * from "./infra/browser/ConsoleLogger";
export * from "./infra/browser/BrowserWebSocketClient";
export * from "./EdgeAgent";
