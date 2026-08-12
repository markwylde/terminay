import type { JsonValue, ProviderDefinition, ProviderRuntimeMethod } from "@terminay/extension-api";

export type ExtensionHostState =
  | "stopped"
  | "starting"
  | "running"
  | "failed"
  | "quarantined";

export interface ExtensionLaunchDescriptor {
  readonly extensionId: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly configDirectory: string;
  readonly dataDirectory: string;
  readonly cacheDirectory: string;
  readonly permissions: readonly string[];
}

export interface ExtensionHostStatus {
  readonly extensionId: string;
  readonly state: ExtensionHostState;
  readonly consecutiveCrashes: number;
  readonly restartAt?: number;
  readonly failure?: string;
  readonly providers?: readonly ProviderDefinition[];
}

export interface ExtensionInvocation {
  readonly method: string;
  readonly input?: unknown;
  readonly deadlineMs?: number;
  readonly signal?: AbortSignal;
}

export type ExtensionProviderCallback = ProviderRuntimeMethod;

export interface ExtensionProviderInvocation {
  readonly providerId: string;
  readonly callback: ExtensionProviderCallback;
  readonly request: JsonValue;
  readonly deadlineMs?: number;
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly signal?: AbortSignal;
}

export interface ExtensionBrokerRequest {
  readonly extensionId: string;
  readonly operation: "log" | "secret.resolve" | "provider.call";
  readonly payload: unknown;
}

export interface ExtensionBroker {
  request(request: ExtensionBrokerRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ExtensionHostLimits {
  readonly maxMessageBytes?: number;
  readonly maxConcurrentInvocations?: number;
  readonly startupTimeoutMs?: number;
  readonly invocationTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly crashWindowMs?: number;
  readonly maxCrashesInWindow?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}
