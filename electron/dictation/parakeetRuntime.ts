// Electron is only a host for the server-owned runtime. Keep this compatibility
// export while legacy Desktop IPC is migrated onto the selected-server API.
export {
	PARAKEET_AUDIO_FORMAT,
	PARAKEET_MLX_LICENSE,
	PARAKEET_MLX_VERSION,
	PARAKEET_MODEL,
	PARAKEET_MODEL_LICENSE,
	PARAKEET_MODEL_REVISION,
	ParakeetRuntime,
	parakeetFfmpegArguments,
} from '../../packages/server-core/src/aiService/parakeetRuntime';
export type {
	ParakeetRuntimeDisclosure,
	ParakeetRuntimeOptions,
} from '../../packages/server-core/src/aiService/parakeetRuntime';
