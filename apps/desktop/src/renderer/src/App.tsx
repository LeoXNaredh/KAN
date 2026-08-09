import { useEffect, useState } from "react";
import type {
  Device,
  CapabilityListing,
  PendingConfirmation,
  CoreConnectionStatus,
  SafetyTargetListing,
  PluginInstance,
} from "@kan/edge-agent-core";
import type { ActionSeverity, PluginPermissions } from "@kan/plugin-contract";
import type { BusEvent } from "../../preload/index";

const SEVERITY_OPTIONS: ActionSeverity[] = ["read-only", "reversible", "irreversible-material", "safety-critical"];

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

function toPendingPluginPermission(instance: PluginInstance): PendingPluginPermission {
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
  const [coreStatus, setCoreStatus] = useState<CoreConnectionStatus>("disconnected");
  const [safetyTargets, setSafetyTargets] = useState<Record<string, SafetyTargetListing[]>>({});
  const [paired, setPaired] = useState<boolean | null>(null);

  function loadSafetyTargets(deviceId: string) {
    window.kan.listSafetyTargets(deviceId).then((targets: SafetyTargetListing[]) => {
      setSafetyTargets((prev) => ({ ...prev, [deviceId]: targets }));
    });
  }

  useEffect(() => {
    (async () => {
      const loadedDevices: Device[] = await window.kan.listDevices();
      setDevices(loadedDevices);
      setCapabilities(await window.kan.listCapabilities());
      setCoreStatus(await window.kan.getCoreStatus());
      loadedDevices.forEach((device) => loadSafetyTargets(device.id));
      setPaired((await window.kan.getPairingStatus()).paired);
      const pendingInstances: PluginInstance[] = await window.kan.listPendingPluginPermissions();
      setPendingPlugins(pendingInstances.map(toPendingPluginPermission));
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
        case "core.status":
          setCoreStatus(event.payload.status);
          break;
        case "log":
          setLogs((prev) => [...prev.slice(-199), event.payload]);
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

  if (paired) {
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
        Vinculado con tu cuenta.
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

function ConfirmationModal({ confirmation }: { confirmation: PendingConfirmation }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-lg border border-amber-800 bg-zinc-900 p-5">
        <h3 className="mb-1 text-base font-semibold text-amber-300">Confirmación requerida</h3>
        <p className="mb-3 text-sm text-zinc-400">
          Esta acción es <strong>{confirmation.severity}</strong> y no se ejecuta sin tu confirmación explícita
          (ADR-004).
        </p>
        <div className="mb-4 rounded bg-zinc-950 p-2 font-mono text-xs text-zinc-300">
          {confirmation.capabilityName} en {confirmation.deviceId}
          <br />
          input: {JSON.stringify(confirmation.input)}
        </div>
        <div className="flex justify-end gap-2">
          <button
            className="btn"
            onClick={() => window.kan.resolveConfirmation(confirmation.id, false)}
          >
            Rechazar
          </button>
          <button
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-500"
            onClick={() => window.kan.resolveConfirmation(confirmation.id, true)}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
