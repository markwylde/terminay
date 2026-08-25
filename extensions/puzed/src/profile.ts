import type { Me } from "./api-types.js";

export const REQUIRED_SCOPES = Object.freeze([
  "machines:write", "images:read", "workers:read", "networks:read",
  "jobs:read", "events:read",
] as const);

export interface PuzedProfileInput {
  displayName: string;
  baseUrl: string;
  defaultSshUsername?: string;
  defaultRoot?: string;
}

export interface PuzedProfile extends PuzedProfileInput {
  profileId: string;
  apiKeySecretRef: string;
  origin: string;
  organization: { id: string; slug: string; status: Me["org"]["status"] };
  effectiveScopes: Record<string, string>;
  canCreate: boolean;
}

export interface ProfileValidation {
  me: Me;
  missingScopes: string[];
  canCreate: boolean;
  mode: "full" | "management-only" | "invalid";
  degradedReason?: string;
}

export function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error("Puzed Platform URLs must use HTTPS (HTTP is allowed only for loopback development).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Puzed Platform URLs cannot contain credentials, a query, or a fragment.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function missingRequiredScopes(scopes: Record<string, string>): string[] {
  return REQUIRED_SCOPES.filter((required) => {
    const [resource, access] = required.split(":") as [string, "read" | "write"];
    const granted = scopes[resource];
    return !granted || (access === "write" ? granted !== "write" : !["read", "write"].includes(granted));
  });
}

export function validateMe(me: Me): ProfileValidation {
  const missingScopes = missingRequiredScopes(me.effective_scopes);
  if (me.org.status !== "ready") missingScopes.push("organization:ready");
  const settings = ["read", "write"].includes(me.effective_scopes.settings ?? "");
  const canCreate = missingScopes.length === 0 && settings;
  return {
    me, missingScopes, canCreate,
    mode: missingScopes.length > 0 ? "invalid" : canCreate ? "full" : "management-only",
    ...(!settings && missingScopes.length === 0 ? { degradedReason: "settings:read is required to create VMs; existing Terminay VMs remain manageable." } : {}),
  };
}
