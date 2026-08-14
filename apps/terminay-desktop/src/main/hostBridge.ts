import {
  TERMINAY_HOST_BRIDGE_VERSION,
  parseTerminayHostAction,
  parseTerminayHostActionRequest,
  parseTerminayHostContext,
  requiredTerminayHostCapability,
  type TerminayHostAction,
  type TerminayHostActionRequest,
  type TerminayHostContext,
} from "@terminay/protocol";

export { TERMINAY_HOST_BRIDGE_VERSION as DESKTOP_HOST_BRIDGE_VERSION };
export type DesktopHostAction = TerminayHostAction;
export type DesktopHostRequest = TerminayHostActionRequest;
export type DesktopHostContext = TerminayHostContext;

export type DesktopHostBridgeHandlers = Readonly<Partial<Record<TerminayHostAction["type"], (action: TerminayHostAction, context: TerminayHostContext) => unknown | Promise<unknown>>>>;
export interface DesktopHostBinding { readonly sourceId: string; readonly context: TerminayHostContext; readonly handlers: DesktopHostBridgeHandlers; }

export function validateDesktopHostAction(value: unknown): TerminayHostAction { return parseTerminayHostAction(value); }
export function validateDesktopHostRequest(value: unknown, context: unknown): TerminayHostActionRequest { return parseTerminayHostActionRequest(value, context); }

/** Thin Desktop dispatcher over the one canonical protocol contract. */
export class DesktopHostBridgeRouter {
  private readonly bindings = new Map<string, DesktopHostBinding>();
  register(binding: DesktopHostBinding): void {
    const context = parseTerminayHostContext(binding.context);
    if (binding.sourceId !== context.sourceId) throw new TypeError("host binding source is inconsistent");
    if (this.bindings.has(context.sourceId)) throw new Error(`host source already registered: ${context.sourceId}`);
    this.bindings.set(context.sourceId, Object.freeze({ ...binding, context }));
  }
  unregister(sourceId: string): void { this.bindings.delete(sourceId); }
  context(sourceId: string): TerminayHostContext { return this.require(sourceId).context; }
  async request(value: unknown): Promise<unknown> {
    if (!value || typeof value !== "object") throw new TypeError("host action request must be an object");
    const sourceId = String((value as Record<string, unknown>).sourceId ?? "");
    const binding = this.require(sourceId);
    const request = parseTerminayHostActionRequest(value, binding.context);
    const capability = requiredTerminayHostCapability(request.action);
    if (capability !== undefined && binding.context.capabilities[capability] === undefined) throw new Error(`host capability is unavailable: ${capability}`);
    return binding.handlers[request.action.type]?.(request.action, binding.context);
  }
  private require(sourceId: string): DesktopHostBinding { const binding = this.bindings.get(sourceId); if (binding === undefined) throw new Error("unknown host bridge source"); return binding; }
}
