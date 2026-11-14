import { X } from 'lucide-react';
import { createElement, type ReactElement, type ReactNode } from 'react';

/**
 * The dismissable bar every workspace error uses: a full-width strip across
 * the top of the area it belongs to, with a close button on the right.
 */
export function ErrorBanner({
	children,
	onDismiss,
	...data
}: {
	children: ReactNode;
	onDismiss: () => void;
} & { [key: `data-${string}`]: string | undefined }): ReactElement {
	return createElement(
		'div',
		{ className: 'error-banner', ...data },
		createElement('span', { className: 'error-banner__message' }, children),
		createElement(
			'button',
			{
				type: 'button',
				className: 'error-banner__dismiss',
				'aria-label': 'Dismiss error',
				title: 'Dismiss',
				onClick: onDismiss,
			},
			createElement(X, { size: 14, 'aria-hidden': true }),
		),
	);
}
