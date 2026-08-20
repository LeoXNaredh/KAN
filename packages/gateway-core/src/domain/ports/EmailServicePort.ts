export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Canal de email saliente (reporte diario) — mismo rol que NotificationServicePort, puerto separado porque el mensaje (asunto/HTML/texto) no calza en el shape genérico {title, body} de una notificación push. */
export interface EmailServicePort {
  send(message: EmailMessage): Promise<void>;
}
