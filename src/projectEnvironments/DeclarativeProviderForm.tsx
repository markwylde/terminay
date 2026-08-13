import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { DeclarativeFieldDto, DeclarativeFormDto } from './uiModel';

type FormValue = string | boolean;
type SelectOption = Readonly<{ label: string; value: string; description?: string }>;

export function DeclarativeProviderForm({
	form,
	onCancel,
	onSubmit,
	onLoadOptions,
	initialValues = {},
}: Readonly<{
	form: DeclarativeFormDto;
	onCancel: () => void;
	onSubmit: (values: Readonly<Record<string, FormValue>>) => Promise<void> | void;
	onLoadOptions?: (fieldId: string, source: string, query: string, values: Readonly<Record<string, FormValue>>, signal: AbortSignal) => Promise<readonly SelectOption[]>;
	initialValues?: Readonly<Record<string, FormValue>>;
}>) {
	const [values, setValues] = useState<Record<string, FormValue>>({ ...initialValues });
	const [errors, setErrors] = useState<readonly string[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const visibleSections = useMemo(() => form.sections.map((section) => ({
		...section,
		fields: section.fields.filter((field) => {
			if (field.visibleWhen === undefined) return true;
			const current = values[field.visibleWhen.fieldId];
			if (field.visibleWhen.equals !== undefined) return current === field.visibleWhen.equals;
			if (field.visibleWhen.notEquals !== undefined) return current !== field.visibleWhen.notEquals;
			return true;
		}),
	})), [form.sections, values]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const nextErrors = visibleSections.flatMap((section) => section.fields.flatMap((field) => {
			const value = values[field.id];
			return field.required === true && (value === undefined || value === '' || value === false)
				? [`${field.label} is required.`]
				: [];
		}));
		setErrors(nextErrors);
		if (nextErrors.length > 0) return;
		setSubmitting(true);
		try {
			await onSubmit(Object.freeze({ ...values }));
		} catch (error) {
			setErrors([error instanceof Error ? error.message : String(error)]);
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form className="declarative-provider-form" onSubmit={submit} noValidate aria-busy={submitting}>
			<header className="settings-category-header">
				<h2>{form.title}</h2>
				{form.description ? <p>{form.description}</p> : null}
			</header>
			{errors.length > 0 ? (
				<div className="settings-inline-error declarative-provider-form__errors" role="alert" tabIndex={-1}>
					<div><strong>Please check the form</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>
				</div>
			) : null}
			{visibleSections.map((section) => {
				const fields = section.fields.map((field) => (
					<DeclarativeField
						key={field.id}
						field={field}
						value={values[field.id]}
						onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
						onLoadOptions={onLoadOptions}
						values={values}
					/>
				));
				if (section.disclosure === 'expanded' || section.disclosure === 'collapsed') {
					return (
						<section key={section.id} className="settings-section declarative-provider-section">
							<details className="settings-group declarative-provider-disclosure" open={section.disclosure === 'expanded' ? true : undefined}>
								<summary className="settings-row">
									<span className="settings-row-info">
										<strong className="settings-row-label">{section.title}</strong>
										{section.description ? <span className="settings-row-description">{section.description}</span> : null}
									</span>
									<span className="declarative-provider-disclosure__chevron" aria-hidden="true">›</span>
								</summary>
								<div className="declarative-provider-disclosure__body">{fields}</div>
							</details>
						</section>
					);
				}
				return (
					<section key={section.id} className="settings-section declarative-provider-section" aria-labelledby={`${form.id}-${section.id}`}>
						<h3 className="settings-section-title" id={`${form.id}-${section.id}`}>{section.title}</h3>
						{section.description ? <p className="settings-section-desc declarative-provider-section__description">{section.description}</p> : null}
						<div className="settings-group">{fields}</div>
					</section>
				);
			})}
			<footer className="declarative-provider-form__actions">
				<button className="settings-secondary-button" type="button" onClick={onCancel}>Cancel</button>
				<button className="settings-primary-button" type="submit" disabled={submitting}>{submitting ? 'Working…' : form.submitLabel}</button>
			</footer>
		</form>
	);
}

function DeclarativeField({
	field,
	value,
	onChange,
	onLoadOptions,
	values,
}: Readonly<{
	field: DeclarativeFieldDto;
	value?: FormValue;
	onChange: (value: FormValue) => void;
	onLoadOptions?: (fieldId: string, source: string, query: string, values: Readonly<Record<string, FormValue>>, signal: AbortSignal) => Promise<readonly SelectOption[]>;
	values: Readonly<Record<string, FormValue>>;
}>) {
	const describedBy = field.description === undefined ? undefined : `${field.id}-description`;
	const [options, setOptions] = useState(field.options ?? []);
	const [query, setQuery] = useState('');
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState('');
	const valuesKey = JSON.stringify(values);
	const loadOptions = async (signal?: AbortSignal) => {
		if (field.optionSource === undefined || onLoadOptions === undefined) return;
		const controller = signal === undefined ? new AbortController() : null;
		setLoading(true);
		setLoadError('');
		try {
			setOptions(await onLoadOptions(field.id, field.optionSource, query, values, signal ?? controller!.signal));
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				setLoadError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			setLoading(false);
		}
	};
	useEffect(() => {
		if (field.optionSource === undefined || onLoadOptions === undefined) return;
		const controller = new AbortController();
		void loadOptions(controller.signal);
		return () => controller.abort();
	}, [field.id, field.optionSource, onLoadOptions, valuesKey]);

	if (field.kind === 'checkbox' || field.kind === 'switch') {
		return (
			<label className="settings-row declarative-provider-toggle">
				<span className="settings-row-info">
					<strong className="settings-row-label">{field.label}</strong>
					{field.description ? <span className="settings-row-description" id={describedBy}>{field.description}</span> : null}
				</span>
				<span className="settings-row-control">
					<input type="checkbox" role={field.kind === 'switch' ? 'switch' : undefined} checked={value === true} onChange={(event) => onChange(event.target.checked)} aria-describedby={describedBy} />
				</span>
			</label>
		);
	}

	if (field.kind === 'preset-cards') {
		return (
			<fieldset className="settings-row settings-row--stacked declarative-provider-preset-field">
				<legend className="settings-row-label">{field.label}</legend>
				{field.description ? <span className="settings-row-description" id={describedBy}>{field.description}</span> : null}
				<div className="declarative-provider-preset-cards" aria-describedby={describedBy}>
					{options.map((option) => (
						<label key={option.value} className={value === option.value ? 'is-selected' : ''}>
							<input type="radio" name={field.id} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
							<span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
						</label>
					))}
				</div>
				{loadError?<span className="settings-row-description declarative-provider-option-error" role="alert">{loadError}</span>:!loading&&field.optionSource!==undefined&&options.length===0?<span className="settings-row-description" role="status">No options available.</span>:null}
			</fieldset>
		);
	}

	let control: ReactNode;
	if (field.kind === 'textarea') {
		control = <textarea className="settings-input-textarea" id={`declarative-field-${field.id}`} required={field.required} value={String(value ?? '')} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} />;
	} else if (field.kind === 'select') {
		control = (
			<div className="declarative-provider-select-control">
				{field.searchable ? (
					<span className="declarative-provider-async-select">
						<input className="settings-input-text" type="search" aria-label={`Search ${field.label}`} value={query} onChange={(event) => setQuery(event.target.value)} />
						<button className="settings-secondary-button settings-secondary-button--small" type="button" onClick={() => void loadOptions()} disabled={loading}>{loading ? 'Loading…' : 'Search'}</button>
					</span>
				) : null}
				<select className="settings-select" id={`declarative-field-${field.id}`} required={field.required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy}>
					<option value="">Choose…</option>
					{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
				</select>
				{loadError?<span className="settings-row-description declarative-provider-option-error" role="alert">{loadError}</span>:!loading&&field.optionSource!==undefined&&options.length===0?<span className="settings-row-description" role="status">No options available.</span>:null}
			</div>
		);
	} else {
		control = <input className="settings-input-text" id={`declarative-field-${field.id}`} required={field.required} type={field.kind === 'secret' ? 'password' : field.kind} value={String(value ?? '')} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} />;
	}

	return (
		<div className={`settings-row${field.kind === 'textarea' ? ' settings-row--stacked' : ''}`}>
			<label className="settings-row-info" htmlFor={`declarative-field-${field.id}`}>
				<span className="settings-row-label">{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</span>
				{field.description ? <span className="settings-row-description" id={describedBy}>{field.description}</span> : null}
			</label>
			<div className="settings-row-control declarative-provider-field__control">{control}</div>
		</div>
	);
}
