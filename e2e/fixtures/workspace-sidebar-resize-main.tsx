import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkspaceSplitLayout } from '../../src/shared/WorkspaceSplitLayout'

/**
 * Pointer-gesture harness for the sidebar width separator.
 *
 * The production owner applies a committed width optimistically and reconciles a
 * canonical snapshot afterwards, a live terminal keeps re-rendering the same
 * tree, and terminal content lives in a separately focusable surface. This
 * fixture reproduces those three facts without a server, so a real pointer
 * release can be traced from the handle to the canonical width owner.
 */
function Fixture() {
	const [canonicalWidth, setCanonicalWidth] = useState(352)
	const [terminalOutput, setTerminalOutput] = useState(0)
	const [commitCount, setCommitCount] = useState(0)
	const [isMounted, setIsMounted] = useState(true)
	const terminalRef = useRef<HTMLIFrameElement | null>(null)

	const commit = useCallback((width: number) => {
		setCommitCount((current) => current + 1)
		setCanonicalWidth(width)
	}, [])

	useEffect(() => {
		const api = {
			getCanonicalWidth: () => canonicalWidth,
			getCommitCount: () => commitCount,
			// A terminal writing output re-renders the workspace subtree.
			emitTerminalOutput: () => setTerminalOutput((current) => current + 1),
			// A terminal that takes keyboard ownership moves focus into its own
			// browsing context while the pointer is still held.
			focusTerminalSurface: () => {
				terminalRef.current?.contentWindow?.focus()
			},
			unmountLayout: () => setIsMounted(false),
		}
		;(window as unknown as { terminaySidebarFixture: typeof api }).terminaySidebarFixture = api
	}, [canonicalWidth, commitCount])

	if (!isMounted) return <div data-fixture-unmounted>unmounted</div>

	return (
		<WorkspaceSplitLayout
			className="fixture-workspace"
			navigationWidth={canonicalWidth}
			onNavigationWidthCommit={commit}
			navigation={
				<div data-fixture-navigation style={{ height: '100%', background: '#123' }}>
					navigation
				</div>
			}
			content={
				<div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
					{/* The upper region is ordinary workspace content, so a pointer
					    dragged across it keeps reporting to this document. */}
					<div style={{ flex: '1 1 auto' }}>
						<output data-fixture-terminal-output>{terminalOutput}</output>
					</div>
					<iframe
						ref={terminalRef}
						data-fixture-terminal
						title="terminal"
						srcDoc="<!doctype html><body style='margin:0;background:#000'><div tabindex='0' id='surface'>terminal</div><script>document.getElementById('surface').focus()</script></body>"
						style={{ width: '100%', height: '25%', border: 0 }}
					/>
				</div>
			}
		/>
	)
}

createRoot(document.getElementById('workspace-sidebar-resize-root') as HTMLElement).render(<Fixture />)
