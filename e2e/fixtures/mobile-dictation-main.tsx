import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DictationCaptureClient, type DictationUploadRequest } from '@terminay/client-core'
import { MobileDictationWorkflow, type MobileDictationUploadClient } from '../../src/shared/MobileDictationWorkflow'
import './mobile-dictation.css'

function Fixture() {
	const capture = useMemo(() => new DictationCaptureClient({
		createRequestId: () => 'dictation:mobile',
		now: () => 1_000,
	}), [])
	const [attempts, setAttempts] = useState(0)
	const [submitted, setSubmitted] = useState('')
	const upload = useMemo<MobileDictationUploadClient>(() => ({
		async submit(request: DictationUploadRequest) {
			setAttempts(value => value + 1)
			if (attempts === 0) throw new Error('Provider temporarily unavailable')
			setSubmitted(`${request.requestId}:${request.audio.byteLength}:${request.target.panelId}`)
		},
	}), [attempts])
	return <>
		<MobileDictationWorkflow
			capture={capture}
			disclosure={{ serverLabel: 'Project server', provider: 'openai', credentialStatus: 'configured', confirmed: true }}
			target={{ serverId: 'server:mobile', projectId: 'project:mobile', panelId: 'panel:terminal', sessionId: 'terminal:mobile' }}
			upload={upload}
		/>
		<output data-mobile-dictation-attempts>{attempts}</output>
		<output data-mobile-dictation-submitted>{submitted}</output>
	</>
}

const root = document.getElementById('mobile-dictation-root')
if (root === null) throw new Error('Missing mobile dictation root')
createRoot(root).render(<Fixture />)
