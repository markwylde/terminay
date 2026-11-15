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

// src/workspace/ServerUpgradeMenuRows.tsx
var ServerUpgradeMenuRows_exports = {};
__export(ServerUpgradeMenuRows_exports, {
  ServerUpgradeCheck: () => ServerUpgradeCheck,
  ServerUpgradeCommand: () => ServerUpgradeCommand,
  ServerUpgradeMenuRows: () => ServerUpgradeMenuRows
});
module.exports = __toCommonJS(ServerUpgradeMenuRows_exports);

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

// node_modules/lucide-react/dist/esm/icons/refresh-cw.mjs
var __iconData = {
  name: "refresh-cw",
  size: 24,
  node: [
    ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", key: "v9h5vc" }],
    ["path", { d: "M21 3v5h-5", key: "1q7to0" }],
    ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", key: "3uifl3" }],
    ["path", { d: "M8 16H3v5", key: "1cv678" }]
  ]
};
__iconData.node;
var RefreshCw = createLucideIcon(__iconData);

// node_modules/lucide-react/dist/esm/icons/triangle-exclamation-point.mjs
var __iconData2 = {
  name: "triangle-exclamation-point",
  size: 24,
  node: [
    [
      "path",
      {
        d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
        key: "wmoenq"
      }
    ],
    ["path", { d: "M12 9v4", key: "juzpu7" }],
    ["path", { d: "M12 17h.01", key: "p32p05" }]
  ],
  aliases: ["alert-triangle", "triangle-alert"]
};
__iconData2.node;
var TriangleExclamationPoint = createLucideIcon(__iconData2);

// src/workspace/ServerUpgradeMenuRows.tsx
var import_react4 = require("react");

// src/host/nativeActions.ts
function bridge() {
  if (typeof window === "undefined") return void 0;
  return window.terminayHost;
}
async function request(action) {
  const host = bridge();
  if (host === void 0) return { handled: false };
  const context = await host.getContext();
  const result = await host.requestAction({
    schemaVersion: 1,
    bridgeVersion: 1,
    sourceId: context.sourceId,
    windowId: context.windowId,
    profileId: context.profileId,
    serverId: context.serverId,
    userGesture: true,
    action
  });
  return { handled: true, result };
}
async function writeClipboardText(text) {
  if (bridge() === void 0) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if ((await request({ type: "clipboard.write", text })).handled) return;
  await navigator.clipboard.writeText(text);
}

// src/workspace/ServerUpgradeMenuRows.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function ServerUpgradeCommand({
  command
}) {
  const [copied, setCopied] = (0, import_react4.useState)(false);
  const [failed, setFailed] = (0, import_react4.useState)(false);
  const reset = (0, import_react4.useRef)(void 0);
  (0, import_react4.useEffect)(() => () => clearTimeout(reset.current), []);
  (0, import_react4.useEffect)(() => {
    clearTimeout(reset.current);
    setCopied(false);
    setFailed(false);
  }, [command]);
  const copy = () => {
    clearTimeout(reset.current);
    void writeClipboardText(command).then(
      () => {
        setFailed(false);
        setCopied(true);
        reset.current = setTimeout(() => setCopied(false), 2e3);
      },
      () => {
        setCopied(false);
        setFailed(true);
      }
    );
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "server-upgrade-row__command", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: command }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "server-upgrade-row__copy",
        "aria-label": "Copy upgrade command",
        onClick: copy,
        children: copied ? "Copied" : "Copy"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "server-upgrade-row__copy-status", role: "status", children: copied ? "Copied to the clipboard." : failed ? "Could not copy. Select the command instead." : "" })
  ] });
}
function ServerUpgradeCheck({
  onCheck,
  profileId,
  reachable,
  variant
}) {
  const [checking, setChecking] = (0, import_react4.useState)(false);
  const [result, setResult] = (0, import_react4.useState)();
  const mounted = (0, import_react4.useRef)(true);
  (0, import_react4.useEffect)(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    setChecking(true);
    void onCheck(profileId).then((line) => {
      if (!mounted.current) return;
      setChecking(false);
      setResult(line);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: "remote-access-menu__item server-upgrade-row__check",
        ...variant === "menu" ? { role: "menuitem" } : {},
        "data-server-upgrade-check": true,
        disabled: !reachable || checking,
        onClick: check,
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: checking ? "Checking for updates\u2026" : "Check for updates" })
      }
    ),
    !checking && result !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "server-upgrade-row__progress", role: "status", children: result }) : null
  ] });
}
function ServerUpgradeMenuRows({
  namesServers,
  onCheck,
  onUpgrade,
  rows,
  variant
}) {
  if (rows.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: rows.map((row) => (
    // biome-ignore lint/a11y/useSemanticElements: one server's block inside a menu or a list; a fieldset would restyle both.
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: `server-upgrade-row server-upgrade-row--${variant}`,
        role: "group",
        "aria-label": `${row.label} upgrade`,
        "data-server-upgrade-profile-id": row.profileId,
        "data-server-upgrade-state": row.action,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "server-upgrade-row__summary", children: [
            row.available === void 0 && row.failure === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              RefreshCw,
              {
                className: "server-upgrade-row__icon server-upgrade-row__icon--quiet",
                size: 13,
                "aria-hidden": "true"
              }
            ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              TriangleExclamationPoint,
              {
                className: "server-upgrade-row__icon",
                size: 13,
                "aria-hidden": "true"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
              namesServers ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "server-upgrade-row__server", children: [
                row.label,
                " \xB7",
                " "
              ] }) : null,
              row.available === void 0 ? `Running ${row.version}` : `Update available \xB7 ${row.available}`
            ] })
          ] }),
          row.failure === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "remote-access-menu__diagnostic", children: row.failure }),
          row.action === "upgrading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "server-upgrade-row__progress", role: "status", children: row.step === void 0 ? "Upgrading\u2026" : `${row.step}\u2026` }) : null,
          row.action === "upgrade" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "remote-access-menu__item server-upgrade-row__action",
              ...variant === "menu" ? { role: "menuitem" } : {},
              disabled: !row.reachable,
              onClick: () => onUpgrade(row.profileId),
              children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Upgrade server\u2026" })
            }
          ) : null,
          row.checkable && row.action !== "upgrading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            ServerUpgradeCheck,
            {
              profileId: row.profileId,
              reachable: row.reachable,
              onCheck,
              variant
            }
          ) : null,
          row.action === "manual" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "remote-access-menu__diagnostic", children: row.reason }),
            row.command === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ServerUpgradeCommand, { command: row.command })
          ] }) : null
        ]
      },
      row.profileId
    )
  )) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ServerUpgradeCheck,
  ServerUpgradeCommand,
  ServerUpgradeMenuRows
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
lucide-react/dist/esm/icons/refresh-cw.mjs:
lucide-react/dist/esm/icons/triangle-exclamation-point.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.72.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
