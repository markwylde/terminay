"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/workspace/TerminalActivityOverview.tsx
var TerminalActivityOverview_exports = {};
__export(TerminalActivityOverview_exports, {
  CompactNotifications: () => CompactNotifications,
  TerminalActivityOverview: () => TerminalActivityOverview,
  buildTerminalActivityOverview: () => buildTerminalActivityOverview,
  notificationsButtonLabel: () => notificationsButtonLabel,
  terminalOverviewStateToAgentState: () => terminalOverviewStateToAgentState
});
module.exports = __toCommonJS(TerminalActivityOverview_exports);

// node_modules/lucide-react/dist/esm/createLucideIcon.mjs
var import_react3 = require("react");

// node_modules/lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs
var toKebabCase = (string) => string?.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

// node_modules/lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs
function toLucideIconData(iconName, iconNode, aliases = []) {
  if (iconNode == null) {
    throw new Error("[lucide]: iconNode is required when icon name is used");
  }
  return {
    name: toKebabCase(iconName),
    size: 24,
    node: iconNode,
    ...aliases.length > 0 ? { aliases } : {}
  };
}

// node_modules/lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs
var toCamelCase = (string) => {
  let out = "";
  let upperNext = false;
  for (const ch of string) {
    if (ch === "-" || ch === "_" || ch <= " ") {
      upperNext = out.length > 0;
      continue;
    }
    if (out.length === 0) {
      out += ch.toLowerCase();
    } else {
      out += upperNext ? ch.toUpperCase() : ch;
    }
    upperNext = false;
  }
  return out;
};

// node_modules/lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs
var toPascalCase = (string) => {
  const camelCase = toCamelCase(string);
  return camelCase.charAt(0).toUpperCase() + camelCase.slice(1);
};

// node_modules/lucide-react/dist/esm/Icon.mjs
var import_react2 = require("react");

// node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs
var mergeClasses = (...classes) => classes.filter((className, index, array) => {
  return Boolean(className) && className.trim() !== "" && array.indexOf(className) === index;
}).join(" ").trim();

// node_modules/lucide-react/dist/esm/shared/src/build/defaultAttributes.mjs
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};

// node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs
function isDefined(value) {
  return value !== null && value !== void 0;
}
function buildLucideIconNode(icon, params = {}) {
  const attributeNames = params.attributeNames ?? {};
  const getAttributeName = (attributeName) => attributeNames[attributeName] ?? attributeName;
  const viewBoxWidth = icon.size ?? icon.width ?? defaultAttributes["width"];
  const viewBoxHeight = icon.size ?? icon.height ?? defaultAttributes["height"];
  const aliasClassNames = icon.aliases?.filter((alias) => typeof alias === "string" && alias.trim() !== "").map((alias) => `lucide-${alias}`) ?? [];
  const iconClassNames = [...icon.name ? [`lucide-${icon.name}`] : [], ...aliasClassNames];
  const classNamesFromClassName = params.className?.split(" ").filter(Boolean) ?? [];
  const className = params.includeDefaultClasses === false ? mergeClasses(...classNamesFromClassName) : mergeClasses("lucide", ...iconClassNames, ...classNamesFromClassName);
  const calculatedStrokeWidth = params.absoluteStrokeWidth ? Number(params.strokeWidth ?? defaultAttributes["stroke-width"]) * Number(icon.size ?? icon.width ?? defaultAttributes["width"]) / Number(params.size ?? params.width ?? defaultAttributes["width"]) : params.strokeWidth ?? defaultAttributes["stroke-width"];
  const attributes = {
    ...Object.entries(defaultAttributes).reduce((attrs, [attrName, value]) => {
      attrs[getAttributeName(attrName)] = value;
      return attrs;
    }, {}),
    ..."color" in params && params.color && {
      [getAttributeName("stroke")]: params.color
    },
    ..."size" in params && isDefined(params.size) && {
      [getAttributeName("width")]: params.size,
      [getAttributeName("height")]: params.size
    },
    ..."width" in params && isDefined(params.width) && {
      [getAttributeName("width")]: params.width
    },
    ..."height" in params && isDefined(params.height) && {
      [getAttributeName("height")]: params.height
    },
    [getAttributeName("stroke-width")]: calculatedStrokeWidth,
    ...className && {
      [getAttributeName("class")]: className
    },
    [getAttributeName("viewBox")]: `0 0 ${viewBoxWidth} ${viewBoxHeight}`,
    ...params.hasA11yProp === false ? {
      [getAttributeName("aria-hidden")]: "true"
    } : {},
    ..."attributes" in params && params.attributes
  };
  return [
    "svg",
    attributes,
    icon.node.map((child) => {
      const [name, attrs, children] = child;
      const nextAttrs = params.nonScalingStroke ? { [getAttributeName("vector-effect")]: "non-scaling-stroke", ...attrs } : attrs;
      return children ? [name, nextAttrs, children] : [name, nextAttrs];
    })
  ];
}

// node_modules/lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs
function buildLucideIconForReact(icon, params = {}) {
  return buildLucideIconNode(icon, {
    ...params,
    attributeNames: {
      ...params.attributeNames,
      class: "className",
      "stroke-width": "strokeWidth",
      "stroke-linecap": "strokeLinecap",
      "stroke-linejoin": "strokeLinejoin",
      "vector-effect": "vectorEffect"
    }
  });
}

// node_modules/lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs
var hasA11yProp = (props) => {
  for (const prop in props) {
    if (prop.startsWith("aria-") || prop === "role" || prop === "title") {
      return true;
    }
  }
  return false;
};

// node_modules/lucide-react/dist/esm/context.mjs
var import_react = require("react");
var LucideContext = (0, import_react.createContext)({});
var useLucideContext = () => (0, import_react.useContext)(LucideContext);

// node_modules/lucide-react/dist/esm/Icon.mjs
var Icon = (0, import_react2.forwardRef)(
  ({
    color,
    size,
    width,
    height,
    strokeWidth,
    absoluteStrokeWidth,
    nonScalingStroke,
    className = "",
    children,
    iconNode = [],
    icon = {
      node: iconNode,
      aliases: [],
      size: 24
    },
    ...rest
  }, ref) => {
    const {
      size: contextSize = 24,
      strokeWidth: contextStrokeWidth = 2,
      absoluteStrokeWidth: contextAbsoluteStrokeWidth = false,
      nonScalingStroke: contextNonScalingStroke = false,
      color: contextColor = "currentColor",
      className: contextClass = ""
    } = useLucideContext() ?? {};
    const hasAccessibleProp = Boolean(children) || hasA11yProp(rest);
    const [name, svgAttributes, builtIconNode = []] = buildLucideIconForReact(icon, {
      color: color ?? contextColor,
      width: width ?? size ?? contextSize,
      height: height ?? size ?? contextSize,
      strokeWidth: strokeWidth ?? contextStrokeWidth,
      absoluteStrokeWidth: absoluteStrokeWidth ?? contextAbsoluteStrokeWidth,
      nonScalingStroke: nonScalingStroke ?? contextNonScalingStroke,
      className: mergeClasses(contextClass, className),
      hasA11yProp: hasAccessibleProp,
      attributes: rest
    });
    return (0, import_react2.createElement)(
      name,
      {
        ref,
        ...svgAttributes
      },
      [
        ...builtIconNode.map(([tag, attrs]) => (0, import_react2.createElement)(tag, attrs)),
        ...Array.isArray(children) ? children : [children]
      ]
    );
  }
);

// node_modules/lucide-react/dist/esm/createLucideIcon.mjs
function createLucideIcon(iconDataOrName, iconNode = [], aliases = []) {
  const iconData = typeof iconDataOrName === "string" ? toLucideIconData(iconDataOrName, iconNode, aliases) : iconDataOrName;
  const Component = (0, import_react3.forwardRef)(
    ({ className, ...props }, ref) => (0, import_react3.createElement)(Icon, {
      ref,
      icon: iconData,
      className,
      ...props
    })
  );
  if (iconData.name) {
    Component.displayName = toPascalCase(iconData.name);
  }
  return Component;
}

// node_modules/lucide-react/dist/esm/icons/bell.mjs
var __iconData = {
  name: "bell",
  size: 24,
  node: [
    ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0", key: "vwvbt9" }],
    [
      "path",
      {
        d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
        key: "11g9vi"
      }
    ]
  ]
};
__iconData.node;
var Bell = createLucideIcon(__iconData);

// node_modules/lucide-react/dist/esm/icons/circle-check.mjs
var __iconData2 = {
  name: "circle-check",
  size: 24,
  node: [
    ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
    ["path", { d: "m16 9-5.5 5.5L8 12", key: "xofnsj" }]
  ],
  aliases: ["check-circle-2"]
};
__iconData2.node;
var CircleCheck = createLucideIcon(__iconData2);

// node_modules/lucide-react/dist/esm/icons/circle-exclamation-point.mjs
var __iconData3 = {
  name: "circle-exclamation-point",
  size: 24,
  node: [
    ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
    ["line", { x1: "12", x2: "12", y1: "8", y2: "12", key: "1pkeuh" }],
    ["line", { x1: "12", x2: "12.01", y1: "16", y2: "16", key: "4dfq90" }]
  ],
  aliases: ["alert-circle", "circle-alert"]
};
__iconData3.node;
var CircleExclamationPoint = createLucideIcon(__iconData3);

// node_modules/lucide-react/dist/esm/icons/x.mjs
var __iconData4 = {
  name: "x",
  size: 24,
  node: [
    ["path", { d: "M18 6 6 18", key: "1bl5f8" }],
    ["path", { d: "m6 6 12 12", key: "d8bk6v" }]
  ]
};
__iconData4.node;
var X = createLucideIcon(__iconData4);

// src/workspace/TerminalActivityOverview.tsx
var import_react5 = require("react");

// src/components/AgentStatusIndicator.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STATE_LABELS = {
  working: "Agent working",
  waiting: "Agent waiting for input",
  blocked: "Agent blocked",
  done: "Agent done",
  idle: "Agent idle"
};
function getAgentStatusLabel(state, needsAttention = false) {
  return needsAttention && state !== "waiting" && state !== "blocked" ? "Agent needs attention" : STATE_LABELS[state];
}
function AgentStatusIndicator({
  state,
  needsAttention = false,
  showIdle = false,
  size = "small",
  className,
  label
}) {
  if (state === "idle" && !needsAttention && !showIdle) {
    return null;
  }
  const visualState = needsAttention ? "attention" : state;
  const classes = [
    "agent-status-indicator",
    `agent-status-indicator--${visualState}`,
    `agent-status-indicator--${size}`,
    className
  ].filter(Boolean).join(" ");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "span",
    {
      className: classes,
      "data-agent-state": state,
      "data-needs-attention": needsAttention || void 0,
      role: "img",
      "aria-label": label ?? getAgentStatusLabel(state, needsAttention),
      title: label ?? getAgentStatusLabel(state, needsAttention),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "agent-status-indicator__glyph", "aria-hidden": "true" })
    }
  );
}

// src/shared/useWorkspaceProjection.ts
var import_react4 = require("react");
var unsubscribed = () => void 0;
var NO_PROJECT_SLICE = Object.freeze({
  project: void 0,
  folders: Object.freeze([]),
  panels: Object.freeze([])
});
function useTerminalTitle(store, panelId, fallback) {
  const subscribe = (0, import_react4.useCallback)(
    (notify) => store === void 0 || panelId === void 0 ? unsubscribed : store.subscribe(panelId, notify),
    [store, panelId]
  );
  const read = () => (panelId === void 0 ? void 0 : store?.title(panelId)) ?? fallback;
  return (0, import_react4.useSyncExternalStore)(subscribe, read, read);
}
var TerminalTitleStoreContext = (0, import_react4.createContext)(void 0);
function useLiveTerminalTitle(panelId, fallback) {
  return useTerminalTitle(
    (0, import_react4.useContext)(TerminalTitleStoreContext),
    panelId,
    fallback
  );
}
function LiveTerminalTitle({
  panelId,
  fallback
}) {
  return useLiveTerminalTitle(panelId, fallback) ?? fallback;
}

// src/workspace/activityCountBadge.ts
var ACTIVITY_COUNT_BADGE_MAX = 99;
function formatActivityCount(count) {
  if (!Number.isFinite(count) || count <= 0) return "0";
  if (count > ACTIVITY_COUNT_BADGE_MAX) return `${ACTIVITY_COUNT_BADGE_MAX}+`;
  return String(Math.floor(count));
}
function activityCountDigits(label) {
  if (label.length <= 1) return 1;
  if (label.length === 2) return 2;
  return 3;
}

// src/workspace/activityStates.ts
function terminalOverviewStateToAgentState(state) {
  if (state === "recent") return "working";
  if (state === "unviewed") return "done";
  if (state === "attention") return "blocked";
  return state;
}

// src/workspace/bots/botsModel.ts
function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.map((word) => [...word][0] ?? "").join("");
  return (letters || "?").slice(0, 2).toUpperCase();
}
var BOT_CHAT_IMAGE_BYTES = 2 * 1024 * 1024;

// src/workspace/bots/BotAvatar.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var ACTIVITY_DOT = {
  idle: "var(--bots-done-dot)",
  "needs-you": "var(--bots-need-dot)",
  queued: "var(--bots-start)",
  stopped: "var(--bots-idle-dot)",
  working: "var(--bots-work-dot)"
};
function BotAvatar({
  bot,
  activity,
  size = "md"
}) {
  const picture = /^data:image\/(png|jpeg|webp|gif);base64,/.test(bot.avatar) ? bot.avatar : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "span",
    {
      className: `bots-avatar bots-avatar--${size}`,
      style: { background: bot.colour || "#7cc4f5" },
      "aria-hidden": "true",
      children: [
        picture === void 0 ? bot.avatar.trim() || initials(bot.name) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: picture, alt: "" }),
        activity === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("i", { style: { background: ACTIVITY_DOT[activity] } })
      ]
    }
  );
}

// src/workspace/notificationText.ts
var AGENT_HEADLINES = {
  blocked: "Agent is blocked",
  done: "Agent finished",
  waiting: "Agent is waiting for you"
};
var TERMINAL_HEADLINES = {
  blocked: "Terminal needs attention",
  done: "Command finished",
  waiting: "Terminal needs attention"
};
function notificationHeadline(state, isAgentStatus) {
  return (isAgentStatus ? AGENT_HEADLINES : TERMINAL_HEADLINES)[state];
}
function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}
function formatNotificationAge(since, now) {
  if (since === void 0 || !Number.isFinite(since)) return null;
  const seconds = Math.max(0, Math.floor((now - since) / 1e3));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return plural(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

// src/workspace/publishedNotifications.ts
function botNotificationHeadline(count) {
  return count <= 1 ? "New message" : `${count} new messages`;
}

// src/workspace/serverUpgradeNotifications.ts
var SERVER_UPGRADE_NOTIFICATION_SOURCE = "Server upgrade";

// src/workspace/TerminalActivityOverview.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function buildTerminalActivityOverview(items) {
  const priority = (state) => {
    const canonical = terminalOverviewStateToAgentState(state);
    if (canonical === "blocked" || canonical === "waiting") return 0;
    if (canonical === "working") return 1;
    return 2;
  };
  const sortedItems = [...items].sort(
    (a, b) => priority(a.state) - priority(b.state) || // Newest first, so the list reads like a feed.
    (b.since ?? 0) - (a.since ?? 0) || a.projectTitle.localeCompare(b.projectTitle) || a.title.localeCompare(b.title)
  );
  const isWorking = (item) => terminalOverviewStateToAgentState(item.state) === "working";
  const notifications = sortedItems.filter((item) => !isWorking(item));
  return {
    items: sortedItems,
    notifications,
    notificationCount: notifications.length
  };
}
function notificationsButtonLabel(count) {
  if (count <= 0) return "Notifications";
  return `Notifications, ${count} ${count === 1 ? "notification" : "notifications"}`;
}
function ActivityRows({
  items,
  now,
  onActivate,
  onDismiss
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_jsx_runtime3.Fragment, { children: items.map((item) => {
    const state = terminalOverviewStateToAgentState(item.state);
    if (state === "working") return null;
    const age = formatNotificationAge(item.since, now);
    const upgrade = item.serverUpgrade;
    if (upgrade !== void 0)
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "div",
        {
          className: "terminal-activity-menu__row",
          "data-server-upgrade-notice": upgrade.tone,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "div",
              {
                className: "terminal-activity-menu__item terminal-activity-menu__item--static",
                role: upgrade.tone === "failure" ? "alert" : "status",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    "span",
                    {
                      className: `terminal-activity-menu__upgrade-icon terminal-activity-menu__upgrade-icon--${upgrade.tone}`,
                      "aria-hidden": "true",
                      children: upgrade.tone === "failure" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CircleExclamationPoint, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(CircleCheck, { size: 14 })
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__text", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__title terminal-activity-menu__title--wrap", children: upgrade.text }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__source", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__terminal", children: SERVER_UPGRADE_NOTIFICATION_SOURCE }) }),
                    age === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__age", children: age })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "terminal-activity-menu__dismiss",
                onClick: () => onDismiss(item),
                "aria-label": "Dismiss",
                title: "Dismiss",
                children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(X, { size: 12, "aria-hidden": "true" })
              }
            )
          ]
        },
        `server-upgrade:${upgrade.id}`
      );
    const bot = item.bot;
    if (bot !== void 0)
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "div",
        {
          className: "terminal-activity-menu__row",
          "data-notification-bot": bot.botId,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
              "button",
              {
                type: "button",
                className: "terminal-activity-menu__item",
                onClick: () => onActivate(item),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                    BotAvatar,
                    {
                      bot: {
                        name: bot.name,
                        avatar: bot.avatar,
                        colour: bot.colour
                      },
                      size: "sm"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__text", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__title", children: botNotificationHeadline(bot.count) }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__body terminal-activity-menu__body--excerpt", children: bot.excerpt }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__source", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__terminal", children: bot.name }) }),
                    age === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__age", children: age })
                  ] })
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "button",
              {
                type: "button",
                className: "terminal-activity-menu__dismiss",
                onClick: () => onDismiss(item),
                "aria-label": `Dismiss ${bot.name}`,
                title: "Dismiss",
                children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(X, { size: 12, "aria-hidden": "true" })
              }
            )
          ]
        },
        `bot:${bot.serverId}:${bot.botId}:${item.notificationId ?? ""}`
      );
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      "div",
      {
        className: "terminal-activity-menu__row",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
            "button",
            {
              type: "button",
              className: "terminal-activity-menu__item",
              onClick: () => onActivate(item),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  AgentStatusIndicator,
                  {
                    state,
                    label: item.isAgentStatus ? void 0 : `Terminal ${state}`
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__text", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__title", children: item.sent === void 0 ? notificationHeadline(state, item.isAgentStatus) : item.sent.title ?? item.sent.body }),
                  item.sent?.title === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__body", children: item.sent.body }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__source", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__terminal", children: [
                      item.emoji ? `${item.emoji} ` : "",
                      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                        LiveTerminalTitle,
                        {
                          panelId: item.panelId,
                          fallback: item.title
                        }
                      )
                    ] }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "terminal-activity-menu__project", children: [
                      item.projectEmoji ? `${item.projectEmoji} ` : "",
                      item.projectTitle
                    ] })
                  ] }),
                  age === null ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__age", children: age })
                ] })
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: "terminal-activity-menu__dismiss",
              onClick: () => onDismiss(item),
              "aria-label": `Dismiss ${item.title}`,
              title: "Dismiss",
              children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(X, { size: 12, "aria-hidden": "true" })
            }
          )
        ]
      },
      `${item.projectId}:${item.panelId}:${item.sessionId}:${item.notificationId ?? ""}`
    );
  }) });
}
function TerminalActivityOverview({
  activityMenuRef,
  isOpen,
  notifications,
  onActivate,
  onDismiss,
  onDismissAll,
  onToggle
}) {
  const count = notifications.length;
  const now = Date.now();
  const countLabel = formatActivityCount(count);
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      ref: activityMenuRef,
      className: `terminal-activity-status${isOpen ? " terminal-activity-status--open" : ""}`,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "button",
          {
            type: "button",
            className: "terminal-activity-button",
            onClick: onToggle,
            title: "Notifications",
            "aria-label": notificationsButtonLabel(count),
            "aria-haspopup": "menu",
            "aria-expanded": isOpen,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Bell, { size: 15, "aria-hidden": "true" }),
              count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "span",
                {
                  className: "notifications-count",
                  "data-digits": activityCountDigits(countLabel),
                  "aria-hidden": "true",
                  children: countLabel
                }
              ) : null
            ]
          }
        ),
        isOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "div",
          {
            className: "terminal-activity-menu",
            role: "menu",
            "aria-label": "Notifications",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "terminal-activity-menu__header", children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "terminal-activity-menu__section-label", children: "Notifications" }),
                count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                  "button",
                  {
                    type: "button",
                    className: "terminal-activity-menu__clear-all",
                    onClick: onDismissAll,
                    children: "Clear all"
                  }
                ) : null
              ] }),
              count === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "terminal-activity-menu__empty", children: "No notifications" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                ActivityRows,
                {
                  items: notifications,
                  now,
                  onActivate,
                  onDismiss
                }
              )
            ]
          }
        ) : null
      ]
    }
  );
}
function CompactNotifications({
  notifications,
  onActivate,
  onDismiss,
  onDismissAll,
  onClose
}) {
  (0, import_react5.useEffect)(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);
  const count = notifications.length;
  const now = Date.now();
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "div",
    {
      className: "compact-switcher-scrim",
      "data-compact-notifications": "true",
      onPointerDown: (event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "div",
        {
          className: "compact-switcher compact-notifications",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Notifications",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "compact-notifications__header", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "compact-switcher__grab", "aria-hidden": "true" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "compact-notifications__title", children: "Notifications" }),
              count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "button",
                {
                  type: "button",
                  className: "compact-notifications__clear-all",
                  onClick: onDismissAll,
                  children: "Clear all"
                }
              ) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "compact-notifications__body", children: count === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "compact-notifications__empty", role: "status", children: "No notifications" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              ActivityRows,
              {
                items: notifications,
                now,
                onActivate,
                onDismiss
              }
            ) })
          ]
        }
      )
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CompactNotifications,
  TerminalActivityOverview,
  buildTerminalActivityOverview,
  notificationsButtonLabel,
  terminalOverviewStateToAgentState
});
/*! Bundled license information:

lucide-react/dist/esm/shared/src/utils/toKebabCase.mjs:
lucide-react/dist/esm/shared/src/utils/toLucideIconData.mjs:
lucide-react/dist/esm/shared/src/utils/toCamelCase.mjs:
lucide-react/dist/esm/shared/src/utils/toPascalCase.mjs:
lucide-react/dist/esm/shared/src/utils/mergeClasses.mjs:
lucide-react/dist/esm/shared/src/build/defaultAttributes.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconNode.mjs:
lucide-react/dist/esm/shared/src/build/buildLucideIconForReact.mjs:
lucide-react/dist/esm/shared/src/utils/hasA11yProp.mjs:
lucide-react/dist/esm/context.mjs:
lucide-react/dist/esm/Icon.mjs:
lucide-react/dist/esm/createLucideIcon.mjs:
lucide-react/dist/esm/icons/bell.mjs:
lucide-react/dist/esm/icons/circle-check.mjs:
lucide-react/dist/esm/icons/circle-exclamation-point.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.72.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
