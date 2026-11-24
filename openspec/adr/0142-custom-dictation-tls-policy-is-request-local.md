# ADR-0142: Custom dictation TLS policy is request-local

Status: accepted
Date: 2026-11-24

## Context

Self-hosted OpenAI-compatible transcription endpoints may use self-signed certificates. Their selected-server API keys and audio must remain isolated from unrelated network services. ADR-0011 governs provider and vault boundaries; ADR-0115 places configuration on its owning server.

## Decision

The owning Terminay Server submits custom dictation requests to an explicitly configured full HTTP(S) endpoint. Certificate verification is on by default. An explicit custom-provider bypass uses request-local HTTPS options, never process environment, shared agents, or renderer networking. Redirects are refused. The optional custom API key has its own server vault entry and is never borrowed from OpenAI.

## Consequences

Self-signed inference works when explicitly enabled. A bypassed request does not weaken any other connection. Endpoint reachability is determined from the owning server. The user accepts the impersonation risk for that endpoint when checking bypass.
