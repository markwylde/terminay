import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const split=await readFile(new URL('../src/projectEnvironments/ProjectEnvironmentSplitButton.tsx',import.meta.url),'utf8');
const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const desktop=await readFile(new URL('../electron/main.ts',import.meta.url),'utf8');
const browser=await readFile(new URL('../src/web/ConnectedWebRendererWorkspace.tsx',import.meta.url),'utf8');
const forms=await readFile(new URL('../src/projectEnvironments/DeclarativeProviderForm.tsx',import.meta.url),'utf8');
const surfaces=await readFile(new URL('../src/projectEnvironments/ProjectEnvironmentSurfaces.tsx',import.meta.url),'utf8');
const settings=await readFile(new URL('../src/components/SettingsWindow.tsx',import.meta.url),'utf8');
const extensionSettings=await readFile(new URL('../src/components/ExtensionSettingsSection.tsx',import.meta.url),'utf8');
const extensionManager=await readFile(new URL('../src/projectEnvironments/ExtensionManager.tsx',import.meta.url),'utf8');
const environmentManager=await readFile(new URL('../src/projectEnvironments/ProjectEnvironmentManager.tsx',import.meta.url),'utf8');
const sharedSettings=await readFile(new URL('../src/shared/SharedSettingsRouteBody.tsx',import.meta.url),'utf8');

test('split button keeps primary This server and a separate accessible chooser',()=>{
	assert.match(split,/aria-label="Create project on This server"/);
	assert.match(split,/aria-haspopup="menu"/);
	assert.match(split,/ArrowDown/);
	assert.match(split,/ArrowUp/);
	assert.match(split,/Escape/);
	assert.match(split,/No matching environments/);
});

test('chooser retries the authenticated server inventory without erasing the last good snapshot',()=>{
	assert.match(split,/onOpen\?\.\(\)/);
	assert.match(app,/onOpen=\{\(\) => void refreshProjectEnvironmentChoices\(\)\}/);
	assert.match(app,/const refreshProjectEnvironmentChoices = useCallback/);
	assert.doesNotMatch(app,/projectEnvironmentsClient\.snapshot\(\)\.then\([\s\S]{0,300}setProjectEnvironmentChoices\(\[\]\)/);
});

test('production forms originate from server provider descriptors without provider fixtures',()=>{
	assert.match(surfaces,/snapshot\.providers/);
	assert.match(surfaces,/provider\.profileForm/);
	assert.match(surfaces,/updateProfile/);
	assert.doesNotMatch(surfaces,/FIXTURE|terminay\.ssh|com\.terminay\.ssh/);
});

test('generic form renderer covers bounded async choices and accessible preset cards',()=>{
	assert.match(forms,/optionSource/);
	assert.match(forms,/AbortController/);
	assert.match(forms,/formDefaults/);
	assert.match(forms,/option\.default === true/);
	assert.match(forms,/field\.suggestionSource/);
	assert.match(forms,/Regenerate/);
	assert.match(surfaces,/client!\.resolveOptions/);
	assert.match(forms,/No options available/);
	assert.match(forms,/type="radio"/);
	assert.match(forms,/role="alert"/);
	assert.match(forms,/className="settings-category-header"/);
	assert.match(forms,/className="settings-group declarative-provider-disclosure"/);
	assert.match(forms,/className="settings-row-control declarative-provider-field__control"/);
	assert.match(forms,/className="settings-primary-button"/);
	assert.doesNotMatch(forms,/declarative-provider-form__fields/);
	assert.doesNotMatch(forms,/grid-template-columns:\s*repeat\(2/);
});

test('Desktop and browser File menus converge on shared management commands',()=>{
	for(const command of ['open-project-environments','open-extensions']){
		assert.match(desktop,new RegExp(command));
		assert.match(browser,new RegExp(command));
		assert.match(app,new RegExp(command));
	}
	assert.match(desktop,/open-remote-control/);
	assert.match(app,/open-remote-control/);
	assert.match(browser,/Remote Control/);
	assert.match(browser,/openRemoteControl/);
});

test('Extensions use the ordinary selected-server Settings surface',()=>{
	assert.match(settings,/id: 'extensions'/);
	assert.match(settings,/<ExtensionSettingsSection\s+applicationClient=\{applicationClient\}\s+serverName=\{serverIdentity\}/);
	assert.match(settings,/activeCategoryId === 'extensions' \? undefined/);
	assert.match(extensionSettings,/new ExtensionsClient\(new TerminayClientFacade\(applicationClient\)\)/);
	assert.match(extensionSettings,/className="settings-category-header"/);
	assert.match(extensionSettings,/<ExtensionManager/);
	assert.match(extensionManager,/className="settings-group extension-card"/);
	assert.match(extensionManager,/Install package file/);
	assert.match(extensionManager,/type="file" accept="\.tgz,application\/gzip"/);
	assert.match(sharedSettings,/onResetAll === undefined \? null/);
});

test('Project Environments use a full auxiliary window rather than an editor dialog',()=>{
	assert.match(surfaces,/<div className="project-environments-window"/);
	assert.match(environmentManager,/<SharedSettingsRouteBody/);
	assert.doesNotMatch(surfaces,/ProjectEnvironmentSurfaceDialog|aria-modal|role="dialog"|surface-backdrop/);
	assert.doesNotMatch(surfaces,/ExtensionManager|ExtensionsClient/);
	assert.doesNotMatch(app,/ProjectEnvironmentSurfaceDialog|projectEnvironmentSurface/);
	assert.match(desktop,/'project-environments': 'Project Environments'/);
	assert.match(desktop,/canonicalAuxiliaryRequest/);
	assert.match(desktop,/presentCanonicalAuxiliaryRoute/);
	assert.match(environmentManager,/sidebarAction=/);
	assert.match(environmentManager,/Add connection/);
	assert.match(environmentManager,/\{detail \?\? \(/);
	assert.match(surfaces,/detail=\{formTarget === null \? undefined : \(/);
});

test('installed provider actions open the exact profile or environment journey',()=>{
	assert.match(app,/projectEnvironmentProviders\.flatMap/);
	assert.match(app,/Create new Puzed VM/);
	assert.match(split,/createActions\.map/);
	assert.match(browser,/params\.set\('auxiliary', 'project-environments'\)/);
	assert.match(browser,/params\.set\('provider', request\.intent\.providerId\)/);
	assert.match(browser,/params\.set\('mode', request\.intent\.mode\)/);
	assert.match(browser,/initialIntent=\{route\.intent\}/);
	assert.match(surfaces,/initialIntent \?\? intentFromLocation\(\)/);
});

test('remote project selection invokes the server and never falls back to Local',()=>{
	assert.match(app,/projectEnvironmentsClient\.createProject/);
	assert.doesNotMatch(app,/environment\.isThisServer[\s\S]{0,600}catch[\s\S]{0,300}addProject\(\)/);
});
