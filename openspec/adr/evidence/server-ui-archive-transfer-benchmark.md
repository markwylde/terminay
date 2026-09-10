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
| Archive/body size | 4,623,806 bytes | 24,583,324 base64 body bytes |
| Total bidirectional wire bytes | 4,629,888 | 24,765,484 |
| Requests | 1 | 111 |
| Median Node extraction/install time | 23.983 ms | 12.946 ms |

The archive has deliberately more local install work because it must gzip-decode
and unpack the tar. Its transport saving is 20,135,596 bytes (81.3%) and it
removes 110 request/response turnarounds. These measurements do not claim the
same CPU timings for every browser or device.

## Recorded result after removing client language services

On 2026-09-10, after the workspace UI stopped bundling Monaco's TypeScript,
CSS, HTML, and JSON language workers and modes, the same command produced:

| Metric | Archive | Legacy per-file/base64 |
| --- | ---: | ---: |
| Archive/body size | 3,520,103 bytes | 15,990,692 base64 body bytes |
| Total bidirectional wire bytes | 3,524,782 | 16,144,866 |
| Requests | 1 | 146 |
| Median Node extraction/install time | 17.881 ms | 7.592 ms |

The unpacked server UI is 11,992,849 bytes across 145 files. Immediately
before the change the same tree measured 5,643,632 bytes compressed and
21,413,713 bytes unpacked across 235 files, so the archive every browser
session downloads shrank by 2,123,529 bytes (37.6%) and the unpacked bundle by
9,420,864 bytes (44.0%). The only workers left are Monaco's base editor worker
and the PDF.js worker.
