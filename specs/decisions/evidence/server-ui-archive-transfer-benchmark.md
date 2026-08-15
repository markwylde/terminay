# Server UI archive transfer benchmark

Run the non-Docker evidence command after a normal server-UI build:

```sh
npm run benchmark:server-ui-archive
```

It builds the current server UI, produces the real reusable gzip tar through
`electron/remote/serverUiArchive.ts`, and prints a JSON report. The report
records archive/compressed size, client/server wire bytes, request count, and
median install duration across seven samples.

For a like-for-like historical comparison it serializes the exact same files
using the retired wire format: one `asset:get-manifest` request, one
`asset:get` request for each file, JSON UTF-8 framing, base64 bodies, and the
former 64 KiB base64 body chunking/acknowledgements. Archive binary frames
include their eight-byte transfer header and archive acknowledgements in the
wire count.

The accompanying Node test uses a nested multi-file fixture and proves the
stable protocol outcomes: one archive request, zero archive base64 bytes, and
more than one request plus non-zero base64 bytes in the legacy model. Timing
is evidence for the current machine, not a cross-machine performance gate.

## Recorded result

On 2026-08-15, the generated 110-file server UI produced:

| Metric | Archive | Legacy per-file/base64 |
| --- | ---: | ---: |
| Archive/body size | 4,624,816 bytes | 24,587,168 base64 body bytes |
| Total bidirectional wire bytes | 4,630,898 | 24,769,328 |
| Requests | 1 | 111 |
| Median Node extraction/install time | 25.203 ms | 12.677 ms |

The archive has deliberately more local install work because it must gzip-decode
and unpack the tar. Its transport saving is 20,138,430 bytes (81.3%) and it
removes 110 request/response turnarounds. These measurements do not claim the
same CPU timings for every browser or device.
