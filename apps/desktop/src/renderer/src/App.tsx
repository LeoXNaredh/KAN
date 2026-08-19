import { useEffect, useState } from "react";
import type {
  Device,
  CapabilityListing,
  PendingConfirmation,
  CoreConnectionStatus,
  SafetyTargetListing,
  PluginInstance,
  InstalledPlugin,
  VidPidCatalogEntry,
} from "@kan/edge-agent-core";
import { describeConfirmationConsequence, type ActionSeverity, type IoMapEntry, type PluginPermissions } from "@kan/plugin-contract";
import type { BusEvent, PluginCatalogEntryDTO } from "../../preload/index";

const SEVERITY_OPTIONS: ActionSeverity[] = ["read-only", "reversible", "irreversible-material", "safety-critical"];

// localStorage (Chromium real del renderer, mismo mecanismo que
// LocalStorageConfigStore de @kan/edge-agent-core) — "una vez en la vida",
// mismo criterio que kan:welcome-seen en apps/web.
const WELCOME_SEEN_KEY = "kan-welcome-seen";

const WELCOME_EXAMPLES = [
  "Conectá tu Arduino o Raspberry Pi y te cuento qué encontré",
  "Avisame cuando un sensor salga de rango",
  "Coordiná varios dispositivos en secuencia",
] as const;

interface LogEntry {
  level: string;
  message: string;
  at: string;
}

interface PendingPluginPermission {
  pluginId: string;
  displayName: string;
  permissions: PluginPermissions;
}

function toPendingPluginPermission(instance: Pick<PluginInstance, "manifest">): PendingPluginPermission {
  return {
    pluginId: instance.manifest.id,
    displayName: instance.manifest.displayName,
    permissions: instance.manifest.permissions,
  };
}

const STATUS_LABEL: Record<CoreConnectionStatus, string> = {
  connected: "Conectado al Core",
  connecting: "Conectando al Core…",
  reconnecting: "Reconectando al Core…",
  disconnected: "Desconectado del Core",
};

const STATUS_COLOR: Record<CoreConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500",
  reconnecting: "bg-amber-500",
  disconnected: "bg-zinc-500",
};

const SEVERITY_COLOR: Record<string, string> = {
  "read-only": "bg-sky-900 text-sky-200",
  reversible: "bg-emerald-900 text-emerald-200",
  "irreversible-material": "bg-amber-900 text-amber-200",
  "safety-critical": "bg-red-900 text-red-200",
};

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityListing[]>([]);
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [pendingPlugins, setPendingPlugins] = useState<PendingPluginPermission[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pluginWarnings, setPluginWarnings] = useState<LogEntry[]>([]);
  const [coreStatus, setCoreStatus] = useState<CoreConnectionStatus>("disconnected");
  const [safetyTargets, setSafetyTargets] = useState<Record<string, SafetyTargetListing[]>>({});
  const [ioMaps, setIoMaps] = useState<Record<string, IoMapEntry[]>>({});
  const [paired, setPaired] = useState<boolean | null>(null);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogEntryDTO[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [installProgress, setInstallProgress] = useState<Record<string, string>>({});
  const [installErrors, setInstallErrors] = useState<Record<string, string>>({});
  const [customVidPidCatalog, setCustomVidPidCatalog] = useState<VidPidCatalogEntry[]>([]);
  // Lectura sincrónica al inicializar el estado (sin SSR acá, a diferencia
  // de apps/web — no hay riesgo de mismatch de hidratación): "ya visto" por
  // defecto si localStorage no está disponible, mismo criterio que
  // DashboardClient.tsx.
  const [welcomeSeen, setWelcomeSeen] = useState<boolean>(() => {
    try {
      return Boolean(window.localStorage.getItem(WELCOME_SEEN_KEY));
    } catch {
      return true;
    }
  });

  function refreshInstalledPlugins() {
    window.kan.listInstalledPlugins().then(setInstalledPlugins);
  }

  function refreshCustomVidPidCatalog() {
    window.kan.listCustomVidPidCatalog().then(setCustomVidPidCatalog);
  }

  function loadSafetyTargets(deviceId: string) {
    window.kan.listSafetyTargets(deviceId).then((targets: SafetyTargetListing[]) => {
      setSafetyTargets((prev) => ({ ...prev, [deviceId]: targets }));
    });
  }

  /**
   * `discover_io_map` es `read-only` — nunca pasa por confirmación, así que
   * es seguro dispararla sola apenas el dispositivo conecta (ADR-058), mismo
   * punto de enganche que `loadSafetyTargets`. También queda disponible como
   * botón manual en `IoMapPanel` para volver a pedirla bajo demanda.
   */
  function refreshIoMap(deviceId: string) {
    window.kan
      .invokeCapability(deviceId, "discover_io_map", {})
      .then((outcome) => {
        if (outcome.status === "executed" && outcome.result.success) {
          const entries = (outcome.result.data as { entries?: IoMapEntry[] } | undefined)?.entries ?? [];
          setIoMaps((prev) => ({ ...prev, [deviceId]: entries }));
        }
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    (async () => {
      const loadedDevices: Device[] = await window.kan.listDevices();
      setDevices(loadedDevices);
      const loadedCapabilities: CapabilityListing[] = await window.kan.listCapabilities();
      setCapabilities(loadedCapabilities);
      setCoreStatus(await window.kan.getCoreStatus());
      loadedDevices.forEach((device) => {
        loadSafetyTargets(device.id);
        if (loadedCapabilities.some((c) => c.deviceId === device.id && c.capability.name === "discover_io_map")) {
          refreshIoMap(device.id);
        }
      });
      setPaired((await window.kan.getPairingStatus()).paired);
      // Bandeja de confirmaciones pendientes (requisito: verlas aunque no
      // estuvieras mirando cuando se dispararon — ej. una secuencia de una
      // alerta mientras la ventana estaba cerrada, ver el comentario en
      // EdgeAgent.listPendingConfirmations()). Después de esta hidratación
      // inicial, las que lleguen en vivo siguen entrando por el evento
      // "permission.pending" de siempre, más abajo.
      setPending(await window.kan.listPendingConfirmations());
      const pendingInstances: Pick<PluginInstance, "manifest" | "status">[] =
        await window.kan.listPendingPluginPermissions();
      setPendingPlugins(pendingInstances.map(toPendingPluginPermission));
      setInstalledPlugins(await window.kan.listInstalledPlugins());
      setCustomVidPidCatalog(await window.kan.listCustomVidPidCatalog());
      // Sin vincular con una cuenta todavía, listPluginCatalog() lanza
      // ("Todavía no vinculaste..."): no es un error a mostrar, el catálogo
      // simplemente queda vacío hasta que el usuario vincule (PairingPanel
      // arriba ya comunica eso) — PluginsPanel no se renderiza sin nada que mostrar.
      await window.kan.listPluginCatalog().then(setPluginCatalog).catch(() => undefined);
    })();

    const unsubscribe = window.kan.onEvent((event: BusEvent) => {
      switch (event.type) {
        case "device.connected":
          setDevices((prev) => [...prev.filter((d) => d.id !== event.payload.device.id), event.payload.device]);
          setCapabilities((prev) => [
            ...prev.filter((c) => c.deviceId !== event.payload.device.id),
            ...event.payload.device.capabilities.map((capability) => ({
              deviceId: event.payload.device.id,
              deviceName: event.payload.device.name,
              deviceKind: event.payload.device.kind,
              capability,
            })),
          ]);
          loadSafetyTargets(event.payload.device.id);
          if (event.payload.device.capabilities.some((c) => c.name === "discover_io_map")) {
            refreshIoMap(event.payload.device.id);
          }
          break;
        case "safety_policy.changed":
          loadSafetyTargets(event.payload.entry.deviceId);
          break;
        case "device.disconnected":
          setDevices((prev) =>
            prev.map((d) => (d.id === event.payload.deviceId ? { ...d, status: "disconnected" } : d)),
          );
          break;
        case "permission.pending":
          setPending((prev) => [...prev, event.payload.confirmation]);
          break;
        case "permission.resolved":
          setPending((prev) => prev.filter((c) => c.id !== event.payload.confirmationId));
          break;
        case "plugin.permission_pending":
          setPendingPlugins((prev) => [
            ...prev.filter((p) => p.pluginId !== event.payload.pluginId),
            event.payload,
          ]);
          break;
        case "plugin.permission_resolved":
          setPendingPlugins((prev) => prev.filter((p) => p.pluginId !== event.payload.pluginId));
          break;
        case "plugin.install_progress":
          setInstallProgress((prev) => ({ ...prev, [event.payload.pluginId]: event.payload.step }));
          setInstallErrors((prev) => {
            const { [event.payload.pluginId]: _removed, ...rest } = prev;
            return rest;
          });
          break;
        case "plugin.installed":
          setInstallProgress((prev) => {
            const { [event.payload.pluginId]: _removed, ...rest } = prev;
            return rest;
          });
          refreshInstalledPlugins();
          break;
        case "plugin.install_failed":
          setInstallProgress((prev) => {
            const { [event.payload.pluginId]: _removed, ...rest } = prev;
            return rest;
          });
          setInstallErrors((prev) => ({ ...prev, [event.payload.pluginId]: event.payload.error }));
          break;
        case "plugin.uninstalled":
          refreshInstalledPlugins();
          break;
        case "core.status":
          setCoreStatus(event.payload.status);
          break;
        case "log":
          setLogs((prev) => [...prev.slice(-199), event.payload]);
          // Un plugin que no pudo registrarse (ej. ESP32/Modbus/serial sin
          // el binding nativo compilado) hoy solo escribe `logger.warn(...)`
          // — antes de P3.7 ese aviso quedaba enterrado en el panel de Logs
          // (o directamente se perdía, ver el comentario sobre el orden del
          // forwarding en apps/desktop/src/main/index.ts). Estos avisos de
          // carga de plugin son accionables (instalar Visual Studio Build
          // Tools) y merecen un banner que no se pueda pasar por alto.
          if (event.payload.level === "warn" && event.payload.message.startsWith("No se pudo cargar el plugin")) {
            setPluginWarnings((prev) => [...prev, event.payload]);
          }
          break;
      }
    });

    return unsubscribe;
  }, []);

  function invoke(deviceId: string, capabilityName: string, input: unknown) {
    window.kan.invokeCapability(deviceId, capabilityName, input).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setLogs((prev) => [
        ...prev.slice(-199),
        { level: "error", message: `Invocación falló: ${message}`, at: new Date().toISOString() },
      ]);
    });
  }

  // Primera vez: sin ningún dispositivo visto todavía y sin haber cerrado ya
  // esta bienvenida antes (mismo criterio combinado que DashboardClient.tsx
  // en apps/web — señal real de "recién arrancando" + persistencia local
  // para no repetirla).
  if (!welcomeSeen && devices.length === 0) {
    return (
      <FirstRunWelcome
        onStart={() => {
          setWelcomeSeen(true);
          try {
            window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
          } catch {
            // Sin storage no se puede recordar — se repetiría en el próximo arranque, no es grave.
          }
        }}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col gap-4 bg-zinc-950 p-4 text-zinc-50">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">KAN Edge Agent</h1>
          <p className="text-sm text-zinc-400">Infraestructura local — dispositivos, plugins y permisos.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1 text-sm">
          <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[coreStatus]}`} />
          {STATUS_LABEL[coreStatus]}
        </div>
      </header>

      {paired !== null && <PairingPanel paired={paired} onPaired={() => setPaired(true)} />}

      {pluginWarnings.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-200">
          {pluginWarnings.map((warning, index) => (
            <div key={index} className="flex items-start justify-between gap-3">
              <span>⚠ {warning.message}</span>
              <button
                className="shrink-0 text-xs text-amber-400 underline hover:text-amber-200"
                onClick={() => setPluginWarnings((prev) => prev.filter((_, i) => i !== index))}
              >
                Descartar
              </button>
            </div>
          ))}
        </div>
      )}

      <PluginsPanel
        catalog={pluginCatalog}
        installed={installedPlugins}
        progress={installProgress}
        errors={installErrors}
        onInstalledChanged={refreshInstalledPlugins}
      />

      <VidPidCatalogPanel entries={customVidPidCatalog} onChanged={refreshCustomVidPidCatalog} />

      <div className="grid flex-1 grid-cols-[1.4fr_1fr] gap-4 overflow-hidden">
        <section className="flex flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-800 p-4">
          <h2 className="text-sm font-medium text-zinc-400">Dispositivos</h2>
          {devices.length === 0 && <p className="text-sm text-zinc-500">Descubriendo dispositivos…</p>}
          {devices.map((device) => (
            <div key={device.id} className="rounded-md border border-zinc-800 bg-zinc-900 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{device.name}</span>
                <span className="text-xs text-zinc-500">
                  {device.kind} · {device.status}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {capabilities
                  .filter((c) => c.deviceId === device.id)
                  .map((c) => (
                    <div
                      key={c.capability.name}
                      className="flex items-center justify-between gap-3 rounded border border-zinc-800 px-2 py-1.5"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{c.capability.name}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${SEVERITY_COLOR[c.capability.severity]}`}>
                            {c.capability.severity}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500">{c.capability.description}</p>
                      </div>
                      <CapabilityControls
                        onInvoke={(input) => invoke(device.id, c.capability.name, input)}
                        capabilityName={c.capability.name}
                      />
                    </div>
                  ))}
              </div>
              {safetyTargets[device.id] && safetyTargets[device.id].length > 0 && (
                <SafetyPolicyPanel deviceId={device.id} targets={safetyTargets[device.id]} />
              )}
              {capabilities.some((c) => c.deviceId === device.id && c.capability.name === "discover_io_map") && (
                <IoMapPanel entries={ioMaps[device.id] ?? []} onRefresh={() => refreshIoMap(device.id)} />
              )}
            </div>
          ))}
        </section>

        <section className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 p-4">
          <h2 className="mb-2 text-sm font-medium text-zinc-400">Logs</h2>
          <div className="flex-1 overflow-y-auto font-mono text-xs">
            {logs.map((log, index) => (
              <div key={index} className="whitespace-pre-wrap text-zinc-400">
                <span className="text-zinc-600">{log.at.slice(11, 19)}</span> [{log.level}] {log.message}
              </div>
            ))}
          </div>
        </section>
      </div>

      {pending[0] && <ConfirmationModal confirmation={pending[0]} />}
      {!pending[0] && pendingPlugins[0] && <PluginPermissionModal plugin={pendingPlugins[0]} />}
    </div>
  );
}

function CapabilityControls({
  capabilityName,
  onInvoke,
}: {
  capabilityName: string;
  onInvoke: (input: unknown) => void;
}) {
  if (capabilityName === "toggle_led") {
    return (
      <div className="flex gap-1">
        <button className="btn" onClick={() => onInvoke({ on: true })}>
          Encender
        </button>
        <button className="btn" onClick={() => onInvoke({ on: false })}>
          Apagar
        </button>
      </div>
    );
  }
  if (capabilityName === "move_axis") {
    return (
      <button className="btn" onClick={() => onInvoke({ distanceMm: 10 })}>
        Mover +10mm
      </button>
    );
  }
  return (
    <button className="btn" onClick={() => onInvoke({})}>
      Invocar
    </button>
  );
}

function SafetyPolicyPanel({ deviceId, targets }: { deviceId: string; targets: SafetyTargetListing[] }) {
  const [drafts, setDrafts] = useState<Record<string, { alias: string; severity: ActionSeverity }>>({});

  function draftFor(target: SafetyTargetListing) {
    return drafts[target.target] ?? { alias: target.alias ?? target.suggestedAlias ?? "", severity: target.effectiveSeverity };
  }

  function save(target: SafetyTargetListing) {
    const draft = draftFor(target);
    window.kan.setSafetyPolicy(deviceId, target.target, draft.severity, draft.alias || undefined);
  }

  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <h3 className="mb-2 text-xs font-medium text-zinc-400">
        Safety Policy — clasificación de targets (pines). Sin configurar = usa el default más restrictivo.
      </h3>
      <div className="flex flex-col gap-1.5">
        {targets.map((target) => {
          const draft = draftFor(target);
          return (
            <div key={target.target} className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1.5 text-xs">
              <span className="w-16 font-mono text-zinc-400">{target.target}</span>
              <input
                className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1"
                placeholder="Alias (ej. Relé bomba de agua)"
                value={draft.alias}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [target.target]: { ...draft, alias: e.target.value } }))
                }
              />
              <select
                className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1"
                value={draft.severity}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [target.target]: { ...draft, severity: e.target.value as ActionSeverity },
                  }))
                }
              >
                {SEVERITY_OPTIONS.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${target.configured ? "bg-emerald-900 text-emerald-200" : "bg-zinc-800 text-zinc-400"}`}>
                {target.configured ? "configurado" : `default: ${target.defaultSeverity}`}
              </span>
              <button className="btn" onClick={() => save(target)}>
                Guardar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const IO_MODE_LABEL: Record<string, string> = {
  input: "entrada",
  output: "salida",
  unknown: "desconocido",
};

/**
 * Mapa de IO de `discover_io_map` (ADR-058) — tabla simple, no un diagrama
 * gráfico del dispositivo (eso queda fuera de alcance de este incremento).
 * Se auto-completa apenas el dispositivo conecta (ver `refreshIoMap` en
 * `App`); el botón "Actualizar" solo permite volver a pedirlo a mano.
 */
function IoMapPanel({ entries, onRefresh }: { entries: IoMapEntry[]; onRefresh: () => void }) {
  return (
    <div className="mt-3 border-t border-zinc-800 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-400">Mapa de IO — estado conocido del dispositivo</h3>
        <button className="btn" onClick={onRefresh}>
          Actualizar
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-500">Sin datos todavía.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <div
              key={entry.target}
              className="flex items-center gap-2 rounded border border-zinc-800 px-2 py-1 text-xs"
            >
              <span className="w-20 shrink-0 font-mono text-zinc-400">{entry.target}</span>
              <span className="w-16 shrink-0 text-zinc-500">{entry.type}</span>
              <span className="w-20 shrink-0 text-zinc-500">{IO_MODE_LABEL[entry.mode] ?? entry.mode}</span>
              <span className="flex-1 font-mono">{entry.value === null ? "—" : String(entry.value)}</span>
              {entry.label && <span className="shrink-0 text-zinc-500">{entry.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Vinculación con una cuenta (docs/19 P2, incremento 3) — siempre visible,
 * no bloquea el resto de la UI: un Edge Agent sin vincular sigue
 * funcionando igual que hoy, esto solo agrega la identidad. Tras un
 * pairing exitoso, el proceso principal reinicia la app (ver
 * apps/desktop/src/main/index.ts) — `onPaired` es un fallback defensivo
 * por si la respuesta llega antes de que el proceso termine de cerrar.
 */
function PairingPanel({ paired, onPaired }: { paired: boolean; onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done" | "error">("idle");

  async function submit() {
    setPending(true);
    setError(undefined);
    const result = await window.kan.pairAgent(code.trim());
    if (result.ok) {
      onPaired();
    } else {
      setError(result.error);
      setPending(false);
    }
  }

  async function sync() {
    setSyncState("syncing");
    const result = await window.kan.syncPluginConfig();
    setSyncState(result.ok ? "done" : "error");
  }

  if (paired) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
        <span>Vinculado con tu cuenta.</span>
        <button
          className="btn"
          disabled={syncState === "syncing"}
          onClick={sync}
          title="Trae la config de plugins que guardaste en /configuracion, sin reiniciar la app"
        >
          {syncState === "syncing" ? "Sincronizando…" : "Sincronizar configuración"}
        </button>
        {syncState === "done" && <span className="text-xs text-emerald-400">Listo.</span>}
        {syncState === "error" && <span className="text-xs text-red-400">No se pudo sincronizar.</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
      <span className="text-sm text-zinc-400">Vincular con tu cuenta:</span>
      <input
        className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm uppercase tracking-widest"
        placeholder="Código de 8 caracteres"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        maxLength={8}
      />
      <button className="btn" disabled={pending || code.trim().length === 0} onClick={submit}>
        {pending ? "Vinculando…" : "Vincular"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}

/**
 * Catálogo + instalados de plugins sidecar (ADR-056) — sin nada que
 * mostrar (sin vincular todavía, o catálogo vacío, y ningún plugin
 * instalado) no se renderiza nada, para no ocupar espacio de la pantalla
 * principal con una sección vacía. Instalar dispara el mismo flujo de
 * aprobación de permisos que cualquier plugin (`PluginPermissionModal`
 * arriba) — esta sección no lo duplica.
 */
function PluginsPanel({
  catalog,
  installed,
  progress,
  errors,
  onInstalledChanged,
}: {
  catalog: PluginCatalogEntryDTO[];
  installed: InstalledPlugin[];
  progress: Record<string, string>;
  errors: Record<string, string>;
  onInstalledChanged: () => void;
}) {
  const installedIds = new Set(installed.map((plugin) => plugin.pluginId));

  async function install(pluginId: string) {
    // El resultado real (éxito o error) llega por los eventos
    // plugin.installed/plugin.install_failed — este catch solo evita una
    // promesa rechazada sin manejar si install() lanza antes de emitir nada.
    await window.kan.installPlugin(pluginId).catch(() => undefined);
  }

  async function uninstall(pluginId: string) {
    if (!window.confirm(`¿Desinstalar "${pluginId}"? Esto borra el paquete descargado del disco.`)) return;
    await window.kan.uninstallPlugin(pluginId);
    onInstalledChanged();
  }

  if (catalog.length === 0 && installed.length === 0) return null;

  return (
    <section className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-800 p-4">
      <h2 className="text-sm font-medium text-zinc-400">Plugins sidecar — instalables bajo demanda (ADR-056)</h2>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">Catálogo</h3>
          <div className="flex flex-col gap-1.5">
            {catalog.length === 0 && <p className="text-xs text-zinc-600">Sin plugins en el catálogo.</p>}
            {catalog.map((entry) => {
              const pluginId = entry.manifest.id;
              const step = progress[pluginId];
              const error = errors[pluginId];
              const alreadyInstalled = installedIds.has(pluginId);
              return (
                <div
                  key={pluginId}
                  className="flex items-center justify-between gap-3 rounded border border-zinc-800 px-2 py-1.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-200">{entry.manifest.displayName}</div>
                    {entry.description && <div className="truncate text-zinc-500">{entry.description}</div>}
                    {step && <div className="text-sky-400">Instalando: {step}…</div>}
                    {error && <div className="text-red-400">{error}</div>}
                  </div>
                  <button
                    className="btn shrink-0"
                    disabled={alreadyInstalled || Boolean(step)}
                    onClick={() => install(pluginId)}
                  >
                    {alreadyInstalled ? "Instalado" : step ? "Instalando…" : "Instalar"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">Instalados</h3>
          <div className="flex flex-col gap-1.5">
            {installed.length === 0 && <p className="text-xs text-zinc-600">Ningún plugin sidecar instalado todavía.</p>}
            {installed.map((plugin) => (
              <div
                key={plugin.pluginId}
                className="flex items-center justify-between gap-3 rounded border border-zinc-800 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-zinc-200">{plugin.manifest.displayName}</div>
                  <div className="text-zinc-500">
                    v{plugin.version} · instalado el {new Date(plugin.installedAt).toLocaleDateString()}
                  </div>
                </div>
                <button className="btn shrink-0" onClick={() => uninstall(plugin.pluginId)}>
                  Desinstalar
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Dispositivos que el usuario agregó a mano al catálogo VID/PID custom
 * (ADR-060) — hasta ahora solo se podía editar `vid-pid-custom.json` con un
 * editor de texto; esto es la UI para hacerlo sin tocar archivos. Guarda a
 * disco de inmediato y KAN lo toma en el próximo escaneo (la detección en
 * caliente ya sondea cada pocos segundos, ver DEVICE_DISCOVERY_POLL_MS en
 * apps/desktop/src/main/index.ts) — no hace falta reiniciar la app.
 */
function VidPidCatalogPanel({
  entries,
  onChanged,
}: {
  entries: VidPidCatalogEntry[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [productId, setProductId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(undefined);
    const result = await window.kan.addCustomVidPidCatalogEntry({
      name: name.trim(),
      vendorId: vendorId.trim(),
      productId: productId.trim(),
    });
    setSubmitting(false);
    if (result.ok) {
      setName("");
      setVendorId("");
      setProductId("");
      onChanged();
    } else {
      setError(result.error);
    }
  }

  async function remove(entry: VidPidCatalogEntry) {
    if (!window.confirm(`¿Eliminar "${entry.name}" del catálogo?`)) return;
    await window.kan.removeCustomVidPidCatalogEntry(entry.vendorId, entry.productId);
    onChanged();
  }

  const canSubmit = name.trim().length > 0 && vendorId.trim().length > 0 && productId.trim().length > 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-400">Dispositivos que agregaste vos</h2>
        <p className="text-xs text-zinc-500">
          Si KAN no reconoce un dispositivo por su nombre cuando lo conectás, agregalo acá una vez y la próxima vez ya lo va a identificar solo.
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-xs text-zinc-600">Todavía no agregaste ningún dispositivo.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <div
              key={`${entry.vendorId}-${entry.productId}`}
              className="flex items-center justify-between gap-3 rounded border border-zinc-800 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-zinc-200">{entry.name}</div>
                <div className="text-zinc-500">
                  VID {entry.vendorId} · PID {entry.productId}
                </div>
              </div>
              <button className="btn shrink-0" onClick={() => remove(entry)}>
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
        <div className="grid grid-cols-3 gap-2">
          <input
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm"
            placeholder='Nombre (ej: "Mi PLC Siemens custom")'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm"
            placeholder="VID (ej: 0x1234)"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          />
          <input
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm"
            placeholder="PID (ej: 0x5678)"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          />
        </div>
        <p className="text-xs text-zinc-600">
          ¿No sabés estos números? Los encontrás en el Administrador de dispositivos de Windows, bajo Propiedades del
          dispositivo.
        </p>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button className="btn self-start" disabled={submitting || !canSubmit} onClick={submit}>
          {submitting ? "Agregando…" : "Agregar dispositivo"}
        </button>
      </div>
    </section>
  );
}

/**
 * Deny-by-default (ADR-008/ADR-041, P8): un plugin recién registrado no
 * descubre ningún dispositivo hasta que el usuario aprueba acá los permisos
 * que declaró — mismo criterio visual que `ConfirmationModal`, pero es una
 * capa distinta (permiso de instalación, no confirmación de una invocación
 * puntual).
 */
function PluginPermissionModal({ plugin }: { plugin: PendingPluginPermission }) {
  const { permissions } = plugin;
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-sky-800 bg-zinc-900 p-5">
        <h3 className="mb-1 text-base font-semibold text-sky-300">Nuevo plugin: {plugin.displayName}</h3>
        <p className="mb-3 text-sm text-zinc-400">
          Este plugin pide los siguientes permisos. No se habilita ni descubre dispositivos hasta que lo apruebes.
        </p>
        <div className="mb-4 flex flex-col gap-1.5 rounded bg-zinc-950 p-2 text-xs text-zinc-300">
          <div>
            <span className="text-zinc-500">Dispositivos: </span>
            {permissions.devices.length > 0 ? permissions.devices.join(", ") : "ninguno"}
          </div>
          <div>
            <span className="text-zinc-500">Red: </span>
            {permissions.network ? "sí" : "no"}
          </div>
          <div>
            <span className="text-zinc-500">Filesystem: </span>
            {permissions.filesystem.length > 0 ? permissions.filesystem.join(", ") : "ninguno"}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={() => window.kan.rejectPluginPermissions(plugin.pluginId)}>
            Rechazar
          </button>
          <button
            className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-sky-500"
            onClick={() => window.kan.approvePluginPermissions(plugin.pluginId)}
          >
            Aprobar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pantalla de bienvenida de primera vez (mismo texto exacto que
 * FirstRunWelcome.tsx en apps/web — no menciona "chat" a propósito, sirve
 * igual para este panel de hardware local). Reemplaza el panel completo
 * hasta que el usuario hace clic en "Empezar" — gate en `App()`, ver
 * `WELCOME_SEEN_KEY`.
 */
function FirstRunWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 p-4 text-zinc-50">
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p className="text-xl font-medium tracking-tight">Hola, soy KAN.</p>
        <p className="mt-1 text-sm text-zinc-400">Puedo controlar y monitorear tu hardware desde acá.</p>

        <ul className="mt-6 flex flex-col gap-3 text-left">
          {WELCOME_EXAMPLES.map((example, index) => (
            <li key={example} className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-black">
                {index + 1}
              </span>
              <span className="pt-0.5 text-sm text-zinc-300">{example}</span>
            </li>
          ))}
        </ul>

        <button
          className="mt-7 w-full rounded bg-sky-600 px-4 py-2 text-sm font-medium text-black hover:bg-sky-500"
          onClick={onStart}
        >
          Empezar
        </button>
      </div>
    </div>
  );
}

function ConfirmationModal({ confirmation }: { confirmation: PendingConfirmation }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-amber-800 bg-zinc-900 p-5">
        <h3 className="mb-1 text-base font-semibold text-amber-300">¿Confirmás esta acción?</h3>
        <p className="mb-4 text-sm text-zinc-400">{describeConfirmationConsequence(confirmation.severity)}</p>
        <div className="flex justify-end gap-2">
          <button
            className="btn"
            onClick={() => window.kan.resolveConfirmation(confirmation.id, false)}
          >
            No, cancelar
          </button>
          <button
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-500"
            onClick={() => window.kan.resolveConfirmation(confirmation.id, true)}
          >
            Sí, hacelo
          </button>
        </div>
      </div>
    </div>
  );
}
