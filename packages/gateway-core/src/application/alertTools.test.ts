import { describe, expect, it, vi } from "vitest";
import { ALERT_TOOL_DESCRIPTORS, isAlertToolName, executeAlertTool } from "./alertTools";
import { AlertMonitor } from "./AlertMonitor";

function monitor() {
  return new AlertMonitor(vi.fn());
}

describe("isAlertToolName", () => {
  it("reconoce los tres nombres y ningún otro", () => {
    expect(isAlertToolName("kan_set_alert")).toBe(true);
    expect(isAlertToolName("kan_cancel_alert")).toBe(true);
    expect(isAlertToolName("kan_list_alerts")).toBe(true);
    expect(isAlertToolName("kan_schedule_job")).toBe(false);
    expect(isAlertToolName("c_agent1_led_toggle_led")).toBe(false);
  });
});

describe("ALERT_TOOL_DESCRIPTORS", () => {
  it("declara las tres tools", () => {
    expect(ALERT_TOOL_DESCRIPTORS.map((t) => t.name)).toEqual(["kan_set_alert", "kan_cancel_alert", "kan_list_alerts"]);
  });
});

describe("executeAlertTool — kan_set_alert", () => {
  it("crea una alerta y devuelve el alertId", async () => {
    const m = monitor();

    const result = await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_agent1_simulator1_read_sensor",
      field: "temperatureC",
      comparator: "above",
      threshold: 40,
      label: "la temperatura",
      unit: "grados",
    });

    expect(result.success).toBe(true);
    expect((result.data as { alertId: string }).alertId).toEqual(expect.any(String));
    expect(m.list()).toHaveLength(1);
  });

  it("pasa requestingUserId como createdBy de la alerta", async () => {
    const m = monitor();

    await executeAlertTool(
      m,
      "kan_set_alert",
      { capabilityRef: "c_x", comparator: "above", threshold: 40, label: "la temperatura" },
      "user-42",
    );

    expect(m.list()[0].createdBy).toBe("user-42");
  });

  it("rechaza sin 'capabilityRef'", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_set_alert", { comparator: "above", threshold: 40, label: "x" });
    expect(result.success).toBe(false);
    expect(m.list()).toHaveLength(0);
  });

  it("rechaza un 'comparator' inválido", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_x",
      comparator: "sideways",
      threshold: 40,
      label: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza sin 'threshold' numérico", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_x",
      comparator: "above",
      threshold: "cuarenta",
      label: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rechaza sin 'label'", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_set_alert", { capabilityRef: "c_x", comparator: "above", threshold: 40 });
    expect(result.success).toBe(false);
  });

  it("con 'steps' válidos (multi-dispositivo coordinado), los guarda en la alerta", async () => {
    const m = monitor();

    await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_sensor",
      comparator: "above",
      threshold: 35,
      label: "la temperatura",
      steps: [{ capabilityRef: "c_motor", input: { on: false } }, { capabilityRef: "c_led", input: { on: true } }],
    });

    expect(m.list()[0].steps).toEqual([
      { capabilityRef: "c_motor", input: { on: false } },
      { capabilityRef: "c_led", input: { on: true } },
    ]);
  });

  it("sin 'steps', la alerta queda sin secuencia asociada (undefined, no [])", async () => {
    const m = monitor();
    await executeAlertTool(m, "kan_set_alert", { capabilityRef: "c_x", comparator: "above", threshold: 40, label: "x" });
    expect(m.list()[0].steps).toBeUndefined();
  });

  it("rechaza 'steps' inválidos (vacío o sin capabilityRef) en vez de ignorarlos en silencio", async () => {
    const m = monitor();

    const emptySteps = await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_x",
      comparator: "above",
      threshold: 40,
      label: "x",
      steps: [],
    });
    expect(emptySteps.success).toBe(false);

    const noRef = await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_x",
      comparator: "above",
      threshold: 40,
      label: "x",
      steps: [{ input: {} }],
    });
    expect(noRef.success).toBe(false);
    expect(m.list()).toHaveLength(0);
  });

  it("propaga como error el mensaje que lanza alertMonitor.create() (ej. límite de 20 alertas alcanzado)", async () => {
    const m = monitor();
    for (let i = 0; i < 20; i++) {
      await executeAlertTool(
        m,
        "kan_set_alert",
        { capabilityRef: `c_${i}`, comparator: "above", threshold: 40, label: "x" },
        "user-1",
      );
    }

    const result = await executeAlertTool(
      m,
      "kan_set_alert",
      { capabilityRef: "c_21", comparator: "above", threshold: 40, label: "x" },
      "user-1",
    );

    expect(result).toEqual({
      success: false,
      error: "Ya tenés 20 alertas activas. Cancelá alguna antes de crear una nueva.",
    });
  });
});

describe("executeAlertTool — kan_cancel_alert", () => {
  it("cancela una alerta existente", async () => {
    const m = monitor();
    await executeAlertTool(m, "kan_set_alert", { capabilityRef: "c_x", comparator: "above", threshold: 40, label: "x" });
    const alertId = m.list()[0].id;

    const result = await executeAlertTool(m, "kan_cancel_alert", { alertId });

    expect(result).toEqual({ success: true, data: { alertId } });
    expect(m.list()).toHaveLength(0);
  });

  it("da error claro si el alertId no existe", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_cancel_alert", { alertId: "no-existe" });
    expect(result.success).toBe(false);
  });

  it("rechaza sin 'alertId'", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_cancel_alert", {});
    expect(result.success).toBe(false);
  });
});

describe("executeAlertTool — kan_list_alerts", () => {
  it("devuelve las alertas activas resumidas", async () => {
    const m = monitor();
    await executeAlertTool(m, "kan_set_alert", {
      capabilityRef: "c_x",
      field: "temperatureC",
      comparator: "above",
      threshold: 40,
      label: "la temperatura",
      unit: "grados",
    });

    const result = await executeAlertTool(m, "kan_list_alerts", {});

    expect(result.success).toBe(true);
    const alerts = (result.data as { alerts: unknown[] }).alerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      capabilityRef: "c_x",
      field: "temperatureC",
      comparator: "above",
      threshold: 40,
      label: "la temperatura",
      unit: "grados",
    });
  });
});

describe("executeAlertTool — nombre desconocido", () => {
  it("devuelve error en vez de lanzar", async () => {
    const m = monitor();
    const result = await executeAlertTool(m, "kan_otra_cosa", {});
    expect(result).toEqual({ success: false, error: "Tool de alertas desconocida: kan_otra_cosa" });
  });
});
