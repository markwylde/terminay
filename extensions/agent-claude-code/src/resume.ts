const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu;

/** Extracts Claude's explicit native session identity without interpreting text. */
export function claudeResumeSessionId(arguments_: readonly string[] | undefined): string | undefined {
  if (!arguments_) return undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (typeof argument !== "string") continue;
    const inline = /^(?:--resume|-r)=([0-9a-f-]{36})$/iu.exec(argument)?.[1];
    const separate = argument === "--resume" || argument === "-r" ? arguments_[index + 1] : undefined;
    const id = inline ?? separate;
    if (id && SESSION_ID.test(id)) return id;
  }
  return undefined;
}

/** Claude's provider-owned project directory encoding for a canonical cwd. */
export function claudeProjectJournalPath(cwd: string, sessionId: string): string | undefined {
  if (!cwd.startsWith("/") || !SESSION_ID.test(sessionId)) return undefined;
  const directory = cwd.replace(/[/.]/gu, "-");
  return directory ? `.claude/projects/${directory}/${sessionId}.jsonl` : undefined;
}
