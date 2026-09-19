import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAutoExpandDocumentationPane } from './documentationAutoExpand.ts';

test('the first visit in a session expands a collapsed pane', () => {
	const visited = new Set<string>();
	assert.equal(
		shouldAutoExpandDocumentationPane('project-a', true, visited),
		true,
	);
});

test('a visit after a manual collapse in the same session leaves it collapsed', () => {
	const visited = new Set<string>();
	shouldAutoExpandDocumentationPane('project-a', true, visited);
	assert.equal(
		shouldAutoExpandDocumentationPane('project-a', true, visited),
		false,
	);
});

test('a pane already expanded on first visit is left alone and still marked visited', () => {
	const visited = new Set<string>();
	assert.equal(
		shouldAutoExpandDocumentationPane('project-a', false, visited),
		false,
	);
	assert.equal(
		shouldAutoExpandDocumentationPane('project-a', true, visited),
		false,
	);
});

test('each project is expanded once, and a fresh session expands again', () => {
	const session = new Set<string>();
	assert.equal(shouldAutoExpandDocumentationPane('project-a', true, session), true);
	assert.equal(shouldAutoExpandDocumentationPane('project-b', true, session), true);
	const nextSession = new Set<string>();
	assert.equal(
		shouldAutoExpandDocumentationPane('project-a', true, nextSession),
		true,
	);
});
