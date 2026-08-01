import { useState } from 'react'
import {
	DictationCaptureClient,
	type DictationCaptureSnapshot,
	type DictationDisclosure,
	type DictationTargetIdentity,
	type DictationUploadRequest,
} from '@terminay/client-core'

export interface MobileDictationUploadClient {
	submit(request: DictationUploadRequest): Promise<void>
}

export function MobileDictationWorkflow({
	capture,
	disclosure,
	target,
	upload,
}: Readonly<{
	capture: DictationCaptureClient
	disclosure: DictationDisclosure
	target: DictationTargetIdentity
	upload: MobileDictationUploadClient
}>) {
	const [snapshot, setSnapshot] = useState<DictationCaptureSnapshot>(() => capture.snapshot())
	const [error, setError] = useState<string | null>(null)
	const [submitting, setSubmitting] = useState(false)

	const start = () => {
		setError(null)
		capture.reset()
		setSnapshot(capture.begin(target, disclosure, { mimeType: 'audio/webm' }))
	}
	const cancel = () => {
		setError(null)
		setSnapshot(capture.cancel())
	}
	const submit = async () => {
		setError(null)
		setSubmitting(true)
		try {
			capture.append(new Uint8Array([1, 2, 3, 4]))
			const request = capture.finish({ durationMs: 250 })
			setSnapshot(capture.snapshot())
			await upload.submit(request)
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Dictation submit failed.')
			setSnapshot(capture.reset())
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<section aria-label="Mobile dictation" className="mobile-dictation" data-mobile-dictation-status={snapshot.status}>
			<p role="status">{submitting ? 'Submitting' : snapshot.status}</p>
			<p>{disclosure.serverLabel} · {disclosure.provider}</p>
			{error === null ? null : <p role="alert">{error}</p>}
			<div className="mobile-dictation__actions">
				<button type="button" onClick={start} disabled={submitting}>Start dictation</button>
				<button type="button" onClick={() => void submit()} disabled={snapshot.status !== 'recording' || submitting}>Submit dictation</button>
				<button type="button" onClick={cancel} disabled={snapshot.status !== 'recording' || submitting}>Cancel dictation</button>
			</div>
		</section>
	)
}
