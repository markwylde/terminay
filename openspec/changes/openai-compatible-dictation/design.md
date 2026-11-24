## Context

Shared settings currently offer OpenAI and Parakeet. Server-core has a fixed OpenAI adapter and vault-backed credential callbacks. Both server compositions route by model and disable non-Parakeet settings; custom model IDs require explicit provider routing. The renderer is untrusted and may not perform inference or change TLS policy.

## Goals / Non-Goals

Support custom full transcription URLs, arbitrary model IDs, optional independent keys and self-signed TLS on both server hosts. Preserve capture and target authorization. No discovery, realtime API, model-manager changes, or global TLS changes.

## Decisions

- Use a full endpoint URL (HTTP or HTTPS), validated on the server, rather than an inferred base path. This accepts the supplied sherpa endpoint without path-joining ambiguity. Reject userinfo, query strings, fragments and other schemes. Private and loopback hosts are intentional self-hosted destinations.
- Bind capture to an expected provider/endpoint/model/TLS configuration. At submission, compare that expectation with current server settings and reject stale configuration before inference; use only server settings for execution. Snapshot the matched configuration inside DictationService. Route explicitly by provider, retaining existing adapter compatibility for callers without a provider field.
- Use a custom server-core adapter with Node HTTP(S) requests and a request-local `rejectUnauthorized` value, no shared agent or environment changes. Serialize standard multipart using web FormData. Refuse redirects, bound response bytes during receipt, propagate AbortSignal through request and response. Keep errors sanitized.
- Store custom and OpenAI keys under distinct vault IDs, and resolve only the selected provider key. A missing custom key means unauthenticated operation; vault failures for a configured key remain errors. Dedicated credential commands take an explicit validated provider selector (omission retains OpenAI for existing clients). Switching settings cannot redirect a key operation.
- Add server-scoped custom endpoint, model and TLS settings. Show a password key control with configured status, never plaintext readback. Update client-core disclosure normalization to preserve a custom endpoint and allow optional-key capture. Use existing settings controls and checkbox rendering. Explain the self-signed TLS effect inline. Display endpoint and server before capture.

## Risks / Trade-offs

- [TLS bypass permits impersonation] → Explicit unchecked default, endpoint-local transport, no redirects or shared TLS state; test a verified request after bypass.
- [Optional authentication hides vault faults] → Only absent entries permit no credential; configured-entry failures fail closed.
- [Provider selection changes during upload] → Snapshot configuration once per transcription; route by captured provider rather than model name.
- [Private endpoint unavailable from server] → Settings copy states the selected server makes the request; safe actionable errors.

Alternatives rejected: process-wide TLS changes weaken unrelated connections; a shared OpenAI credential risks disclosure to a custom host; routing by model conflicts with arbitrary IDs; mutable settings during capture can change a disclosed destination. A separate Node transport keeps TLS policy request-local without an additional dependency.

## Migration Plan

Additive settings default to an empty endpoint/model and bypass false. Existing OpenAI and Parakeet defaults remain. Roll back by selecting an existing provider; custom credentials remain confined to the server vault.

## Open Questions

None. Use a full endpoint URL, as in the supplied curl, and a free-form custom model field.
