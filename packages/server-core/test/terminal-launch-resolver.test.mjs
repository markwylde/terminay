import test from "node:test";
import assert from "node:assert/strict";
import {
  TerminalLaunchResolver,
  TerminalService,
  TerminalServiceError,
} from "../dist/index.js";

function workspace(overrides = {}) {
  return {
    schemaVersion: 1,
    serverId: "server-a",
    revision: 7,
    cursor: "7",
    viewOrder: ["view-a"],
    views: { "view-a": { id: "view-a", serverId: "server-a", name: "Workspace", projectIds: ["project-a", "project-b"] } },
    projects: {
      "project-a": { id: "project-a", serverId: "server-a", viewId: "view-a", root: "/project", rootOrigin: "explicit", name: "Project", panelIds: [], layout: { kind: "stack", panelIds: [] }, ...overrides.project },
      "project-b": { id: "project-b", serverId: "server-a", viewId: "view-a", root: "/other", rootOrigin: "explicit", name: "Other", panelIds: [], layout: { kind: "stack", panelIds: [] } },
    },
    panels: overrides.panels ?? {},
    terminalSessions: {},
  };
}

function profile(id, overrides = {}) {
  return {
    id,
    name: id === "system" ? "System default" : id,
    target: { kind: "executable", executable: `/shell/${id}` },
    args: [],
    startupMode: "default",
    environment: {},
    kind: id === "system" ? "system" : "custom",
    readOnly: id === "system",
    source: id === "system" ? "system" : "custom",
    availability: { available: true },
    ...overrides,
  };
}

function profiles(entries, options = {}) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    catalogue: async () => ({
      settingsRevision: 11,
      defaultProfileId: options.defaultProfileId ?? "system",
      cwdPolicy: options.cwdPolicy ?? "current",
      entries,
      projectReferences: {},
    }),
    resolveProfile: async (id, catalogue) => {
      const selected = byId.get(id);
      if (selected === undefined) throw new Error("not found");
      if (!selected.availability.available) throw new Error("unavailable");
      const target = options.resolvedTargets?.[id] ?? (selected.target.kind === "wsl"
        ? { ...selected.target, executable: "C:\\Windows\\System32\\wsl.exe" }
        : selected.target);
      return { profile: selected, definition: selected, settingsRevision: catalogue.settingsRevision, target };
    },
  };
}

function paths(available = ["/project", "/other", "/home", "/live", "/explicit", "/"]) {
  const set = new Set(available);
  return {
    canonicalDirectory: async (value) => set.has(value) ? value : null,
    homeDirectory: async () => set.has("/home") ? "/home" : null,
    isRoot: (value) => value === "/",
  };
}

function resolver({ state = workspace(), entries = [profile("system")], catalogue = {}, observe, environmentCaseInsensitive = false, systemDefaultStartupMode } = {}) {
  return new TerminalLaunchResolver({
    serverId: "server-a",
    profiles: profiles(entries, catalogue),
    workspaceSnapshot: () => state,
    pathAuthority: paths(),
    defaultEnvironment: { BASE: "host", REMOVE: "host", TERMINAY_SERVER: "trusted" },
    observeTerminalCwd: observe,
    now: () => 123,
    environmentCaseInsensitive,
    systemDefaultStartupMode,
  });
}

function intent(overrides = {}) {
  return { identity: { serverId: "server-a", projectId: "project-a", sessionId: "session-a" }, cols: 80, rows: 24, ...overrides };
}

test("launch resolver selects explicit, project, server, then System profile and snapshots revisions", async () => {
  const entries = [profile("system"), profile("server"), profile("project"), profile("explicit")];
  const state = workspace({ project: { defaultShellProfileId: "project" } });
  const explicit = await resolver({ state, entries, catalogue: { defaultProfileId: "server" } }).resolve(intent({ explicitProfileId: "explicit" }));
  const projectDefault = await resolver({ state, entries, catalogue: { defaultProfileId: "server" } }).resolve(intent());
  const serverDefault = await resolver({ entries, catalogue: { defaultProfileId: "server" } }).resolve(intent());
  const systemDefault = await resolver({ entries }).resolve(intent());
  assert.deepEqual([explicit.profile.id, projectDefault.profile.id, serverDefault.profile.id, systemDefault.profile.id], ["explicit", "project", "server", "system"]);
  assert.deepEqual({ workspaceRevision: explicit.workspaceRevision, settingsRevision: explicit.settingsRevision, createdAt: explicit.createdAt }, { workspaceRevision: 7, settingsRevision: 11, createdAt: 123 });
});

test("launch resolver preserves argv boundaries, translates login mode, and layers profile environment", async () => {
  const selected = profile("zsh", {
    target: { kind: "executable", executable: "/bin/zsh" },
    startupMode: "login",
    args: ["--no-globalrcs", "two words"],
    environment: { BASE: "profile", REMOVE: null, ADDED: "$NOT_EXPANDED" },
  });
  const launch = await resolver({ entries: [profile("system"), selected] }).resolve(intent({ explicitProfileId: "zsh" }));
  assert.equal(launch.shellPath, "/bin/zsh");
  assert.deepEqual(launch.args, ["-l", "--no-globalrcs", "two words"]);
  assert.deepEqual(launch.env, { BASE: "profile", TERMINAY_SERVER: "trusted", ADDED: "$NOT_EXPANDED" });
});

test("host policy launches only the reserved System default as a login shell", async () => {
  const system = profile("system", {
    target: { kind: "system" },
  });
  const custom = profile("custom", {
    target: { kind: "executable", executable: "/bin/zsh" },
  });
  const catalogue = {
    resolvedTargets: {
      system: { kind: "executable", executable: "/bin/zsh" },
    },
  };
  const options = { entries: [system, custom], catalogue, systemDefaultStartupMode: "login" };

  const systemLaunch = await resolver(options).resolve(intent());
  const customLaunch = await resolver(options).resolve(intent({ explicitProfileId: "custom" }));

  assert.deepEqual(systemLaunch.args, ["-l"]);
  assert.deepEqual(customLaunch.args, []);
});

test("launch resolver supports login and non-login startup modes for POSIX sh implementations", async () => {
  const dash = profile("dash", {
    target: { kind: "executable", executable: "/usr/bin/dash" },
    startupMode: "login",
  });
  const sh = profile("sh", {
    target: { kind: "executable", executable: "/bin/sh" },
    startupMode: "non-login",
    args: ["-i"],
  });
  const entries = [profile("system"), dash, sh];

  const login = await resolver({ entries }).resolve(intent({ explicitProfileId: "dash" }));
  const nonLogin = await resolver({
    entries,
    catalogue: { resolvedTargets: { sh: { kind: "executable", executable: "/usr/bin/dash" } } },
  }).resolve(intent({ explicitProfileId: "sh" }));

  assert.deepEqual(login.args, ["-l"]);
  assert.deepEqual(nonLogin.args, ["-i"]);
});

test("Windows environment layering is case-insensitive and protected aliases are rejected", async () => {
  const selected = profile("windows", { environment: { base: "profile" } });
  const launch = await resolver({ entries: [profile("system"), selected], environmentCaseInsensitive: true }).resolve(intent({ explicitProfileId: "windows" }));
  assert.equal(launch.env.base, "profile");
  assert.equal("BASE" in launch.env, false);
  const protectedProfile = profile("bad", { environment: { TERM: "spoofed" } });
  await assert.rejects(
    resolver({ entries: [profile("system"), protectedProfile] }).resolve(intent({ explicitProfileId: "bad" })),
    (error) => error instanceof TerminalServiceError && error.code === "invalid_environment",
  );
});

test("WSL launch keeps distribution structured, requires an explicit shell for args, and generates WSLENV", async () => {
  const wsl = profile("wsl-zsh", {
    target: { kind: "wsl", distribution: "Ubuntu Dev", shellPath: "/bin/zsh" },
    startupMode: "login",
    args: ["--no-rcs"],
    environment: { DEV_MODE: "1" },
  });
  const launch = await resolver({ entries: [profile("system"), wsl] }).resolve(intent({ explicitProfileId: "wsl-zsh" }));
  assert.equal(launch.shellPath, "C:\\Windows\\System32\\wsl.exe");
  assert.deepEqual(launch.args, ["--distribution", "Ubuntu Dev", "--exec", "/bin/zsh", "-l", "--no-rcs"]);
  assert.equal(launch.env.WSLENV, "DEV_MODE");
  const missingShell = profile("wsl-default", { target: { kind: "wsl", distribution: "Ubuntu Dev" }, args: ["--login"] });
  await assert.rejects(
    resolver({ entries: [profile("system"), missingShell] }).resolve(intent({ explicitProfileId: "wsl-default" })),
    (error) => error instanceof TerminalServiceError && error.code === "unsupported_startup_mode",
  );
});

test("current cwd uses same-project observed cwd, stale cwd falls back, and cross-project panel intent is forbidden", async () => {
  const terminalPanel = { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "old-session", cwd: "/stale", createdAt: 1 };
  const otherPanel = { ...terminalPanel, id: "panel-b", projectId: "project-b" };
  const state = workspace({ panels: { "panel-a": terminalPanel, "panel-b": otherPanel } });
  assert.equal((await resolver({ state, observe: async () => "/live" }).resolve(intent({ activePanelId: "panel-a" }))).cwd, "/live");
  assert.equal((await resolver({ state, observe: async () => "/missing" }).resolve(intent({ activePanelId: "panel-a" }))).cwd, "/project");
  await assert.rejects(
    resolver({ state, observe: async () => "/live" }).resolve(intent({ activePanelId: "panel-b" })),
    (error) => error instanceof TerminalServiceError && error.code === "forbidden",
  );
});

test("explicit and project roots remain valid while observed or home roots are never implicit fallbacks", async () => {
  assert.equal((await resolver().resolve(intent({ explicitCwd: "/" }))).cwd, "/");
  assert.equal((await resolver({ state: workspace({ project: { root: "/" } }) }).resolve(intent())).cwd, "/");
  const panel = { id: "panel-a", projectId: "project-a", type: "terminal", sessionId: "old", cwd: "/", createdAt: 1 };
  assert.equal((await resolver({ state: workspace({ panels: { "panel-a": panel } }), observe: async () => "/" }).resolve(intent({ activePanelId: "panel-a" }))).cwd, "/project");
  const unsafeHome = new TerminalLaunchResolver({
    serverId: "server-a", profiles: profiles([profile("system")], { cwdPolicy: "home" }), workspaceSnapshot: () => workspace(),
    pathAuthority: { canonicalDirectory: async (value) => value, homeDirectory: async () => "/", isRoot: (value) => value === "/" },
  });
  await assert.rejects(unsafeHome.resolve(intent()), (error) => error instanceof TerminalServiceError && error.code === "unsafe_cwd");
});

test("unverified legacy filesystem roots fail until the project root is explicitly confirmed", async () => {
  await assert.rejects(
    resolver({ state: workspace({ project: { root: "/", rootOrigin: "legacy-unverified" } }) }).resolve(intent()),
    (error) => error instanceof TerminalServiceError && error.code === "unsafe_legacy_root",
  );
});

test("missing explicit cwd and missing project root have distinct bounded failures", async () => {
  await assert.rejects(resolver().resolve(intent({ explicitCwd: "/missing" })), (error) => error instanceof TerminalServiceError && error.code === "invalid_cwd");
  await assert.rejects(resolver({ state: workspace({ project: { root: "/missing" } }) }).resolve(intent()), (error) => error instanceof TerminalServiceError && error.code === "missing_project_root");
});

test("resolved spawn failure leaves no session and exposes no provider output", async () => {
  const service = new TerminalService({ serverId: "server-a", ptyFactory: { spawn() { throw new Error("provider secret output"); } } });
  const launch = await resolver().resolve(intent());
  await assert.rejects(service.createResolvedSession(launch), (error) => error instanceof TerminalServiceError && error.code === "spawn_failed" && !error.message.includes("provider secret"));
  assert.equal(service.size, 0);
});
