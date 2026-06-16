Generate the markdown changelog body for the provided Terminay release version.

Rules:
- Treat the provided previous-tag-to-target-tag git range as the only source of release changes.
- Do not summarize commits, pull requests, release bodies, or project files from outside the provided range as current-release changes.
- If you inspect git history, use only the provided range, for example `git log PREVIOUS_TAG..TARGET_TAG`.
- If you inspect diffs, use only the provided range, for example `git diff PREVIOUS_TAG..TARGET_TAG`.
- Project files show the final state, not proof that a feature was introduced in this release. Only claim a feature was introduced when the provided commits or diff show that introduction happened in this range.
- Do not include features, fixes, dependency updates, or workflows that were already present in earlier releases.
- Avoid words like "introduced", "added", or "new" for existing features that were only fixed, tuned, documented, or touched in this release.
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
