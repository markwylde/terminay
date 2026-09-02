# Parakeet on-device dictation supply chain

Terminay accepts no renderer-selected executable, Python module, model name,
revision, cache, or output path for on-device dictation. The selected Terminay
Server owns installation and execution.

| Component | Exact pin | License | Upstream |
| --- | --- | --- | --- |
| Engine | `parakeet-mlx==0.5.2` | Apache-2.0 | `https://github.com/senstella/parakeet-mlx` |
| Model | `mlx-community/parakeet-tdt-0.6b-v3@ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15` | CC-BY-4.0 | `https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3` |

The model revision is passed to Hugging Face's snapshot downloader rather than
following a mutable branch. `ffmpeg` is discovered only at the approved
absolute Homebrew locations and converts each bounded capture to signed 16-bit
mono PCM WAV at 16 kHz. Input and converted files live in request-scoped
private temporary directories and are removed on success and failure.

Diagnostics and client-visible status may contain the exact identifiers above,
their licenses, the normalized audio format, lifecycle state, bounded progress,
and a sanitized actionable error. They must never contain audio, transcripts,
environment secrets, arbitrary local paths, or cache paths.
