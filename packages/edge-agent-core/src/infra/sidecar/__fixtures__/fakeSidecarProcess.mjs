// Doble de `kan_plugin_sdk_py.runner` para `SidecarProxyPlugin.test.ts`
// (ADR-056): habla el protocolo real (sidecarProtocol.ts) por un WebSocket
// real contra el `SidecarWsHost` real, en Node en vez de Python — el
// mismo criterio "proceso real, protocolo real" sin depender de que este
// entorno tenga Python/venv instalados (ver plan de implementación,
// Fase 3, SidecarProxyPlugin.test.ts).
import { WebSocket } from "ws";

const PLUGIN_ID = "kan-plugin-fixture-test";
const behavior = process.env.FAKE_SIDECAR_BEHAVIOR ?? "normal";

if (behavior === "crash-before-hello") {
  process.stderr.write("fakeSidecarProcess: simulando crash antes de conectar\n");
  process.exit(7);
}

const wsUrl = process.env.KAN_SIDECAR_WS_URL;
const token = process.env.KAN_SIDECAR_TOKEN;

const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "sidecar_hello",
      protocolVersion: "1.0.0",
      pluginId: PLUGIN_ID,
      pluginVersion: "0.1.0",
      token,
    }),
  );
});

ws.on("message", (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }

  switch (message.type) {
    case "sidecar_hello_ack":
      return;

    case "discover":
      ws.send(
        JSON.stringify({
          type: "discover.result",
          requestId: message.requestId,
          devices: [{ id: "fixture-0", name: "Fixture Device", kind: "fixture" }],
        }),
      );
      return;

    case "connect":
      if (behavior === "reject-connect") {
        ws.send(
          JSON.stringify({
            type: "connect.result",
            requestId: message.requestId,
            ok: false,
            error: "conexión rechazada a propósito (fixture)",
          }),
        );
        return;
      }
      ws.send(
        JSON.stringify({
          type: "connect.result",
          requestId: message.requestId,
          ok: true,
          capabilities: [
            { name: "ping", description: "Responde pong.", severity: "read-only", supportsDryRun: false },
          ],
        }),
      );
      return;

    case "disconnect":
      ws.send(JSON.stringify({ type: "disconnect.result", requestId: message.requestId, ok: true }));
      return;

    case "invoke":
      ws.send(
        JSON.stringify({
          type: "invoke.result",
          requestId: message.requestId,
          result: { success: true, data: { echoed: message.input ?? null } },
        }),
      );
      return;

    case "list_targets":
      ws.send(JSON.stringify({ type: "list_targets.result", requestId: message.requestId, targets: [] }));
      return;

    case "shutdown":
      ws.close();
      process.exit(0);
      return;

    default:
      return; // forma inesperada — se ignora, mismo criterio que el resto del protocolo
  }
});

ws.on("error", () => {
  process.exit(1);
});
