import { describe, expect, it } from "vitest";
import { translateToolCall, translateToolResult } from "./translateToolCall";

describe("translateToolCall", () => {
  it("traduce nombres de memoria", () => {
    expect(translateToolCall("kan_set_memory")).toBe("Guardando en memoria…");
  });

  it("traduce nombres de tarea programada", () => {
    expect(translateToolCall("kan_schedule_job")).toBe("Programando tarea…");
    expect(translateToolCall("kan_cancel_job")).toBe("Programando tarea…");
  });

  it("traduce nombres de contexto de sesión", () => {
    expect(translateToolCall("kan_set_active_device")).toBe("Actualizando el contexto…");
  });

  it("traduce nombres de consulta (read/get/list/scan/discover)", () => {
    expect(translateToolCall("read_sensor")).toBe("Consultando tu dispositivo…");
    expect(translateToolCall("get_status")).toBe("Consultando tu dispositivo…");
    expect(translateToolCall("scan_bluetooth_devices")).toBe("Consultando tu dispositivo…");
  });

  it("traduce nombres de acción (write/set/toggle/move/print)", () => {
    expect(translateToolCall("toggle_led")).toBe("Actuando sobre tu dispositivo…");
    expect(translateToolCall("move_axis")).toBe("Actuando sobre tu dispositivo…");
    expect(translateToolCall("write_register")).toBe("Actuando sobre tu dispositivo…");
  });

  it("cae al genérico para un nombre desconocido, sin romper", () => {
    expect(translateToolCall("algo_nuevo_del_futuro")).toBe("Trabajando en eso…");
  });

  it("nunca devuelve el nombre técnico de la tool ni JSON", () => {
    const phrase = translateToolCall("kan_otra_cosa");
    expect(phrase).not.toContain("kan_otra_cosa");
    expect(phrase).not.toMatch(/[{}[\]]/);
  });
});

describe("translateToolResult", () => {
  it("frase de éxito por categoría", () => {
    expect(translateToolResult("read_sensor", true)).toBe("Consulta lista.");
    expect(translateToolResult("kan_set_memory", true)).toBe("Guardado en memoria.");
  });

  it("frase de error con el detalle, sin el nombre técnico de la tool", () => {
    const message = translateToolResult("write_register", false, "timeout del dispositivo");
    expect(message).toBe("No se pudo completar: timeout del dispositivo");
    expect(message).not.toContain("write_register");
  });

  it("error sin detalle cae a un mensaje genérico", () => {
    expect(translateToolResult("write_register", false)).toBe("No se pudo completar: error desconocido");
  });
});
