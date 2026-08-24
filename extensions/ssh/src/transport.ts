import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { normalizeError, SshProviderError } from "./errors.js";

type NodeCallback<T> = (error: Error | null | undefined, value: T) => void;

export interface SshProfile {
  id: string;
  hostname: string;
  port: number;
  username: string;
  auth:
    | { mode: "agent" }
    | { mode: "password"; passwordSecretRef: string }
    | { mode: "private-key"; privateKeySecretRef: string; passphraseSecretRef?: string };
  timeouts: { connectMs: number; handshakeMs: number; keepaliveMs: number };
}

export interface HostTrustVerifier {
  verify(profile: SshProfile, key: Buffer, algorithm: string): void;
}

interface SecretRequest { profileId: string; fieldId: string; purpose: string }
interface SecretBroker {
  withValue<T>(request: SecretRequest, use: (bytes: Uint8Array) => Promise<T>): Promise<T>;
}
interface AgentIdentity { identityId: string; publicKey: Uint8Array; algorithm: string }
interface AgentSignResult { signature: Uint8Array }
interface SshAgentBroker {
  listIdentities(request: { profileId: string; purpose: string }): Promise<AgentIdentity[]>;
  sign(request: { profileId: string; purpose: string; identityId: string; algorithm: string; challenge: Uint8Array }): Promise<AgentSignResult>;
}
export interface AuthenticationBroker { secrets: SecretBroker; sshAgent?: SshAgentBroker }

interface ParsedPublicKey {
  getPublicSSH(): Buffer;
}
interface AgentSignOptions { hash?: "sha256" | "sha512" | string }
type AgentIdentityCallback = (error: Error | null, keys?: ParsedPublicKey[]) => void;
type AgentSignCallback = (error: Error | null, signature?: Buffer) => void;

interface SshConnectConfig {
  host: string;
  port: number;
  username: string;
  readyTimeout: number;
  keepaliveInterval: number;
  keepaliveCountMax: number;
  hostVerifier(key: Buffer): boolean;
  agent?: BrokeredAgent;
  password?: string;
  privateKey?: Buffer;
  passphrase?: string;
}

export interface SshChannel {
  stderr?: { on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown };
  on(event: "data", listener: (chunk: Uint8Array | string) => void): this;
  once(event: "close", listener: (code?: number, signal?: string) => void): this;
  write(data: string): boolean;
  setWindow(rows: number, cols: number, height: number, width: number): void;
  signal(signal: string): void;
  end(): void;
  pause?(): void;
  resume?(): void;
}

export interface SftpClient {}

export interface SshClient {
  once(event: "ready", listener: () => void): this;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: () => void): this;
  connect(config: SshConnectConfig): void;
  end(): void;
  sftp(callback: NodeCallback<SftpClient>): void;
  shell(options: ShellOptions, callback: NodeCallback<SshChannel>): void;
  exec(command: string, callback: NodeCallback<SshChannel>): void;
}

interface Ssh2Module {
  Client: new () => SshClient;
  utils: { parseKey(key: Buffer): ParsedPublicKey | Error };
}
interface Ssh2AgentModule { BaseAgent: new () => object }

const require = createRequire(import.meta.url);
const { Client, utils } = require("@electerm/ssh2") as Ssh2Module;
const { BaseAgent } = require("@electerm/ssh2/lib/agent.js") as Ssh2AgentModule;

export async function connectSsh(
  profile: SshProfile,
  trust: HostTrustVerifier,
  broker: AuthenticationBroker,
  signal?: AbortSignal,
): Promise<SshClient> {
  const client = new Client();
  let trustFailure: unknown;
  const config: SshConnectConfig = {
    host: stripBrackets(profile.hostname), port: profile.port, username: profile.username,
    readyTimeout: Math.min(profile.timeouts.connectMs + profile.timeouts.handshakeMs, 240_000),
    keepaliveInterval: profile.timeouts.keepaliveMs, keepaliveCountMax: 3,
    hostVerifier(key: Buffer) { try { trust.verify(profile, key, keyAlgorithm(key)); return true; } catch (error) { trustFailure = error; return false; } },
  };
  if (profile.auth.mode === "agent") {
    if (!broker.sshAgent) throw new SshProviderError("authentication-failed", "Selected Terminay Server has no brokered SSH agent");
    config.agent = new BrokeredAgent(profile.id, broker.sshAgent);
  } else if (profile.auth.mode === "password") {
    return broker.secrets.withValue({ profileId: profile.id, fieldId: profile.auth.passwordSecretRef, purpose: "password" }, async (bytes) => {
      config.password = Buffer.from(bytes).toString("utf8");
      try { return await connectClient(client, config, signal, () => trustFailure); }
      finally { config.password = ""; }
    });
  } else {
    const auth = profile.auth;
    return broker.secrets.withValue({ profileId: profile.id, fieldId: auth.privateKeySecretRef, purpose: "private-key" }, async (keyBytes) => {
      config.privateKey = Buffer.from(keyBytes);
      const connect = async (): Promise<SshClient> => connectClient(client, config, signal, () => trustFailure);
      try {
        return auth.passphraseSecretRef
          ? await broker.secrets.withValue({ profileId: profile.id, fieldId: auth.passphraseSecretRef, purpose: "private-key-passphrase" }, async (bytes) => {
              config.passphrase = Buffer.from(bytes).toString("utf8");
              try { return await connect(); } finally { config.passphrase = ""; }
            })
          : await connect();
      } finally { config.privateKey.fill(0); }
    });
  }
  return connectClient(client, config, signal, () => trustFailure);
}

function connectClient(client: SshClient, config: SshConnectConfig, signal: AbortSignal | undefined, getTrustFailure: () => unknown): Promise<SshClient> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = <T>(fn: (value: T) => void, value: T): void => { if (settled) return; settled = true; signal?.removeEventListener("abort", abort); fn(value); };
    const abort = (): void => { client.end(); done(reject, new SshProviderError("cancelled", "SSH connection was cancelled")); };
    signal?.addEventListener("abort", abort, { once: true });
    client.once("ready", () => done(resolve, client));
    client.once("error", (error) => done(reject, getTrustFailure() ?? normalizeError(error)));
    client.connect(config);
  });
}

class BrokeredAgent extends BaseAgent {
  readonly profileId: string;
  readonly broker: SshAgentBroker;
  readonly keys = new Map<string, AgentIdentity>();
  constructor(profileId: string, broker: SshAgentBroker) { super(); this.profileId = profileId; this.broker = broker; }
  getIdentities(callback: AgentIdentityCallback): void {
    this.broker.listIdentities({ profileId: this.profileId, purpose: "ssh-user-authentication" }).then((identities) => {
      const keys = identities.map((identity) => {
        const parsed = utils.parseKey(Buffer.from(identity.publicKey));
        if (parsed instanceof Error) throw new Error("SSH agent returned an invalid public key");
        this.keys.set(parsed.getPublicSSH().toString("base64"), identity);
        return parsed;
      });
      callback(null, keys);
    }, () => callback(new Error("SSH agent identities are unavailable")));
  }
  sign(publicKey: ParsedPublicKey, data: Uint8Array, callback: AgentSignCallback): void;
  sign(publicKey: ParsedPublicKey, data: Uint8Array, options: AgentSignOptions, callback: AgentSignCallback): void;
  sign(publicKey: ParsedPublicKey, data: Uint8Array, optionsOrCallback: AgentSignOptions | AgentSignCallback, maybeCallback?: AgentSignCallback): void {
    const options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback;
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    if (!callback) throw new Error("SSH agent sign callback is required");
    const identity = this.keys.get(publicKey.getPublicSSH().toString("base64"));
    if (!identity) { callback(new Error("SSH agent identity is unavailable")); return; }
    const algorithm = options.hash === "sha512" ? "rsa-sha2-512" : options.hash === "sha256" ? "rsa-sha2-256" : identity.algorithm;
    this.broker.sign({ profileId: this.profileId, purpose: "ssh-user-authentication", identityId: identity.identityId, algorithm, challenge: new Uint8Array(data) })
      .then((result) => callback(null, Buffer.from(result.signature)), () => callback(new Error("SSH agent signing failed")));
  }
}

function stripBrackets(host: string): string { return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host; }
function keyAlgorithm(key: Uint8Array): string { try { const bytes = Buffer.from(key); const size = bytes.readUInt32BE(0); return bytes.subarray(4, 4 + size).toString("ascii").slice(0, 64) || "unknown"; } catch { return "unknown"; } }

export interface ShellOptions { term: string; rows: number; cols: number; env: Record<string, string> }
export function openSftp(client: SshClient): Promise<SftpClient> { return callbackPromise((callback) => client.sftp(callback)); }
export function openShell(client: SshClient, options: ShellOptions): Promise<SshChannel> { return callbackPromise((callback) => client.shell(options, callback)); }
export function execRemote(client: SshClient, command: string): Promise<SshChannel> { return callbackPromise((callback) => client.exec(command, callback)); }
export function callbackPromise<T>(start: (callback: NodeCallback<T>) => void): Promise<T> { return new Promise((resolve, reject) => start((error, value) => error ? reject(normalizeError(error)) : resolve(value))); }
