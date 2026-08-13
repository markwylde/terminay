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
  readonly operation: "log" | "secret.resolve" | "profile.get" | "agent.list" | "agent.sign" | "provider.call";
  readonly payload: unknown;
}

export interface ExtensionProfileSnapshot {
  readonly profileId: string;
  readonly providerId: string;
  readonly revision: number;
  readonly values: JsonValue;
  readonly secretFields: readonly string[];
}

export interface ExtensionProfileBroker {
  get(extensionId: string, providerId: string, profileId: string, signal: AbortSignal): Promise<ExtensionProfileSnapshot>;
}

export interface ExtensionSshAgentBroker {
  listIdentities(principal: { extensionId: string; profileId: string; purpose: "ssh-user-authentication" }, signal: AbortSignal): Promise<unknown>;
  sign(principal: { extensionId: string; profileId: string; purpose: "ssh-user-authentication" }, request: { identityId: string; challenge: Uint8Array; algorithm: string }, signal: AbortSignal): Promise<unknown>;
}

export interface ExtensionSecretAccessBroker {
  withSecret<T>(principal: { extensionId: string; permissions: ReadonlySet<string> }, request: { profileId: string; fieldId: string }, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
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
