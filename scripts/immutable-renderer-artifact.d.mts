export interface ImmutableRendererArtifact {
  readonly rootDirectory: string
  readonly fingerprint: string
  assertUnchanged(): Promise<void>
}

export function stageImmutableRendererArtifact(options: {
  readonly sourceRoot: string
  readonly destinationParent: string
}): Promise<ImmutableRendererArtifact>

export function validateRendererArtifact(rootDirectory: string): Promise<{
  readonly bundleId: string
  readonly fingerprint: string
  readonly files: readonly string[]
}>
