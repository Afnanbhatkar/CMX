/**
 * CodeMind X V2 — Debug Adapter Protocol foundation (V2.1 ADDITIONS §G).
 *
 * ARCHITECTURE RESERVATION ONLY. Full debugging is intentionally deferred to
 * the later editor-overlay phase. This module exists so the future DAP
 * integration has a stable typed seam — and so the product can say, honestly,
 * "debugging is not implemented" instead of pretending.
 *
 * What is NOT here (and must never be faked): breakpoints that hit, variable
 * inspection, paused stacks, watch evaluation, stepping. No UI consumes
 * these contracts yet; the command palette renders the disabled entry with
 * the honest reason via getDebugCapability().
 */

/** Minimal DAP-shaped adapter seam (subset, typed for future phases). */
export type DebugAdapterKind = "dap" | "reserved";

export interface DebugBreakpoint {
  id: string;
  path: string;
  line: number;
  /** Verified by a real adapter when true — never client-guessed. */
  verified: boolean;
}

export interface DebugStackFrame {
  id: number;
  path: string | null;
  line: number | null;
  name: string;
}

export interface DebugAdapter {
  readonly kind: DebugAdapterKind;
  /** Human label, e.g. "Node.js DAP". */
  readonly label: string;
  /** start a session — a real adapter negotiates DAP over a transport. */
  start(config: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }>;
  setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<{ ok: boolean; reason?: string }>;
  stackTrace(threadId: number): Promise<{ ok: boolean; frames?: DebugStackFrame[]; reason?: string }>;
  disconnect(): Promise<void>;
}

export interface DebugCapability {
  available: boolean;
  reason: string;
  /** DAP is the planned protocol — recorded, not claimed. */
  plannedProtocol: "dap";
}

/**
 * The honest capability probe. Deliberately static until the editor-overlay
 * phase wires a real adapter factory.
 */
export function getDebugCapability(): DebugCapability {
  return {
    available: false,
    reason:
      "Debugging arrives with the later editor-overlay phase via the Debug Adapter Protocol — breakpoints, stepping and variable inspection are never simulated.",
    plannedProtocol: "dap",
  };
}

/**
 * Reserved factory anchor. A future phase registers its adapter factory
 * here (e.g. node DAP over stdio/websocket). Returns null today.
 */
export type DebugAdapterFactory = () => Promise<DebugAdapter> | DebugAdapter;

const factories = new Map<string, DebugAdapterFactory>();

export function registerDebugAdapterFactory(id: string, factory: DebugAdapterFactory): void {
  factories.set(id, factory);
}

export async function createDebugAdapter(id: string): Promise<DebugAdapter | null> {
  const factory = factories.get(id);
  if (!factory) return null;
  try {
    return await factory();
  } catch {
    return null;
  }
}
