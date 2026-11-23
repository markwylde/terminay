import { createRoot } from 'react-dom/client';
import { BotTranscript } from '../src/workspace/bots/BotTranscript';

const state = (
	window as unknown as {
		__video: {
			requests: {
				op: string;
				payload: unknown;
				signal: AbortSignal;
				resolve: (value: unknown) => void;
				reject: (cause: unknown) => void;
			}[];
			unmount: () => void;
		};
	}
).__video;
const transport = {
	queryWithBody: (
		op: string,
		payload: unknown,
		options: { signal: AbortSignal },
	) =>
		new Promise((resolve, reject) => {
			state.requests.push({
				op,
				payload,
				signal: options.signal,
				resolve,
				reject,
			});
		}),
};
const root = createRoot(document.getElementById('root')!);
state.unmount = () => root.unmount();
root.render(
	<BotTranscript
		bot={{ id: 'birdbot00001', name: 'Bird', colour: '#4488aa', avatar: '' }}
		transport={transport as never}
		items={[
			{
				kind: 'user',
				key: 'message',
				text: '',
				attachments: [
					{
						id: 'a'.repeat(24),
						name: 'clip.webm',
						mime: 'video/webm',
						size: 1024,
					},
				],
			},
		]}
	/>,
);
