#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
	createHash,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
	X509Certificate,
} from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SECRET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const {
	command,
	outputDirectory,
	identity,
	keychain,
	releasePrivateKey,
	rotateReleaseKey,
} = parseArguments(process.argv.slice(2));

await createPrivateOutputDirectory(outputDirectory);
let success = false;
try {
	const written = [];
	let publicFingerprint = null;

	if (command === 'macos') {
		assertMacOS();
		const certificate = await exportMacOSIdentity({ identity, keychain });
		await writeSecret(
			outputDirectory,
			'MACOS_CERTIFICATE_P12',
			certificate.encodedP12,
		);
		await writeSecret(
			outputDirectory,
			'MACOS_CERTIFICATE_PASSWORD',
			certificate.password,
		);
		written.push('MACOS_CERTIFICATE_P12', 'MACOS_CERTIFICATE_PASSWORD');
	}

	if (releasePrivateKey || rotateReleaseKey) {
		const signingKey = await prepareReleaseSigningKey({
			releasePrivateKey,
			rotateReleaseKey,
		});
		await writeSecret(
			outputDirectory,
			'TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64',
			signingKey.privateKeyBase64,
		);
		await writeSecret(
			outputDirectory,
			'TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64',
			signingKey.publicKeyBase64,
		);
		written.push(
			'TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64',
			'TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64',
		);
		publicFingerprint = signingKey.publicFingerprint;
	}

	await writeManifest(outputDirectory, {
		command,
		identity: command === 'macos' ? identity : null,
		written,
		publicFingerprint,
	});
	success = true;
	process.stdout.write(
		`Prepared ${written.length} credential files in ${outputDirectory}\n`,
	);
	for (const name of written) process.stdout.write(`- ${name}\n`);
	if (publicFingerprint)
		process.stdout.write(`Release public-key SHA-256: ${publicFingerprint}\n`);
	process.stdout.write(
		'Credential values were not printed. Delete the directory after saving them in repository settings.\n',
	);
} finally {
	if (!success) await rm(outputDirectory, { recursive: true, force: true });
}

function parseArguments(argv) {
	const command = argv.shift();
	if (!['macos', 'release-key'].includes(command)) usage();

	let outputDirectory;
	let identity = 'Developer ID Application: Puzed Ltd (P3J23J5CWT)';
	let keychain = resolve(
		process.env.HOME ?? '',
		'Library/Keychains/login.keychain-db',
	);
	let releasePrivateKey;
	let rotateReleaseKey = false;

	while (argv.length > 0) {
		const option = argv.shift();
		if (option === '--output-dir')
			outputDirectory = requireValue(option, argv.shift());
		else if (option === '--identity')
			identity = requireValue(option, argv.shift());
		else if (option === '--keychain')
			keychain = resolve(requireValue(option, argv.shift()));
		else if (option === '--release-private-key')
			releasePrivateKey = resolve(requireValue(option, argv.shift()));
		else if (option === '--rotate-release-key') rotateReleaseKey = true;
		else usage(`unknown option: ${option}`);
	}

	if (!outputDirectory) usage('--output-dir is required');
	if (releasePrivateKey && rotateReleaseKey)
		usage('choose --release-private-key or --rotate-release-key, not both');
	if (command === 'release-key' && !releasePrivateKey && !rotateReleaseKey) {
		usage('release-key requires --release-private-key or --rotate-release-key');
	}

	return {
		command,
		outputDirectory: resolve(outputDirectory),
		identity,
		keychain,
		releasePrivateKey,
		rotateReleaseKey,
	};
}

function requireValue(option, value) {
	if (!value || value.startsWith('--')) usage(`${option} requires a value`);
	return value;
}

function usage(error) {
	if (error) process.stderr.write(`${error}\n`);
	process.stderr.write(
		'usage: prepare-release-credentials.mjs <macos|release-key> --output-dir <new-directory> [--identity <name>] [--keychain <path>] [--release-private-key <pem>] [--rotate-release-key]\n',
	);
	process.exit(2);
}

async function createPrivateOutputDirectory(path) {
	const repositoryRelativePath = relative(REPOSITORY_ROOT, path);
	if (
		repositoryRelativePath === '' ||
		(!repositoryRelativePath.startsWith('..') &&
			!isAbsolute(repositoryRelativePath))
	) {
		throw new Error('output directory must be outside the repository');
	}
	const parent = dirname(path);
	const parentInfo = await lstat(parent);
	if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
		throw new Error(`output parent must be a real directory: ${parent}`);
	await mkdir(path, { mode: DIRECTORY_MODE });
	await chmod(path, DIRECTORY_MODE);
}

function assertMacOS() {
	if (process.platform !== 'darwin')
		throw new Error('macos credential export must run on macOS');
}

async function exportMacOSIdentity({ identity, keychain }) {
	const keychainInfo = await lstat(keychain);
	if (!keychainInfo.isFile() || keychainInfo.isSymbolicLink())
		throw new Error(`keychain must be a regular file: ${keychain}`);

	const { stdout } = await execFileAsync('security', [
		'find-identity',
		'-v',
		'-p',
		'codesigning',
		keychain,
	]);
	const exactMatches = stdout
		.split('\n')
		.filter((line) => line.includes(`"${identity}"`));
	if (exactMatches.length !== 1)
		throw new Error(
			`expected exactly one valid code-signing identity named ${identity}; found ${exactMatches.length}`,
		);

	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-release-identity-'),
	);
	await chmod(temporaryDirectory, DIRECTORY_MODE);
	try {
		const p12Path = join(temporaryDirectory, 'identity.p12');
		const passwordPath = join(temporaryDirectory, 'password');
		const password = randomBytes(36).toString('base64url');
		await writeFile(passwordPath, `${password}\n`, {
			mode: SECRET_MODE,
			flag: 'wx',
		});

		// macOS security has no stdin passphrase option. The generated passphrase
		// is exposed to the local process table only for this short-lived export.
		await execFileAsync('security', [
			'export',
			'-k',
			keychain,
			'-t',
			'identities',
			'-f',
			'pkcs12',
			'-P',
			password,
			'-o',
			p12Path,
		]);
		const p12 = await readFile(p12Path);
		if (p12.length === 0)
			throw new Error('Keychain exported an empty PKCS#12 file');
		await verifyExportedIdentity({ p12Path, passwordPath, identity });
		return { encodedP12: p12.toString('base64'), password };
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

async function verifyExportedIdentity({ p12Path, passwordPath, identity }) {
	const { stdout } = await execFileAsync(
		'openssl',
		[
			'pkcs12',
			'-in',
			p12Path,
			'-passin',
			`file:${passwordPath}`,
			'-clcerts',
			'-nokeys',
			'-nodes',
		],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
	const certificates = [
		...stdout.matchAll(
			/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu,
		),
	].map(([pem]) => new X509Certificate(pem));
	const matches = certificates.filter((certificate) =>
		certificate.subject.includes(`CN=${identity}`),
	);
	if (matches.length !== 1)
		throw new Error(
			`PKCS#12 export did not contain exactly one ${identity} certificate`,
		);
}

async function prepareReleaseSigningKey({
	releasePrivateKey,
	rotateReleaseKey,
}) {
	let privateKey;
	if (rotateReleaseKey) {
		privateKey = generateKeyPairSync('ed25519').privateKey;
	} else {
		const info = await lstat(releasePrivateKey);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 32_768)
			throw new Error('release private key must be a bounded regular file');
		privateKey = createPrivateKey(await readFile(releasePrivateKey));
	}
	if (privateKey.asymmetricKeyType !== 'ed25519')
		throw new Error('release private key must be Ed25519');

	const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
	const publicPem = createPublicKey(privateKey).export({
		type: 'spki',
		format: 'pem',
	});
	return {
		privateKeyBase64: Buffer.from(privatePem).toString('base64'),
		publicKeyBase64: Buffer.from(publicPem).toString('base64'),
		publicFingerprint: createHash('sha256').update(publicPem).digest('hex'),
	};
}

async function writeSecret(directory, name, value) {
	if (!BASE64.test(value) && name !== 'MACOS_CERTIFICATE_PASSWORD')
		throw new Error(`${name} is not valid single-line base64`);
	const path = join(directory, name);
	await writeFile(path, `${value}\n`, { mode: SECRET_MODE, flag: 'wx' });
	await chmod(path, SECRET_MODE);
}

async function writeManifest(
	directory,
	{ command, identity, written, publicFingerprint },
) {
	const manifest = [
		'Terminay release credential preparation',
		`Mode: ${command}`,
		identity ? `Apple identity: ${identity}` : null,
		publicFingerprint
			? `Release public-key SHA-256: ${publicFingerprint}`
			: null,
		'',
		...written.map(
			(name) =>
				`${name}: ${name === 'TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64' ? 'repository variable' : 'repository secret'}`,
		),
		'',
		'Credential values are stored in the named files and are intentionally absent from this manifest.',
	]
		.filter((line) => line !== null)
		.join('\n');
	const path = join(directory, 'README.txt');
	await writeFile(path, `${manifest}\n`, { mode: SECRET_MODE, flag: 'wx' });
	await chmod(path, SECRET_MODE);
}
