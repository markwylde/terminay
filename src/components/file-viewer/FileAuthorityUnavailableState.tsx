export function FileAuthorityUnavailableState({
	feature,
}: Readonly<{ feature: 'File viewer' | 'Folder viewer' }>) {
	return (
		<div className="file-viewer-error" role="alert">
			{feature} is unavailable for the selected server project. Reconnect to the
			selected server and retry.
		</div>
	);
}
