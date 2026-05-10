Generate the markdown changelog body for the provided Terminay release version.

Rules:
- Read recent git history and inspect the relevant project files before writing.
- Focus on changes that matter to Terminay users and contributors: the terminal workspace, Electron app behavior, packaging, release automation, and developer workflow.
- Do not include front matter, metadata, or a leading `---`.
- Do not attempt to publish a release.
- You may use read-only commands to inspect files and git history if available.
- Write the markdown changelog body to `RELEASE.md`.
- Do not output any extra text.
- Start with a short, polished intro sentence.
- Use 3-4 top-level sections with `##` headings.
- Every top-level section must include at least one `###` subheading.
- Prefer short grouped bullet lists under subheadings instead of long flat sections.
- Bullets should be concrete, specific, and written in past tense.
- Keep the tone crisp and product-facing, not like raw commit logs.
- Synthesize the most important changes instead of listing every commit.
