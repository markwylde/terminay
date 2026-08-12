import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { DeclarativeFieldDto, DeclarativeFormDto } from './uiModel';

type FormValue = string | boolean;

export function DeclarativeProviderForm({
	form,
	onCancel,
	onSubmit,
	onLoadOptions,
}: Readonly<{
	form: DeclarativeFormDto;
	onCancel: () => void;
	onSubmit: (values: Readonly<Record<string, FormValue>>) => Promise<void> | void;
	onLoadOptions?: (fieldId: string, source: string, query: string, signal: AbortSignal) => Promise<readonly Readonly<{ label: string; value: string; description?: string }>[]>
}>) {
	const [values, setValues] = useState<Record<string, FormValue>>({});
	const [errors, setErrors] = useState<readonly string[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const visibleSections = useMemo(() => form.sections.map((section) => ({
		...section,
		fields: section.fields.filter((field) => {
			if (field.visibleWhen === undefined) return true;
			return values[field.visibleWhen.fieldId] === field.visibleWhen.equals;
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
		try { await onSubmit(Object.freeze({ ...values })); }
		catch (error) { setErrors([error instanceof Error ? error.message : String(error)]); }
		finally { setSubmitting(false); }
	};

	return (
		<form className="declarative-provider-form" onSubmit={submit} noValidate aria-busy={submitting}>
			<header><h2>{form.title}</h2>{form.description ? <p>{form.description}</p> : null}</header>
			{errors.length > 0 ? (
				<div className="declarative-provider-form__errors" role="alert" tabIndex={-1}>
					<strong>Please check the form</strong>
					<ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
				</div>
			) : null}
			{visibleSections.map((section) => {
				const body = <div className="declarative-provider-form__fields">{section.fields.map((field) => (
					<DeclarativeField key={field.id} field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} onLoadOptions={onLoadOptions} />
				))}</div>;
				return section.disclosure ? (
					<details key={section.id} className="declarative-provider-form__section"><summary>{section.title}</summary>{section.description ? <p>{section.description}</p> : null}{body}</details>
				) : (
					<section key={section.id} className="declarative-provider-form__section" aria-labelledby={`${form.id}-${section.id}`}><h3 id={`${form.id}-${section.id}`}>{section.title}</h3>{section.description ? <p>{section.description}</p> : null}{body}</section>
				);
			})}
			<footer><button type="button" onClick={onCancel}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? 'Working…' : form.submitLabel}</button></footer>
		</form>
	);
}

function DeclarativeField({ field, value, onChange, onLoadOptions }: Readonly<{ field: DeclarativeFieldDto; value?: FormValue; onChange: (value: FormValue) => void; onLoadOptions?: (fieldId:string,source:string,query:string,signal:AbortSignal)=>Promise<readonly Readonly<{label:string;value:string;description?:string}>[]> }>) {
	const describedBy = field.description === undefined ? undefined : `${field.id}-description`;
	const [options,setOptions]=useState(field.options??[]); const [query,setQuery]=useState(''); const [loading,setLoading]=useState(false);
	const loadOptions=async()=>{if(field.optionSource===undefined||onLoadOptions===undefined)return;const controller=new AbortController();setLoading(true);try{setOptions(await onLoadOptions(field.id,field.optionSource,query,controller.signal));}finally{setLoading(false);}};
	if (field.kind === 'checkbox' || field.kind === 'switch') return (
		<label className="declarative-provider-field declarative-provider-field--check">
			<input type="checkbox" role={field.kind === 'switch' ? 'switch' : undefined} checked={value === true} onChange={(event) => onChange(event.target.checked)} aria-describedby={describedBy} />
			<span><strong>{field.label}</strong>{field.description ? <small id={describedBy}>{field.description}</small> : null}</span>
		</label>
	);
	if(field.kind==='preset-cards') return <fieldset className="declarative-provider-field declarative-provider-preset-cards"><legend>{field.label}</legend>{options.map(option=><label key={option.value} className={value===option.value?'is-selected':''}><input type="radio" name={field.id} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)} /><span><strong>{option.label}</strong>{option.description?<small>{option.description}</small>:null}</span></label>)}</fieldset>;
	return (
		<label className="declarative-provider-field" htmlFor={`declarative-field-${field.id}`}>
			<span>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</span>
			{field.kind === 'textarea' ? <textarea id={`declarative-field-${field.id}`} required={field.required} value={String(value ?? '')} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} />
				: field.kind === 'select' ? <>{field.searchable?<span className="declarative-provider-async-select"><input type="search" aria-label={`Search ${field.label}`} value={query} onChange={event=>setQuery(event.target.value)} /><button type="button" onClick={()=>void loadOptions()} disabled={loading}>{loading?'Loading…':'Search'}</button></span>:null}<select id={`declarative-field-${field.id}`} required={field.required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy}><option value="">Choose…</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></>
				: <input id={`declarative-field-${field.id}`} required={field.required} type={field.kind === 'secret' ? 'password' : field.kind} value={String(value ?? '')} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} aria-describedby={describedBy} />}
			{field.description ? <small id={describedBy}>{field.description}</small> : null}
		</label>
	);
}
