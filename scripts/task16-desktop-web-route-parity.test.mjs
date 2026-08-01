import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopWorkspaceRouteRenderModel } from "../apps/terminay-desktop/dist/renderer/index.js";
import { createWebWorkspaceRouteRenderModel } from "../apps/terminay-web/dist/index.js";

const ROUTES = Object.freeze([
  "workspace",
  "connections",
  "settings",
  "recordings",
  "macros",
  "file",
  "git",
]);

test("Desktop-wide and browser hosts consume the same complete shared route component contracts", () => {
  for (const route of ROUTES) {
    const desktop = createDesktopWorkspaceRouteRenderModel(route);
    const browser = createWebWorkspaceRouteRenderModel(route);

    assert.deepEqual(desktop.component, browser.component, `${route} component parity`);
    assert.equal(desktop.component.id, `shared.route.${route}`);
    assert.equal(desktop.component.landmark, "main");
    assert.ok(desktop.component.regions.length > 0, `${route} exposes semantic regions`);
    assert.equal(new Set(desktop.component.regions).size, desktop.component.regions.length, `${route} regions are unique`);
    assert.equal(Object.isFrozen(desktop.component), true);
    assert.equal(Object.isFrozen(desktop.component.regions), true);
    assert.equal(browser.presentation, "in-page", `${route} remains in-page in the browser`);
  }
});

test("terminal, file, Git, agent, and settings regions cannot drift between Desktop and mobile-browser route models", () => {
  const desktopWorkspace = createDesktopWorkspaceRouteRenderModel("workspace");
  const browserWorkspace = createWebWorkspaceRouteRenderModel("workspace");
  for (const region of ["terminal", "file", "folder", "git", "agents"]) {
    assert.equal(desktopWorkspace.component.regions.includes(region), true, `Desktop workspace includes ${region}`);
    assert.equal(browserWorkspace.component.regions.includes(region), true, `browser workspace includes ${region}`);
  }

  const desktopSettings = createDesktopWorkspaceRouteRenderModel("settings");
  const browserSettings = createWebWorkspaceRouteRenderModel("settings");
  assert.deepEqual(desktopSettings.component.regions, ["settings-sections", "settings-editor"]);
  assert.deepEqual(browserSettings.component.regions, desktopSettings.component.regions);
  assert.equal(desktopSettings.presentation, "native-auxiliary");
  assert.equal(browserSettings.presentation, "in-page");
});
