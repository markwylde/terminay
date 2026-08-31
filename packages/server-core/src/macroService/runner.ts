import { MacroServiceError } from "./errors.js";
import { normalizeLimits, renderMacroTemplate } from "./normalize.js";
import type {
  MacroDefinition,
  MacroDisconnectPolicy,
  MacroExecutionEnvironment,
  MacroFieldValue,
  MacroLimits,
  MacroRunAuthorization,
  MacroRunHandle,
  MacroRunOptions,
  MacroRunSnapshot,
  MacroStep,
  MacroTarget,
} from "./types.js";

interface MutableRun {
  readonly runId: string;
  readonly macro: MacroDefinition;
  readonly target: MacroTarget;
  readonly startedAt: number;
  readonly controller: AbortController;
  readonly launcherId: string | undefined;
  readonly disconnectPolicy: MacroDisconnectPolicy;
  status: MacroRunSnapshot["status"];
  stepIndex: number;
  bytesWritten: number;
  finishedAt?: number;
  errorCode?: string;
}

/**
 * Bounded, server-side macro execution.  It only accepts an exact terminal
 * identity and sends bytes through the supplied server PTY boundary; the
 * launching client never receives resolved secret data.
 */
export class MacroRunner {
  readonly limits: Required<MacroLimits>;
  private readonly activeRuns = new Map<string, MutableRun>();
  private runCounter = 0;

  constructor(limits: MacroLimits = {}) {
    this.limits = Object.freeze(normalizeLimits(limits));
  }

  get running(): number { return this.activeRuns.size; }

  snapshot(runId: string): MacroRunSnapshot | undefined {
    const run = this.activeRuns.get(runId);
    return run === undefined ? undefined : snapshotOf(run);
  }

  list(): readonly MacroRunSnapshot[] { return [...this.activeRuns.values()].map(snapshotOf); }

  cancel(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run === undefined) return false;
    run.controller.abort();
    return true;
  }

  /** Apply each run's documented policy when its launching connection
   * disconnects. Another live connection's runs are unaffected. */
  launcherDisconnected(launcherId: string): void {
    for (const run of this.activeRuns.values()) {
      if (run.launcherId === launcherId && run.disconnectPolicy === "cancel") run.controller.abort();
    }
  }

  start(macro: MacroDefinition, environment: MacroExecutionEnvironment, options: MacroRunOptions): MacroRunHandle {
    if (this.activeRuns.size >= this.limits.maxConcurrentRuns) throw new MacroServiceError("limit", "macro run concurrency limit reached");
    assertAuthorization(environment, options.authorization);
    const runId = `${macro.id}:${++this.runCounter}`;
    const run: MutableRun = {
      runId,
      macro,
      target: freezeTarget(environment.target),
      startedAt: environment.now?.() ?? Date.now(),
      controller: new AbortController(),
      launcherId: options.launcherId,
      disconnectPolicy: options.disconnectPolicy ?? "cancel",
      status: "running",
      stepIndex: 0,
      bytesWritten: 0,
    };
    this.activeRuns.set(runId, run);
    const promise = this.execute(run, environment, options).finally(() => {
      this.activeRuns.delete(runId);
    });
    return Object.freeze({
      runId,
      snapshot: () => snapshotOf(run),
      cancel: () => run.controller.abort(),
      promise,
    });
  }

  async run(macro: MacroDefinition, environment: MacroExecutionEnvironment, options: MacroRunOptions): Promise<MacroRunSnapshot> {
    return this.start(macro, environment, options).promise;
  }

  private async execute(run: MutableRun, environment: MacroExecutionEnvironment, options: MacroRunOptions): Promise<MacroRunSnapshot> {
    try {
      const values = resolveValues(run.macro, options.values ?? {}, this.limits.maxStringBytes);
      for (let index = 0; index < run.macro.steps.length; index += 1) {
        run.stepIndex = index;
        assertNotCanceled(run.controller.signal);
        await this.executeStep(run, run.macro.steps[index] as MacroStep, values, environment);
      }
      assertNotCanceled(run.controller.signal);
      run.status = "completed";
    } catch (error) {
      if (run.controller.signal.aborted || error instanceof MacroServiceError && error.code === "canceled") {
        run.status = "canceled";
        run.errorCode = "canceled";
      } else {
        run.status = "failed";
        run.errorCode = error instanceof MacroServiceError ? error.code : "execution_failed";
      }
    } finally {
      run.finishedAt = environment.now?.() ?? Date.now();
    }
    return snapshotOf(run);
  }

  private async executeStep(
    run: MutableRun,
    step: MacroStep,
    values: Readonly<Record<string, MacroFieldValue>>,
    environment: MacroExecutionEnvironment,
  ): Promise<void> {
    switch (step.type) {
      case "type": {
        const rendered = renderMacroTemplate(step.content, values, this.limits.maxStringBytes);
        await this.write(run, environment, new TextEncoder().encode(rendered));
        return;
      }
      case "key":
        if (environment.key === undefined) throw new MacroServiceError("execution_failed", "key output is unavailable at the PTY boundary");
        await environment.key(run.target, step.key);
        return;
      case "secret": {
        if (environment.resolveSecret === undefined || !step.secretId) throw new MacroServiceError("secret_unavailable", "macro secret is unavailable");
        let secret: Uint8Array | undefined;
        try {
          secret = await environment.resolveSecret(run.target, step.secretId);
          if (!(secret instanceof Uint8Array) || secret.byteLength > this.limits.maxStringBytes) throw new MacroServiceError("limit", "resolved secret exceeds the macro output limit");
          await this.write(run, environment, secret);
        } finally {
          secret?.fill(0);
        }
        return;
      }
      case "wait_time":
        await waitMilliseconds(parseDelay(step.durationSeconds, values, this.limits.maxDelayMs), run.controller.signal);
        return;
      case "wait_inactivity": {
        const milliseconds = parseDelay(step.durationSeconds, values, this.limits.maxDelayMs);
        if (environment.waitForInactivity === undefined) {
          await waitMilliseconds(milliseconds, run.controller.signal);
        } else {
          await environment.waitForInactivity(run.target, milliseconds, run.controller.signal);
          assertNotCanceled(run.controller.signal);
        }
        return;
      }
      case "select_line":
        await this.write(run, environment, new TextEncoder().encode("\u001b[2K\r"));
        return;
      case "paste":
        throw new MacroServiceError("unsupported_step", "clipboard paste requires an explicit server-side clipboard authority");
    }
  }

  private async write(run: MutableRun, environment: MacroExecutionEnvironment, bytes: Uint8Array): Promise<void> {
    assertNotCanceled(run.controller.signal);
    if (run.bytesWritten + bytes.byteLength > this.limits.maxOutputBytes) throw new MacroServiceError("limit", "macro output exceeds the limit");
    await environment.write(run.target, bytes);
    run.bytesWritten += bytes.byteLength;
    assertNotCanceled(run.controller.signal);
  }
}

export const MacroExecutionService = MacroRunner;

function resolveValues(macro: MacroDefinition, supplied: Readonly<Record<string, MacroFieldValue>>, maxStringBytes: number): Readonly<Record<string, MacroFieldValue>> {
  const values: Record<string, MacroFieldValue> = {};
  for (const field of macro.fields) {
    const value = supplied[field.name] ?? field.defaultValue;
    if (field.required && (value === "" || value === undefined)) throw new MacroServiceError("invalid_macro", `required macro field is missing: ${field.name}`);
    if (typeof value === "string" && new TextEncoder().encode(value).byteLength > maxStringBytes) throw new MacroServiceError("limit", "macro field exceeds the string limit");
    if (field.type === "number" && typeof value !== "number") throw new MacroServiceError("invalid_macro", `macro field has an invalid value: ${field.name}`);
    if (field.type === "checkbox" && typeof value !== "boolean") throw new MacroServiceError("invalid_macro", `macro field has an invalid value: ${field.name}`);
    values[field.name] = value;
  }
  return values;
}

function parseDelay(template: string, values: Readonly<Record<string, MacroFieldValue>>, maxDelayMs: number): number {
  const rendered = renderMacroTemplate(template, values, 256).trim();
  const seconds = Number(rendered);
  if (!Number.isFinite(seconds) || seconds < 0) throw new MacroServiceError("invalid_macro", "macro wait duration must be non-negative");
  const milliseconds = Math.round(seconds * 1000);
  if (milliseconds > maxDelayMs) throw new MacroServiceError("limit", "macro wait duration exceeds the limit");
  return milliseconds;
}

function assertAuthorization(environment: MacroExecutionEnvironment, authorization: MacroRunAuthorization): void {
  if (!sameTarget(environment.target, authorization.target) || (authorization.scope !== undefined && authorization.scope !== "write" && authorization.scope !== "admin")) {
    throw new MacroServiceError("unauthorized_target", "macro target authorization does not match the exact terminal");
  }
  if (environment.authorize !== undefined && !environment.authorize(authorization.target)) throw new MacroServiceError("unauthorized_target", "macro target authorization was rejected");
}

function sameTarget(left: MacroTarget, right: MacroTarget): boolean {
  return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId;
}

function freezeTarget(target: MacroTarget): MacroTarget { return Object.freeze({ serverId: target.serverId, projectId: target.projectId, sessionId: target.sessionId }); }

function snapshotOf(run: MutableRun): MacroRunSnapshot {
  const result: MacroRunSnapshot = {
    runId: run.runId,
    macroId: run.macro.id,
    target: run.target,
    status: run.status,
    stepIndex: run.stepIndex,
    bytesWritten: run.bytesWritten,
    startedAt: run.startedAt,
    ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    ...(run.errorCode === undefined ? {} : { errorCode: run.errorCode }),
  };
  return Object.freeze(result);
}

function assertNotCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw new MacroServiceError("canceled", "macro run was canceled");
}

function waitMilliseconds(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new MacroServiceError("canceled", "macro run was canceled"));
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
