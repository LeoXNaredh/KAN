import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { AlertMonitor, type CapabilityReader } from "./AlertMonitor";
import type { AlertRule } from "../domain/entities/AlertRule";
import type { AlertRuleStorePort } from "../domain/ports/AlertRuleStorePort";
import type { TaskResult } from "../domain/entities/GatewayTask";

class FakeAlertRuleStore implements AlertRuleStorePort {
  rules: AlertRule[] = [];
  load(): AlertRule[] {
    return this.rules;
  }
  save(rule: AlertRule): void {
    this.rules = [...this.rules.filter((r) => r.id !== rule.id), rule];
  }
  remove(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }
}

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function baseInput(overrides: Partial<Omit<AlertRule, "id" | "createdAt">> = {}): Omit<AlertRule, "id" | "createdAt"> {
  return {
    capabilityRef: "c_agent1_simulator1_read_sensor",
    field: "temperatureC",
    comparator: "above",
    threshold: 40,
    label: "la temperatura",
    unit: "grados",
    ...overrides,
  };
}

describe("AlertMonitor — create/cancel/list", () => {
  it("create() persiste y aparece en list()", () => {
    const store = new FakeAlertRuleStore();
    const monitor = new AlertMonitor(vi.fn(), store);

    const rule = monitor.create(baseInput());

    expect(monitor.list()).toEqual([rule]);
    expect(store.rules).toEqual([rule]);
  });

  it("carga las reglas ya persistidas al construirse", () => {
    const store = new FakeAlertRuleStore();
    store.save({ ...baseInput(), id: "r1", createdAt: "2026-01-01T00:00:00.000Z" });

    const monitor = new AlertMonitor(vi.fn(), store);

    expect(monitor.list()).toHaveLength(1);
    expect(monitor.list()[0].id).toBe("r1");
  });

  it("cancel() la saca de list() y del store", () => {
    const store = new FakeAlertRuleStore();
    const monitor = new AlertMonitor(vi.fn(), store);
    const rule = monitor.create(baseInput());

    monitor.cancel(rule.id);

    expect(monitor.list()).toEqual([]);
    expect(store.rules).toEqual([]);
  });

  it("cancel() de una alerta inexistente no lanza", () => {
    const monitor = new AlertMonitor(vi.fn());
    expect(() => monitor.cancel("no-existe")).not.toThrow();
  });

  it("funciona sin store (ej. tests, host sin filesystem) — no persiste pero sigue funcionando en memoria", () => {
    const monitor = new AlertMonitor(vi.fn());
    const rule = monitor.create(baseInput());
    expect(monitor.list()).toEqual([rule]);
  });

  it.each([
    ["capabilityRef vacío", baseInput({ capabilityRef: "" })],
    ["comparator inválido", baseInput({ comparator: "sideways" as never })],
    ["threshold no numérico", baseInput({ threshold: NaN })],
    ["label vacío", baseInput({ label: "" })],
  ])("rechaza crear una alerta con %s", (_label, input) => {
    const monitor = new AlertMonitor(vi.fn());
    expect(() => monitor.create(input)).toThrow();
  });
});

describe("AlertMonitor — límite de alertas activas por usuario", () => {
  it("permite crear hasta 20 alertas para el mismo createdBy", () => {
    const monitor = new AlertMonitor(vi.fn());
    for (let i = 0; i < 20; i++) monitor.create(baseInput({ createdBy: "user-1" }));
    expect(monitor.list()).toHaveLength(20);
  });

  it("rechaza la alerta número 21 para el mismo createdBy con un mensaje claro", () => {
    const monitor = new AlertMonitor(vi.fn());
    for (let i = 0; i < 20; i++) monitor.create(baseInput({ createdBy: "user-1" }));

    expect(() => monitor.create(baseInput({ createdBy: "user-1" }))).toThrow(
      "Ya tenés 20 alertas activas. Cancelá alguna antes de crear una nueva.",
    );
    expect(monitor.list()).toHaveLength(20);
  });

  it("el límite es por usuario — otro createdBy no se ve afectado", () => {
    const monitor = new AlertMonitor(vi.fn());
    for (let i = 0; i < 20; i++) monitor.create(baseInput({ createdBy: "user-1" }));

    expect(() => monitor.create(baseInput({ createdBy: "user-2" }))).not.toThrow();
  });

  it("las alertas sin createdBy comparten su propio cupo de 20", () => {
    const monitor = new AlertMonitor(vi.fn());
    for (let i = 0; i < 20; i++) monitor.create(baseInput({ createdBy: undefined }));

    expect(() => monitor.create(baseInput({ createdBy: undefined }))).toThrow();
  });

  it("cancelar una alerta libera espacio bajo el límite", () => {
    const monitor = new AlertMonitor(vi.fn());
    const rules = Array.from({ length: 20 }, () => monitor.create(baseInput({ createdBy: "user-1" })));

    monitor.cancel(rules[0].id);

    expect(() => monitor.create(baseInput({ createdBy: "user-1" }))).not.toThrow();
    expect(monitor.list()).toHaveLength(20);
  });
});

describe("AlertMonitor — sondeo (edge-triggered)", () => {
  let monitor: AlertMonitor;
  let reader: CapabilityReader;
  let dispatched: Array<{ rule: AlertRule; value: number }>;

  beforeEach(() => {
    vi.useFakeTimers();
    dispatched = [];
  });

  afterEach(() => {
    monitor?.stop();
    vi.useRealTimers();
  });

  function setup(readerImpl: CapabilityReader, pollIntervalMs = 1000) {
    reader = vi.fn(readerImpl);
    monitor = new AlertMonitor(reader, undefined, fakeLogger(), pollIntervalMs);
    monitor.start(async (rule, value) => {
      dispatched.push({ rule, value });
    });
  }

  it("dispara dispatch() la primera vez que el valor cruza el umbral ('above')", async () => {
    let temp = 30;
    setup(async () => ({ status: "done", data: { temperatureC: temp } }) as TaskResult);
    monitor.create(baseInput());

    temp = 43;
    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].value).toBe(43);
  });

  it("no vuelve a disparar en cada poll mientras el valor siga cruzado", async () => {
    const temp = 43;
    setup(async () => ({ status: "done", data: { temperatureC: temp } }) as TaskResult);
    monitor.create(baseInput());

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(1);
  });

  it("vuelve a poder disparar si el valor vuelve a rango y cruza de nuevo", async () => {
    let temp = 43;
    setup(async () => ({ status: "done", data: { temperatureC: temp } }) as TaskResult);
    monitor.create(baseInput());
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispatched).toHaveLength(1);

    temp = 30; // vuelve a rango normal
    await vi.advanceTimersByTimeAsync(1000);
    temp = 45; // cruza de nuevo
    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(2);
  });

  it("comparator 'below' dispara cuando el valor cae por debajo del umbral", async () => {
    let level = 80;
    setup(async () => ({ status: "done", data: { level } }) as TaskResult);
    monitor.create(baseInput({ capabilityRef: "c_battery", field: "level", comparator: "below", threshold: 20, label: "el nivel de batería" }));

    level = 15;
    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].value).toBe(15);
  });

  it("sin 'field', usa el resultado tal cual si ya es un número", async () => {
    let value = 10;
    setup(async () => ({ status: "done", data: value }) as TaskResult);
    monitor.create(baseInput({ field: undefined, threshold: 50 }));

    value = 55;
    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(1);
  });

  it("un resultado que no está 'done' (falló/pendiente de confirmación) no dispara ni revienta el ciclo", async () => {
    setup(async () => ({ status: "failed", error: "desconectado" }) as TaskResult);
    monitor.create(baseInput());

    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(0);
  });

  it("un valor no numérico (field inexistente) no dispara ni revienta el ciclo", async () => {
    setup(async () => ({ status: "done", data: { otroCampo: 99 } }) as TaskResult);
    monitor.create(baseInput());

    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(0);
  });

  it("un reader que lanza para una regla no impide sondear las demás", async () => {
    const calls: string[] = [];
    setup(async (ref) => {
      calls.push(ref);
      if (ref === "c_falla") throw new Error("boom");
      return { status: "done", data: { temperatureC: 99 } } as TaskResult;
    });
    monitor.create(baseInput({ capabilityRef: "c_falla" }));
    monitor.create(baseInput({ capabilityRef: "c_ok" }));

    await vi.advanceTimersByTimeAsync(1000);

    expect(calls).toEqual(expect.arrayContaining(["c_falla", "c_ok"]));
    expect(dispatched).toHaveLength(1);
  });

  it("stop() detiene el sondeo — ningún poll más corre después", async () => {
    setup(async () => ({ status: "done", data: { temperatureC: 43 } }) as TaskResult);
    monitor.create(baseInput());
    monitor.stop();

    await vi.advanceTimersByTimeAsync(5000);

    expect(dispatched).toHaveLength(0);
  });

  it("una regla cancelada deja de sondearse", async () => {
    setup(async () => ({ status: "done", data: { temperatureC: 43 } }) as TaskResult);
    const rule = monitor.create(baseInput());
    monitor.cancel(rule.id);

    await vi.advanceTimersByTimeAsync(1000);

    expect(dispatched).toHaveLength(0);
  });

  it("pollAll() corre las reglas en paralelo (Promise.allSettled) — una regla lenta no bloquea a las demás", async () => {
    let resolveSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      resolveSlow = resolve;
    });

    setup(async (ref) => {
      if (ref === "c_slow") await slowGate;
      return { status: "done", data: { temperatureC: 43 } } as TaskResult;
    });
    monitor.create(baseInput({ capabilityRef: "c_slow" }));
    monitor.create(baseInput({ capabilityRef: "c_fast" }));

    await vi.advanceTimersByTimeAsync(1000);

    // La regla rápida ya se resolvió y disparó, aunque "c_slow" sigue colgada
    // esperando su propia promesa — si fuera secuencial, "c_fast" recién se
    // procesaría después de que "c_slow" termine.
    expect(dispatched.some((d) => d.rule.capabilityRef === "c_fast")).toBe(true);
    expect(dispatched.some((d) => d.rule.capabilityRef === "c_slow")).toBe(false);

    resolveSlow?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(dispatched.some((d) => d.rule.capabilityRef === "c_slow")).toBe(true);
  });
});
