import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const split=await readFile(new URL('../src/projectEnvironments/ProjectEnvironmentSplitButton.tsx',import.meta.url),'utf8');
const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
const desktop=await readFile(new URL('../electron/main.ts',import.meta.url),'utf8');
const browser=await readFile(new URL('../src/web/ConnectedWebRendererWorkspace.tsx',import.meta.url),'utf8');

test('split button keeps primary This server and a separate accessible chooser',()=>{
	assert.match(split,/aria-label="Create project on This server"/);
	assert.match(split,/aria-haspopup="menu"/);
	assert.match(split,/ArrowDown/);
	assert.match(split,/ArrowUp/);
	assert.match(split,/Escape/);
	assert.match(split,/No matching environments/);
});

test('Desktop and browser File menus converge on shared management commands',()=>{
	for(const command of ['open-project-environments','open-extensions']){
		assert.match(desktop,new RegExp(command));
		assert.match(browser,new RegExp(command));
		assert.match(app,new RegExp(command));
	}
});

test('remote project selection invokes the server and never falls back to Local',()=>{
	assert.match(app,/projectEnvironmentsClient\.createProject/);
	assert.doesNotMatch(app,/environment\.isThisServer[\s\S]{0,600}catch[\s\S]{0,300}addProject\(\)/);
});
