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
	assert.match(forms,/type="radio"/);
	assert.match(forms,/role="alert"/);
});

test('Desktop and browser File menus converge on shared management commands',()=>{
	for(const command of ['open-project-environments','open-extensions']){
		assert.match(desktop,new RegExp(command));
		assert.match(browser,new RegExp(command));
		assert.match(app,new RegExp(command));
	}
});

test('Extensions use the ordinary selected-server Settings surface',()=>{
	assert.match(settings,/id: 'extensions'/);
	assert.match(settings,/ExtensionSettingsSection applicationClient=\{applicationClient\}/);
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
	assert.match(desktop,/openProjectEnvironmentsWindow\(event\.sender\)/);
});

test('remote project selection invokes the server and never falls back to Local',()=>{
	assert.match(app,/projectEnvironmentsClient\.createProject/);
	assert.doesNotMatch(app,/environment\.isThisServer[\s\S]{0,600}catch[\s\S]{0,300}addProject\(\)/);
});
