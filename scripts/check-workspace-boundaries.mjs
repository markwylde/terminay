import { builtinModules } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const BANNED_SHARED_MODULES = /^(?:node:|electron(?:\/|$)|ws(?:\/|$)|websocket(?:\/|$)|wrtc(?:\/|$)|@(?:roamhq|koush)\/wrtc(?:\/|$)|werift(?:\/|$)|node-datachannel(?:\/|$))/;
const PACKAGE_SOURCE_ROOTS = new Set(['protocol', 'client-core', 'responsive-ui']);
const BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isInside(path, parent) {
  const child = normalize(resolve(path));
  const root = normalize(resolve(parent));
  return child === root || child.startsWith(`${root}${sep}`);
}

function walkFiles(root) {
  if (!isDirectory(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
    }
  };
  visit(root);
  return files;
}

function workspaceDirectories(root, pattern) {
  const prefix = pattern.replace(/\/\*$/, '');
  if (!isDirectory(join(root, prefix))) return [];
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, prefix, entry.name, 'package.json')))
    .map((entry) => join(root, prefix, entry.name));
}

export function discoverWorkspace(rootDirectory) {
  const root = resolve(rootDirectory);
  const rootManifest = readJson(join(root, 'package.json'));
  const patterns = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages ?? [];
  const records = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.endsWith('/*')) continue;
    for (const directory of workspaceDirectories(root, pattern)) {
      const manifest = readJson(join(directory, 'package.json'));
      if (typeof manifest.name !== 'string') continue;
      const kind = pattern.startsWith('apps/') ? 'app' : 'package';
      records.push({
        directory: resolve(directory),
        source: resolve(directory, 'src'),
        kind,
        name: manifest.name,
        manifest,
      });
    }
  }
  return { root, rootManifest, records };
}

function moduleDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);
}

function workspaceDependency(specifier, records) {
  return records.find((record) => specifier === record.name || specifier.startsWith(`${record.name}/`));
}

function packageSubpath(specifier, record) {
  if (specifier === record.name) return null;
  return `./${specifier.slice(record.name.length + 1)}`;
}

function hasExport(record, subpath) {
  if (subpath === null) return true;
  const exportsMap = record.manifest.exports;
  if (!exportsMap || typeof exportsMap !== 'object') return false;
  if (Object.hasOwn(exportsMap, subpath)) return true;
  if (Object.hasOwn(exportsMap, `${subpath}/`)) return true;
  return Object.keys(exportsMap).some((key) => key.includes('*') && subpath.startsWith(key.split('*')[0]) && subpath.endsWith(key.split('*').at(-1)));
}

function desktopLayer(path, record) {
  if (record?.name !== '@terminay/desktop') return null;
  const rest = relative(record.source, path).split(sep);
  return rest[0] || null;
}

function isExtensionWorkspace(record) {
  return typeof record?.directory === 'string' && record.directory.split(sep).includes('extensions');
}

function isDesktopEmbeddedServerImport(file, owner, target) {
  return owner?.name === '@terminay/desktop'
    && target?.name === '@terminay/server'
    && desktopLayer(file, owner) === 'main';
}

function staticModuleSpecifiers(sourceFile) {
  const result = [];
  const add = (node, value) => {
    if (typeof value !== 'string') return;
    result.push({ value, node });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node, node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node, node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === 'require')) add(node, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}

function resolveRelativeSpecifier(importer, specifier) {
  const base = resolve(importer, '..', specifier);
  const candidates = [base, ...Array.from(SOURCE_EXTENSIONS, (extension) => `${base}${extension}`), ...Array.from(SOURCE_EXTENSIONS, (extension) => join(base, `index${extension}`))];
  return candidates.find((candidate) => existsSync(candidate)) ?? base;
}

function sourceKind(path) {
  const extension = extname(path);
  return extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function addViolation(violations, file, sourceFile, node, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({ file, line: position.line + 1, column: position.character + 1, message });
}

function inspectSpecifier({ file, owner, sourceFile, node, specifier, records, violations }) {
  const sourceRootName = owner?.kind === 'package' ? owner.name.slice('@terminay/'.length) : null;
  const packageName = sourceRootName && PACKAGE_SOURCE_ROOTS.has(sourceRootName) ? owner.name : null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const pathParts = specifier.split(/[\\/]/);
    if (pathParts.includes('dist') || pathParts.includes('dist-electron')) addViolation(violations, file, sourceFile, node, `generated-output deep import is not allowed: ${specifier}`);
    const target = resolveRelativeSpecifier(file, specifier);
    if (owner && !isInside(target, owner.source)) addViolation(violations, file, sourceFile, node, `source import escapes ${owner.name}: ${specifier}`);
    const targetOwner = records.find((record) => isInside(target, record.source));
    if (owner?.kind === 'app' && targetOwner?.kind === 'app' && targetOwner !== owner) addViolation(violations, file, sourceFile, node, `application source trees cannot import one another: ${specifier}`);
    const importerLayer = desktopLayer(file, owner);
    const targetLayer = desktopLayer(target, owner);
    if (owner?.name === '@terminay/desktop' && importerLayer === 'renderer' && (targetLayer === 'main' || targetLayer === 'preload')) {
      addViolation(violations, file, sourceFile, node, 'Desktop renderer cannot import main or preload code');
    }
    if (owner?.name === '@terminay/desktop' && targetLayer === 'legacy-services' && importerLayer !== 'compatibility' && importerLayer !== 'legacy-services') {
      addViolation(violations, file, sourceFile, node, 'legacy services may only be reached through Desktop compatibility composition');
    }
    return;
  }

  const target = workspaceDependency(specifier, records);
  if (target) {
    const subpath = packageSubpath(specifier, target);
    if (!hasExport(target, subpath)) addViolation(violations, file, sourceFile, node, `package-internal or generated-output deep import is not public: ${specifier}`);
    if (
      owner
      && target !== owner
      && owner.kind === 'app'
      && target.kind === 'app'
      && !isDesktopEmbeddedServerImport(file, owner, target)
    ) {
      addViolation(violations, file, sourceFile, node, `application packages cannot depend on one another: ${specifier}`);
    }
    if (owner && target !== owner && !moduleDependencies(owner.manifest).has(target.name)) addViolation(violations, file, sourceFile, node, `workspace dependency is not declared by ${owner.name}: ${target.name}`);
    if (isExtensionWorkspace(owner) && target !== owner && target.name !== '@terminay/extension-api') addViolation(violations, file, sourceFile, node, `built-in extensions may import only the public @terminay/extension-api workspace package: ${specifier}`);
    if (target.name === '@terminay/server-core' && owner?.name !== '@terminay/server') addViolation(violations, file, sourceFile, node, 'server-core is only imported by the Server composition');
    return;
  }

  if (owner) {
    const dependencyName = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
    if (!BUILTIN_MODULES.has(specifier) && !moduleDependencies(owner.manifest).has(dependencyName)) {
      addViolation(violations, file, sourceFile, node, `dependency is not declared by ${owner.name}: ${specifier}`);
    }
    if (packageName && BANNED_SHARED_MODULES.test(specifier)) addViolation(violations, file, sourceFile, node, `shared package cannot import platform or concrete transport module: ${specifier}`);
    if (owner.name === '@terminay/server-core' && /^electron(?:\/|$)/.test(specifier)) addViolation(violations, file, sourceFile, node, 'server-core cannot import Electron');
  }
}

export function checkWorkspace(rootDirectory) {
  const { root, records } = discoverWorkspace(rootDirectory);
  const violations = [];
  for (const record of records) {
    const exportsMap = record.manifest.exports;
    if (!exportsMap || typeof exportsMap !== 'object' || !Object.hasOwn(exportsMap, '.')) {
      violations.push({ file: join(record.directory, 'package.json'), line: 1, column: 1, message: `${record.name} must declare an explicit public exports map` });
    }
    for (const file of walkFiles(record.source)) {
      const text = readFileSync(file, 'utf8');
      const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, sourceKind(file));
      for (const { value, node } of staticModuleSpecifiers(sourceFile)) inspectSpecifier({ file, owner: record, sourceFile, node, specifier: value, records, violations });
    }
    if (record.name === '@terminay/desktop') {
      const quarantine = join(record.source, 'legacy-services');
      const allowlistPath = join(record.directory, 'legacy-services.allowlist.json');
      if (existsSync(allowlistPath)) {
        const allowlist = readJson(allowlistPath);
        const allowed = new Set(Array.isArray(allowlist.files) ? allowlist.files : []);
        for (const file of walkFiles(quarantine)) {
          const relativeFile = relative(record.directory, file).split(sep).join('/');
          if (relativeFile.endsWith('.ts') || relativeFile.endsWith('.tsx') || relativeFile.endsWith('.js') || relativeFile.endsWith('.jsx')) {
            if (!allowed.has(relativeFile)) violations.push({ file, line: 1, column: 1, message: `legacy-service quarantine growth is not allowlisted: ${relativeFile}` });
          }
        }
      }
    }
  }
  return { root, records, violations };
}

export function formatViolations(violations) {
  return violations.map(({ file, line, column, message }) => `${file}:${line}:${column} ${message}`).join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const result = checkWorkspace(process.cwd());
  if (result.violations.length > 0) {
    console.error(formatViolations(result.violations));
    process.exitCode = 1;
  } else {
    console.log(`Workspace boundaries OK (${result.records.length} workspace packages)`);
  }
}
