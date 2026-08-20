import { Resend } from "resend";
import type { LoggerPort } from "@kan/plugin-contract";
import type { EmailMessage, EmailServicePort } from "../domain/ports/EmailServicePort";
import { ConsoleLogger } from "./ConsoleLogger";

/**
 * Email saliente vía Resend (resend.com) — gratuito hasta 3000/mes, SDK
 * simple para Node. Best-effort, mismo criterio que
 * ExpoNotificationService/WebPushNotificationService: `send()` nunca
 * lanza, un email que falla no debe romper el flujo que lo disparó
 * (DailyReportService).
 *
 * `fromAddress` sin dominio propio verificado en Resend solo puede usar
 * `onboarding@resend.dev` (sandbox, alcance limitado) — para mandar a
 * cualquier destinatario real en producción hace falta verificar un
 * dominio propio en el dashboard de Resend (configuración del usuario, no
 * algo que este código pueda resolver).
 */
export class ResendEmailService implements EmailServicePort {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly fromAddress: string,
    private readonly logger: LoggerPort = new ConsoleLogger(),
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      const { error } = await this.client.emails.send({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (error) {
        this.logger.warn("[ResendEmailService] Resend rechazó el email", { error });
      }
    } catch (error) {
      this.logger.warn("[ResendEmailService] no se pudo mandar el email", { error });
    }
  }
}
