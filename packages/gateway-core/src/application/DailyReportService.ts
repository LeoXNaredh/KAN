import type { LoggerPort } from "@kan/plugin-contract";
import type { UserPreferencesPort } from "@kan/core";
import type { EmailServicePort } from "../domain/ports/EmailServicePort";
import type { AuditService } from "./AuditService";
import type { AgentRegistry } from "./AgentRegistry";
import { ConsoleLogger } from "../infra/ConsoleLogger";

const ENABLED_KEY = "dailyReportEnabled";
const HOUR_KEY = "dailyReportHour";
const DEFAULT_HOUR = 9;
const REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TICK_INTERVAL_MS = 60 * 60 * 1000;

interface AuditEntryLike {
  at: string;
  action: string;
  metadata: Record<string, unknown>;
}

/**
 * Reporte diario por email al dueño de cada Edge Agent — hermano de
 * `AlertMonitor`: un solo timer (`setInterval`, mismo patrón que
 * `AlertMonitor` en vez de `node-cron`/`NodeCronScheduler` — acá no hace
 * falta sintaxis cron real, solo "chequear más o menos cada hora", y
 * `setInterval` con intervalo inyectable es testeable sin esperar una hora
 * real) en vez de repurposar `ScheduledJob` (modelado para "ejecutar
 * acciones de hardware", no para correr una función arbitraria). "Hora
 * configurable" es UTC liso — no hay concepto de timezone en ningún otro
 * lugar del proyecto, no se inventa acá.
 */
export class DailyReportService {
  private timer?: ReturnType<typeof setInterval>;
  private readonly lastSentDateByOwner = new Map<string, string>();

  constructor(
    private readonly auditService: AuditService,
    private readonly agentRegistry: AgentRegistry,
    private readonly emailService: EmailServicePort,
    private readonly userPreferences: UserPreferencesPort,
    private readonly resolveUserEmail: (userId: string) => Promise<string | undefined>,
    private readonly appUrl: string,
    private readonly logger: LoggerPort = new ConsoleLogger(),
    private readonly tickIntervalMs: number = DEFAULT_TICK_INTERVAL_MS,
  ) {}

  /** No espera al primer intervalo para chequear una vez (mismo criterio que un poll recién arrancado no debería tardar una hora entera en enterarse). */
  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    let enabledPrefs;
    try {
      enabledPrefs = await this.userPreferences.listAllForKey(ENABLED_KEY);
    } catch (error) {
      this.logger.warn("[DailyReportService] no se pudo leer dailyReportEnabled", { error });
      return;
    }

    const currentHour = new Date().getUTCHours();
    const today = new Date().toISOString().slice(0, 10);

    const owners = enabledPrefs.filter((pref) => pref.value === true).map((pref) => pref.userId);
    await Promise.allSettled(
      owners.map(async (ownerId) => {
        if (this.lastSentDateByOwner.get(ownerId) === today) return;

        const hourPref = await this.userPreferences.get(ownerId, HOUR_KEY).catch(() => undefined);
        const hour = typeof hourPref?.value === "number" ? hourPref.value : DEFAULT_HOUR;
        if (hour !== currentHour) return;

        this.lastSentDateByOwner.set(ownerId, today);
        await this.sendReportFor(ownerId);
      }),
    );
  }

  private async sendReportFor(ownerId: string): Promise<void> {
    const ownedAgentIds = this.agentRegistry
      .list()
      .filter((agent) => agent.ownerId === ownerId)
      .map((agent) => agent.edgeAgentId);
    if (ownedAgentIds.length === 0) return;

    const email = await this.resolveUserEmail(ownerId).catch(() => undefined);
    if (!email) {
      this.logger.warn(`[DailyReportService] no se pudo resolver el email de ${ownerId}, se saltea el reporte`);
      return;
    }

    const entries = await this.auditService.list({ userId: ownerId });
    const since = Date.now() - REPORT_WINDOW_MS;
    const recent = entries.filter((entry) => new Date(entry.at).getTime() >= since);

    const alerts = recent.filter((entry) => entry.action === "alert.triggered");
    const results = recent.filter((entry) => entry.action === "tool.execute.result");
    const successfulActions = results.filter((entry) => entry.metadata.success === true).length;
    const failedActions = results.length - successfulActions;

    const { html, text } = buildReportBody({ alerts, results: { total: results.length, successful: successfulActions, failed: failedActions }, appUrl: this.appUrl });
    const date = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });

    await this.emailService.send({
      to: email,
      subject: `KAN — Resumen del día ${date}`,
      html,
      text,
    });
  }
}

function buildReportBody({
  alerts,
  results,
  appUrl,
}: {
  alerts: AuditEntryLike[];
  results: { total: number; successful: number; failed: number };
  appUrl: string;
}): { html: string; text: string } {
  const alertLines = alerts.map((entry) => (typeof entry.metadata.body === "string" ? entry.metadata.body : "Se disparó una alerta."));
  // Una alerta se dispara justo cuando un sensor cruza su umbral (ver
  // AlertMonitor) — mismas entradas que "alertas disparadas", agrupadas
  // acá por sensor (capabilityRef) para responder directo "¿algún sensor
  // estuvo fuera de rango?" sin tener que leer los mensajes uno por uno.
  const sensorsOutOfRange = Array.from(
    new Set(alerts.map((entry) => (typeof entry.metadata.capabilityRef === "string" ? entry.metadata.capabilityRef : undefined)).filter((ref): ref is string => Boolean(ref))),
  );
  const link = `${appUrl}/inicio`;

  const text = [
    `Alertas disparadas: ${alerts.length}`,
    ...alertLines.map((line) => `  - ${line}`),
    "",
    sensorsOutOfRange.length > 0
      ? `Sensores fuera de rango: ${sensorsOutOfRange.join(", ")}`
      : "Sensores fuera de rango: ninguno",
    "",
    `Acciones ejecutadas: ${results.total} (${results.successful} exitosas, ${results.failed} fallidas)`,
    "",
    `Ver en KAN: ${link}`,
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; color: #111;">
      <h2>Resumen del día</h2>
      <p><strong>Alertas disparadas:</strong> ${alerts.length}</p>
      ${alertLines.length > 0 ? `<ul>${alertLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
      <p><strong>Sensores fuera de rango:</strong> ${sensorsOutOfRange.length > 0 ? escapeHtml(sensorsOutOfRange.join(", ")) : "ninguno"}</p>
      <p><strong>Acciones ejecutadas:</strong> ${results.total} (${results.successful} exitosas, ${results.failed} fallidas)</p>
      <p><a href="${link}">Ver en KAN</a></p>
    </div>
  `.trim();

  return { html, text };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
