import { createRoot, type Root } from 'react-dom/client';
import { BotTranscript } from '../src/workspace/bots/BotTranscript';

type Attachment = { id: string; name: string; mime: string; size: number };
const state = (
	window as unknown as {
		__audio: {
			roots: Attachment[][];
			requests: {
				op: string;
				payload: unknown;
				signal: AbortSignal;
				resolve: (value: unknown) => void;
				reject: (cause: unknown) => void;
			}[];
			unmount: (index: number) => void;
		};
	}
).__audio;
const transport = {
	queryWithBody: (
		op: string,
		payload: unknown,
		options: { signal?: AbortSignal } = {},
	) =>
		new Promise((resolve, reject) => {
			state.requests.push({
				op,
				payload,
				signal: options.signal ?? new AbortController().signal,
				resolve,
				reject,
			});
		}),
};
// Each entry is its own React root, like a second bot's Chat in one window.
const roots: Root[] = state.roots.map((attachments, index) => {
	const element = document.createElement('div');
	element.id = `root-${index}`;
	document.body.append(element);
	const root = createRoot(element);
	root.render(
		<BotTranscript
			bot={{ id: 'birdbot00001', name: 'Bird', colour: '#4488aa', avatar: '' }}
			transport={transport as never}
			items={[{ kind: 'user', key: `message-${index}`, text: '', attachments }]}
		/>,
	);
	return root;
});
state.unmount = (index) => roots[index]?.unmount();
