import type { ToolDescriptor } from "@kan/plugin-contract";
import type { GlobalCapabilityRegistry } from "./GlobalCapabilityRegistry";

export interface ToolRegistry {
  list(): ToolDescriptor[];
  get(name: string): ToolDescriptor | undefined;
}

/** El catálogo de tools se deriva 1:1 del catálogo de capabilities — nunca diverge. */
export class CapabilityBackedToolRegistry implements ToolRegistry {
  constructor(private readonly capabilities: GlobalCapabilityRegistry) {}

  list(): ToolDescriptor[] {
    return this.capabilities.list().map((c) => ({
      name: c.ref,
      description: c.capability.description,
      inputSchema: c.capability.inputSchema ?? {},
    }));
  }

  get(name: string): ToolDescriptor | undefined {
    return this.list().find((tool) => tool.name === name);
  }
}
