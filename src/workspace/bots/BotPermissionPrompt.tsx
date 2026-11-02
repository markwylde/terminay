import type { BotPermission } from '@terminay/protocol';
export function PermissionPrompt({
	permission,
	onDecide,
}: Readonly<{
	permission: BotPermission;
	onDecide: (optionId: string) => void;
}>) {
	const toolCall = permission.toolCall as Record<string, unknown> | null;
	const title =
		typeof toolCall?.title === 'string' && toolCall.title.length > 0
			? toolCall.title
			: 'A tool';
	return (
		<fieldset
			className="bots-card bots-ask"
			aria-label="Permission request"
			data-terminay-bot-permission={permission.id}
		>
			<span className="bots-lab">Needs you</span>
			<b>{title}</b>
			<div className="bots-ask__options">
				{permission.options.map((option) => (
					<button
						key={option.optionId}
						type="button"
						className={`bots-btn bots-btn--sm${option.kind.startsWith('allow') ? ' bots-btn--primary' : ''}`}
						onClick={() => onDecide(option.optionId)}
						data-terminay-bot-permission-option={option.optionId}
					>
						{option.name}
					</button>
				))}
			</div>
		</fieldset>
	);
}
