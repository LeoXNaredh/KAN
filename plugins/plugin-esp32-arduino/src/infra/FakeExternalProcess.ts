import type { ExternalProcessPort, ExternalProcessResult } from "../externalProcess";

export interface RecordedRun {
  command: string;
  args: string[];
  cwd?: string;
}

/** Fake de `ExternalProcessPort` para tests — graba cada invocación y responde según un handler configurable (ADR-012: mismo criterio que `FakeSerialTransport`). */
export class FakeExternalProcess implements ExternalProcessPort {
  readonly calls: RecordedRun[] = [];

  constructor(
    private readonly handler: (call: RecordedRun) => ExternalProcessResult | Promise<ExternalProcessResult> = () => ({
      exitCode: 0,
      stderr: "",
    }),
  ) {}

  async run(command: string, args: string[], options: { cwd?: string; timeoutMs: number }): Promise<ExternalProcessResult> {
    const call = { command, args, cwd: options.cwd };
    this.calls.push(call);
    return this.handler(call);
  }
}
