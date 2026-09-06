export type {
	ConformanceChild,
	ConformanceHarness,
	ConformanceHarnessOptions,
	ConformanceProjection,
	ConformanceState,
} from './harness.js';
export { createConformanceHarness } from './harness.js';
export type {
	Capability,
	MatrixRow,
	ProviderDescriptor,
	SkipReason,
	Verdict,
} from './matrix.js';
export {
	assertRowIsComplete,
	CAPABILITIES,
	conformanceGate,
	runConformance,
} from './matrix.js';
export type { ConformancePty, ConformancePtyOptions } from './pty.js';
export { openConformancePty } from './pty.js';
