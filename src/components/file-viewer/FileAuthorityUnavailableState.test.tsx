import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FileViewerClient } from '../../../packages/client-core/src/fileViewer';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileAuthorityUnavailableState } from './FileAuthorityUnavailableState';

describe('file authority unavailable state', () => {
	it('rejects an unscoped canonical query and keeps the terminal live beside an actionable alert', async () => {
		let transportCalls = 0;
		const client = new FileViewerClient({
			async command() {
				transportCalls += 1;
				throw new Error('unscoped command reached transport');
			},
			async query() {
				transportCalls += 1;
				throw new Error('unscoped query reached transport');
			},
		});
		await assert.rejects(() => client.listFolder('.'), /project id is required/);
		assert.equal(transportCalls, 0);

		const markup = renderToStaticMarkup(
			<div>
				<div data-terminal-state="live">terminal output</div>
				<FileAuthorityUnavailableState feature="File viewer" />
			</div>,
		);
		assert.match(markup, /data-terminal-state="live"/);
		assert.match(markup, /role="alert"/);
		assert.match(markup, /Reconnect to the selected server and retry\./);
	});
});
