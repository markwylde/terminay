/** A deterministic optimistic mutation token. It is intentionally a pure
 * value helper: callers decide which safe presentation-only fields may be
 * speculatively changed and must use the server result for authoritative data. */
export interface OptimisticMutation<T> {
  readonly optimistic: T;
  readonly commit: (authoritative: T) => T;
  readonly rollback: () => T;
}

export function optimisticMutation<T>(current: T, update: (value: T) => T): OptimisticMutation<T> {
  const previous = current;
  const optimistic = update(current);
  return Object.freeze({ optimistic, commit: (authoritative: T) => authoritative, rollback: () => previous });
}
