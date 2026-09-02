# Touch-mobile Chromium dictation evidence

`e2e/mobile-dictation.spec.ts` runs the shared mobile dictation workflow in
Chromium with touch and mobile emulation at 390 × 844.

The rendered workflow uses the named `DictationCaptureClient` state boundary
with an immutable server/project/panel/session target and confirmed,
credential-free provider disclosure. An injected `MobileDictationUploadClient`
keeps upload authority outside the component. The test drives:

- idle to recording state;
- a provider failure surfaced as an accessible alert with recoverable state;
- explicit cancellation;
- successful bounded binary submission with the original target identity;
- 44-pixel touch actions and no horizontal overflow.

The fixture supplies four deterministic bytes directly to the capture client.
It does not request a microphone, contact a transcription provider, exercise a
browser permission prompt, or claim physical-device behavior. Those remain
operational follow-ups.
