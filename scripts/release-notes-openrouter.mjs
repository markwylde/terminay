const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function requestReleaseNotes({
	apiKey,
	instructions,
	message,
	fetchImpl = fetch,
}) {
	if (!apiKey)
		throw new Error(
			'OPENROUTER_API_KEY is required to generate AI release notes',
		);
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 90_000);
	let response;
	try {
		response = await fetchImpl(ENDPOINT, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://github.com/markwylde/terminay',
				'X-Title': 'Terminay release notes',
			},
			body: JSON.stringify({
				model: 'anthropic/claude-haiku-4.5',
				temperature: 0.2,
				max_tokens: 2_500,
				messages: [
					{ role: 'system', content: instructions },
					{ role: 'user', content: message },
				],
			}),
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timeout);
	}

	const responseText = await response.text();
	if (!response.ok) {
		throw new Error(
			`OpenRouter release-notes request failed with HTTP ${response.status}`,
		);
	}
	if (responseText.length > MAX_RESPONSE_BYTES) {
		throw new Error('OpenRouter release-notes response exceeded 2 MiB');
	}
	const payload = JSON.parse(responseText);
	const notes = payload?.choices?.[0]?.message?.content;
	if (typeof notes !== 'string' || !notes.trim()) {
		throw new Error(
			'OpenRouter release-notes response did not contain markdown',
		);
	}
	if (!/^##\s+/mu.test(notes) || !/^###\s+/mu.test(notes)) {
		throw new Error(
			'OpenRouter release-notes response did not match the required structure',
		);
	}
	return `${notes.trim()}\n`;
}
