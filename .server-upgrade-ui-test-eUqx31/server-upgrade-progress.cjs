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

// src/workspace/ServerUpgradeProgress.tsx
var ServerUpgradeProgress_exports = {};
__export(ServerUpgradeProgress_exports, {
  ServerUpgradeProgress: () => ServerUpgradeProgress,
  serverUpgradeProgressTitle: () => serverUpgradeProgressTitle
});
module.exports = __toCommonJS(ServerUpgradeProgress_exports);

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

// node_modules/lucide-react/dist/esm/icons/check.mjs
var __iconData = {
  name: "check",
  size: 24,
  node: [["path", { d: "M20 6 9 17l-5-5", key: "1gmf2c" }]]
};
__iconData.node;
var Check = createLucideIcon(__iconData);

// node_modules/lucide-react/dist/esm/icons/circle.mjs
var __iconData2 = {
  name: "circle",
  size: 24,
  node: [["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }]]
};
__iconData2.node;
var Circle = createLucideIcon(__iconData2);

// node_modules/lucide-react/dist/esm/icons/loader-circle.mjs
var __iconData3 = {
  name: "loader-circle",
  size: 24,
  node: [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56", key: "13zald" }]],
  aliases: ["loader-2"]
};
__iconData3.node;
var LoaderCircle = createLucideIcon(__iconData3);

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

// src/workspace/ServerUpgradeProgress.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STATE_TEXT = {
  waiting: "Waiting",
  running: "In progress",
  done: "Done",
  failed: "Failed"
};
function StepIcon({ state }) {
  const props = {
    size: 14,
    "aria-hidden": true,
    className: "server-upgrade-progress__icon"
  };
  switch (state) {
    case "done":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { ...props });
    case "failed":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { ...props });
    case "running":
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { ...props });
    default:
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Circle, { ...props });
  }
}
function serverUpgradeProgressTitle(progress) {
  if (progress.outcome === "success") return `${progress.label} is upgraded`;
  if (progress.outcome === "failure")
    return `${progress.label} was not upgraded`;
  return `Upgrading ${progress.label}`;
}
function ServerUpgradeProgress({
  onClose,
  progress
}) {
  const title = serverUpgradeProgressTitle(progress);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "section",
    {
      className: "server-upgrade-progress",
      role: "status",
      "aria-live": "polite",
      "aria-label": title,
      "data-server-upgrade-progress": progress.profileId,
      "data-server-upgrade-outcome": progress.outcome ?? "running",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "server-upgrade-progress__header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "server-upgrade-progress__title", children: title }),
          progress.from === void 0 || progress.to === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "server-upgrade-progress__versions", children: [
            progress.from,
            " \u2192 ",
            progress.to
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "server-upgrade-progress__steps", children: progress.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "li",
          {
            className: `server-upgrade-progress__step server-upgrade-progress__step--${step.state}`,
            "data-step": step.id,
            "data-step-state": step.state,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StepIcon, { state: step.state }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "server-upgrade-progress__label", children: [
                step.label,
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "server-upgrade-progress__state", children: `, ${STATE_TEXT[step.state]}` })
              ] }),
              step.detail === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "server-upgrade-progress__detail", children: step.detail })
            ]
          },
          step.id
        )) }),
        progress.restarting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "server-upgrade-progress__note", children: "Disconnected while the server restarts. This reconnects by itself." }) : null,
        onClose === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "server-upgrade-progress__actions", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onClose, children: "Close" }) })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ServerUpgradeProgress,
  serverUpgradeProgressTitle
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
lucide-react/dist/esm/icons/check.mjs:
lucide-react/dist/esm/icons/circle.mjs:
lucide-react/dist/esm/icons/loader-circle.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.72.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
