/**
 * Real-CLI conformance harness for Terminay agent provider extensions.
 *
 * This lives outside the workspace packages on purpose: it composes the
 * extension child's own terminal context and session pump (server-core) with
 * a provider extension, which no workspace package is allowed to do. Each
 * extension's `test/conformance.test.mjs` imports it by relative path and
 * contributes only its provider descriptor.
 */
export {
	applyConformanceEvent,
	createConformanceHarness,
} from './harness.mjs';
export {
	assertRowIsComplete,
	CAPABILITIES,
	conformanceGate,
	runConformance,
} from './matrix.mjs';
export {
	openConformancePty,
	processTreeBelow,
	stripTerminalEscapes,
} from './pty.mjs';
