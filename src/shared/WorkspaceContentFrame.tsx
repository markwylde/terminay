import type { ReactNode } from 'react'

export interface WorkspaceContentFrameProps {
	readonly className?: string
	readonly children: ReactNode
}

/** Host-neutral boundary for a workspace's navigation and panel body. */
export function WorkspaceContentFrame({ className, children }: WorkspaceContentFrameProps) {
	return <div className={className} data-shared-ui="workspace-content-frame">{children}</div>
}
