import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DICTATION_UPLOAD_LIMIT_BYTES,
	EMPTY_DICTATION_WAVEFORM,
	encodeDictationWav,
	formatDictationTranscriptForTerminal,
	getDictationFileExtension,
} from './dictationAudioSupport';

test('dictation audio format helpers preserve upload and extension contracts', () => {
	assert.equal(DICTATION_UPLOAD_LIMIT_BYTES, 25 * 1024 * 1024);
	assert.equal(getDictationFileExtension('audio/mp4;codecs=aac'), 'mp4');
	assert.equal(getDictationFileExtension('audio/mpeg'), 'mp3');
	assert.equal(getDictationFileExtension('audio/wav'), 'wav');
	assert.equal(getDictationFileExtension('audio/webm;codecs=opus'), 'webm');
	assert.equal(EMPTY_DICTATION_WAVEFORM.length, 18);
	assert.ok(EMPTY_DICTATION_WAVEFORM.every((level) => level === 0.08));
});

test('PCM chunks are encoded as a bounded mono 16-bit WAV', async () => {
	const wav = encodeDictationWav(
		[Float32Array.from([-1, 0, 1])],
		16_000,
		3,
	);
	const bytes = new Uint8Array(await wav.arrayBuffer());
	assert.equal(wav.type, 'audio/wav');
	assert.equal(bytes.byteLength, 50);
	assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
	assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE');
	assert.equal(new DataView(bytes.buffer).getUint32(24, true), 16_000);
	assert.equal(new DataView(bytes.buffer).getUint16(34, true), 16);
});

test('multiline transcripts retain bracketed-paste formatting', () => {
	assert.equal(formatDictationTranscriptForTerminal('one'), 'one');
	assert.equal(
		formatDictationTranscriptForTerminal('one\ntwo'),
		'\u001b[200~one\ntwo\u001b[201~',
	);
});
