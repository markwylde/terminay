export type ProjectEnvironmentStatus =
	| 'ready'
	| 'connecting'
	| 'reconnecting'
	| 'provisioning'
	| 'starting'
	| 'stopping'
	| 'offline'
	| 'authentication-required'
	| 'host-key-changed'
	| 'permission-denied'
	| 'extension-missing'
	| 'extension-disabled'
	| 'extension-incompatible'
	| 'unreachable'
	| 'failed';

/** Fixed renderer DTO. It intentionally contains presentation-safe data only. */
export type ProjectEnvironmentSummaryDto = Readonly<{
	id: string;
	providerId: string;
	profileId?: string;
	providerLabel: string;
	name: string;
	endpointSummary: string;
	defaultRoot?: string;
	status: ProjectEnvironmentStatus;
	referencedProjectCount: number;
	isThisServer?: boolean;
	isFavourite?: boolean;
	lastUsedAt?: string;
	statusCard?:import('@terminay/client-core').ProjectEnvironmentStatusCard;
	profileOnly?: boolean;
}>;

export type ExtensionSummaryDto = Readonly<{
	id: string;
	packageName: string;
	displayName: string;
	description: string;
	version?: string;
	state: 'available' | 'installed' | 'disabled' | 'incompatible' | 'failed' | 'quarantined' | 'pending';
	official: boolean;
	permissions: readonly string[];
	dependants: readonly string[];
	provenance?: string;
}>;

export type DeclarativeFieldDto = Readonly<{
	id: string;
	label: string;
	kind: 'text' | 'number' | 'url' | 'secret' | 'checkbox' | 'switch' | 'textarea' | 'select' | 'preset-cards';
	required?: boolean;
	description?: string;
	placeholder?: string;
	defaultValue?: string | number | boolean | null;
	suggestionSource?: string;
	suggestionLabel?: string;
	options?: readonly Readonly<{ label: string; value: string; description?: string; disabledReason?: string; default?: boolean }>[];
	optionSource?: string;
	searchable?: boolean;
	visibleWhen?: Readonly<{
		fieldId: string;
		equals?: string | number | boolean | null;
		notEquals?: string | number | boolean | null;
	}>;
}>;

export type DeclarativeSectionDto = Readonly<{
	id: string;
	title: string;
	description?: string;
	disclosure?: 'always' | 'expanded' | 'collapsed';
	fields: readonly DeclarativeFieldDto[];
}>;

export type DeclarativeFormDto = Readonly<{
	id: string;
	title: string;
	description?: string;
	sections: readonly DeclarativeSectionDto[];
	submitLabel: string;
}>;

export function statusLabel(status: ProjectEnvironmentStatus): string {
	return status.replaceAll('-', ' ');
}
