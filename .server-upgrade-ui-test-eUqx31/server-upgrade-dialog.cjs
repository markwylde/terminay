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

// src/workspace/ServerUpgradeDialog.tsx
var ServerUpgradeDialog_exports = {};
__export(ServerUpgradeDialog_exports, {
  ServerUpgradeConfirmation: () => ServerUpgradeConfirmation,
  ServerUpgradeDialog: () => ServerUpgradeDialog
});
module.exports = __toCommonJS(ServerUpgradeDialog_exports);

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

// node_modules/lucide-react/dist/esm/icons/maximize-2.mjs
var __iconData = {
  name: "maximize-2",
  size: 24,
  node: [
    ["path", { d: "M15 3h6v6", key: "1q9fwt" }],
    ["path", { d: "m21 3-7 7", key: "1l2asr" }],
    ["path", { d: "m3 21 7-7", key: "tjx5ai" }],
    ["path", { d: "M9 21H3v-6", key: "wtvkvv" }]
  ]
};
__iconData.node;
var Maximize2 = createLucideIcon(__iconData);

// node_modules/lucide-react/dist/esm/icons/minimize-2.mjs
var __iconData2 = {
  name: "minimize-2",
  size: 24,
  node: [
    ["path", { d: "m14 10 7-7", key: "oa77jy" }],
    ["path", { d: "M20 10h-6V4", key: "mjg0md" }],
    ["path", { d: "m3 21 7-7", key: "tjx5ai" }],
    ["path", { d: "M4 14h6v6", key: "rmj7iw" }]
  ]
};
__iconData2.node;
var Minimize2 = createLucideIcon(__iconData2);

// node_modules/lucide-react/dist/esm/icons/triangle-exclamation-point.mjs
var __iconData3 = {
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
__iconData3.node;
var TriangleExclamationPoint = createLucideIcon(__iconData3);

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

// src/workspace/ServerUpgradeDialog.tsx
var import_react6 = require("react");
var import_react_dom2 = require("react-dom");

// src/components/settings/UpdatesPages.tsx
var import_react5 = require("react");
var import_react_dom = require("react-dom");

// src/shared/inPageWindow/InPageWindow.tsx
var import_react4 = require("react");

// src/workspace/projectTabOverflow.ts
var PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH = 640;

// src/shared/inPageWindow/geometry.ts
var TITLE_BAR_HEIGHT = 36;
var TITLE_KEEP = 160;
var MIN_WINDOW_SIZE = { width: 480, height: 320 };
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
function isCompactViewport(viewport) {
  return viewport.width > 0 && viewport.width <= PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH;
}
function minimumIn(viewport, min) {
  return {
    width: Math.min(min.width, viewport.width),
    height: Math.min(min.height, viewport.height)
  };
}
function defaultRect(size, viewport) {
  const width = Math.min(size.width, viewport.width);
  const height = Math.min(size.height, viewport.height);
  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - height) / 2),
    width,
    height
  };
}
function clampToViewport(rect, viewport, min = MIN_WINDOW_SIZE) {
  const least = minimumIn(viewport, min);
  const width = clamp(rect.width, least.width, viewport.width);
  const height = clamp(rect.height, least.height, viewport.height);
  return {
    x: clamp(rect.x, 0, viewport.width - width),
    y: clamp(rect.y, 0, viewport.height - height),
    width,
    height
  };
}
function keepReachable(rect, viewport) {
  const keep = Math.min(TITLE_KEEP, rect.width);
  return {
    ...rect,
    x: clamp(rect.x, keep - rect.width, viewport.width - keep),
    y: clamp(rect.y, 0, viewport.height - TITLE_BAR_HEIGHT)
  };
}
function rectAfterMove(start, deltaX, deltaY, viewport) {
  return keepReachable(
    { ...start, x: start.x + deltaX, y: start.y + deltaY },
    viewport
  );
}
function rectAfterResize(start, edges, deltaX, deltaY, limits) {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let { x, y, width, height } = start;
  if (edges.x === 1) {
    const maxRight = Math.max(right, limits.maxRight ?? Number.POSITIVE_INFINITY);
    width = clamp(start.width + deltaX, limits.minWidth, maxRight - start.x);
  }
  if (edges.x === -1) {
    width = clamp(start.width - deltaX, limits.minWidth, right);
    x = right - width;
  }
  if (edges.y === 1) {
    const maxBottom = Math.max(
      bottom,
      limits.maxBottom ?? Number.POSITIVE_INFINITY
    );
    height = clamp(start.height + deltaY, limits.minHeight, maxBottom - start.y);
  }
  if (edges.y === -1) {
    height = clamp(start.height - deltaY, limits.minHeight, bottom);
    y = bottom - height;
  }
  return { x, y, width, height };
}
function rectAfterViewportResize(start, edges, deltaX, deltaY, viewport, min = MIN_WINDOW_SIZE) {
  const least = minimumIn(viewport, min);
  return rectAfterResize(start, edges, deltaX, deltaY, {
    minWidth: least.width,
    minHeight: least.height,
    maxRight: viewport.width,
    maxBottom: viewport.height
  });
}
function fitRemembered(rect, viewport, min = MIN_WINDOW_SIZE) {
  return clampToViewport(rect, viewport, min);
}
function rectForViewport(rect, placedIn, viewport, min = MIN_WINDOW_SIZE) {
  const reachable = keepReachable(rect, viewport);
  const inside = clampToViewport(rect, viewport, min);
  const narrower = viewport.width < placedIn.width;
  const shorter = viewport.height < placedIn.height;
  return {
    x: narrower ? inside.x : reachable.x,
    width: narrower ? inside.width : reachable.width,
    y: shorter ? inside.y : reachable.y,
    height: shorter ? inside.height : reachable.height
  };
}

// src/shared/inPageWindow/geometryStore.ts
var STORAGE_KEY = "terminay.view.in-page-window.v1";
var IN_PAGE_WINDOW_IDS = [
  "settings",
  "performance-log"
];
function isWindowId(value) {
  return IN_PAGE_WINDOW_IDS.includes(value);
}
function parseGeometry(value) {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, width, height, maximized } = value;
  for (const field of [x, y, width, height]) {
    if (typeof field !== "number" || !Number.isFinite(field)) return null;
  }
  if (width <= 0 || height <= 0) return null;
  if (typeof maximized !== "boolean") return null;
  return {
    x,
    y,
    width,
    height,
    maximized
  };
}
function readAll() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw === null || raw === void 0) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const stored = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!isWindowId(id)) continue;
      const geometry = parseGeometry(value);
      if (geometry !== null) stored[id] = geometry;
    }
    return stored;
  } catch {
    return {};
  }
}
function readRememberedGeometry(id) {
  return readAll()[id] ?? null;
}
function writeRememberedGeometry(id, geometry) {
  try {
    const next = {
      ...readAll(),
      [id]: {
        x: Math.round(geometry.x),
        y: Math.round(geometry.y),
        width: Math.round(geometry.width),
        height: Math.round(geometry.height),
        maximized: geometry.maximized
      }
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
  }
}

// src/shared/inPageWindow/windowStack.ts
function createWindowStack() {
  let entries = [];
  const listeners = /* @__PURE__ */ new Set();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    push(entry) {
      entries = [...entries, entry];
      changed();
      return () => {
        entries = entries.filter((candidate) => candidate !== entry);
        changed();
      };
    },
    depthOf: (entry) => entries.indexOf(entry),
    top: () => entries.at(-1) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
var inPageWindowStack = createWindowStack();
function closeTopOnEscape(stack, event) {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  const top = stack.top();
  if (top === null) return false;
  event.preventDefault();
  top.close();
  return true;
}

// src/shared/inPageWindow/InPageWindow.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var DRAG_THRESHOLD = 4;
var DEFAULT_MARGIN = 24;
var RESIZE_HANDLES = [
  ["n", { x: 0, y: -1 }],
  ["s", { x: 0, y: 1 }],
  ["e", { x: 1, y: 0 }],
  ["w", { x: -1, y: 0 }],
  ["ne", { x: 1, y: -1 }],
  ["nw", { x: -1, y: -1 }],
  ["se", { x: 1, y: 1 }],
  ["sw", { x: -1, y: 1 }]
];
function readViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}
function initialPlacement(kind, viewport) {
  if (!kind.resizable) return null;
  const remembered = readRememberedGeometry(kind.id);
  const rect = remembered === null ? defaultRect(
    {
      width: Math.min(
        kind.defaultSize.width,
        viewport.width - DEFAULT_MARGIN * 2
      ),
      height: Math.min(
        kind.defaultSize.height,
        viewport.height - DEFAULT_MARGIN * 2
      )
    },
    viewport
  ) : fitRemembered(remembered, viewport);
  return { rect, viewport };
}
function useStackDepth(close) {
  const closeRef = (0, import_react4.useRef)(close);
  closeRef.current = close;
  const entry = (0, import_react4.useMemo)(() => ({ close: () => closeRef.current() }), []);
  (0, import_react4.useLayoutEffect)(() => inPageWindowStack.push(entry), [entry]);
  (0, import_react4.useEffect)(() => {
    const onKeyDown = (event) => {
      if (inPageWindowStack.top() === entry) {
        closeTopOnEscape(inPageWindowStack, event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [entry]);
  return (0, import_react4.useSyncExternalStore)(
    inPageWindowStack.subscribe,
    () => Math.max(0, inPageWindowStack.depthOf(entry))
  );
}
function focusableIn(root) {
  return Array.from(
    root.querySelectorAll(
      'a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])'
    )
  ).filter(
    (element) => !element.hasAttribute("disabled") && !element.hasAttribute("data-in-page-window-sentinel") && element.getClientRects().length > 0
  );
}
function InPageWindow({
  title,
  kind,
  onClose,
  children,
  name,
  className,
  icon,
  busy = false
}) {
  const titleId = (0, import_react4.useId)();
  const frameRef = (0, import_react4.useRef)(null);
  const layerRef = (0, import_react4.useRef)(null);
  const gestureRef = (0, import_react4.useRef)(null);
  const draggedRef = (0, import_react4.useRef)(false);
  const [returnFocus] = (0, import_react4.useState)(() => document.activeElement);
  const [viewport, setViewport] = (0, import_react4.useState)(readViewport);
  const [placement, setPlacement] = (0, import_react4.useState)(
    () => initialPlacement(kind, readViewport())
  );
  const [maximized, setMaximized] = (0, import_react4.useState)(
    () => kind.resizable && readRememberedGeometry(kind.id)?.maximized === true
  );
  const [contentSize, setContentSize] = (0, import_react4.useState)(null);
  const [gesturing, setGesturing] = (0, import_react4.useState)(false);
  const close = (0, import_react4.useCallback)(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  const depth = useStackDepth(close);
  const compact = isCompactViewport(viewport);
  const filled = compact || kind.resizable && maximized;
  const resizableId = kind.resizable ? kind.id : null;
  (0, import_react4.useEffect)(() => {
    const layer = layerRef.current;
    if (layer === null) return;
    const measure = () => setViewport(
      (current) => current.width === layer.clientWidth && current.height === layer.clientHeight ? current : { width: layer.clientWidth, height: layer.clientHeight }
    );
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    measure();
    return () => observer.disconnect();
  }, []);
  (0, import_react4.useEffect)(() => {
    const frame = frameRef.current;
    if (frame === null || kind.resizable) return;
    const observer = new ResizeObserver(
      () => setContentSize({ width: frame.offsetWidth, height: frame.offsetHeight })
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [kind.resizable]);
  (0, import_react4.useEffect)(() => {
    const frame = frameRef.current;
    if (frame !== null && !frame.contains(document.activeElement)) {
      frame.focus({ preventScroll: true });
    }
    return () => {
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
  }, [returnFocus]);
  const remember = (0, import_react4.useCallback)(
    (next, nextMaximized) => {
      if (resizableId === null || next === null) return;
      writeRememberedGeometry(resizableId, {
        ...next.rect,
        maximized: nextMaximized
      });
    },
    [resizableId]
  );
  const toggleMaximized = (0, import_react4.useCallback)(() => {
    if (resizableId === null) return;
    remember(placement, !maximized);
    setMaximized(!maximized);
  }, [maximized, placement, remember, resizableId]);
  const shown = (0, import_react4.useMemo)(() => {
    if (placement === null) return null;
    if (kind.resizable) {
      return rectForViewport(placement.rect, placement.viewport, viewport);
    }
    const size = contentSize ?? placement.rect;
    const rect = { ...placement.rect, ...size };
    return rectForViewport(rect, placement.viewport, viewport, size);
  }, [contentSize, kind.resizable, placement, viewport]);
  const applyRect = (rect, edges) => {
    const frame = frameRef.current;
    if (frame === null) return;
    frame.dataset.placed = "true";
    frame.style.left = `${rect.x}px`;
    frame.style.top = `${rect.y}px`;
    if (edges !== null) {
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
    }
  };
  const rectDuring = (gesture, event) => {
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    return gesture.edges === null ? rectAfterMove(gesture.rect, deltaX, deltaY, viewport) : rectAfterViewportResize(
      gesture.rect,
      gesture.edges,
      deltaX,
      deltaY,
      viewport
    );
  };
  const beginGesture = (event, edges) => {
    if (event.button !== 0 || filled) return;
    if (edges === null && event.target.closest("button") !== null) {
      return;
    }
    const frame = frameRef.current;
    if (frame === null) return;
    const bounds = frame.getBoundingClientRect();
    const layer = layerRef.current?.getBoundingClientRect();
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: {
        x: bounds.left - (layer?.left ?? 0),
        y: bounds.top - (layer?.top ?? 0),
        width: bounds.width,
        height: bounds.height
      },
      edges
    };
    draggedRef.current = edges !== null;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (edges !== null) {
      event.preventDefault();
      setGesturing(true);
    }
  };
  const continueGesture = (event) => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    if (!draggedRef.current) {
      const travelled = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      );
      if (travelled < DRAG_THRESHOLD) return;
      draggedRef.current = true;
      if (placement === null) {
        setPlacement({ rect: gesture.rect, viewport });
      }
      setGesturing(true);
    }
    applyRect(rectDuring(gesture, event), gesture.edges);
  };
  const endGesture = (event, cancelled) => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setGesturing(false);
    if (!draggedRef.current) return;
    const next = {
      rect: cancelled ? gesture.rect : rectDuring(gesture, event),
      viewport
    };
    applyRect(next.rect, gesture.edges);
    setPlacement(next);
    if (!cancelled) remember(next, false);
  };
  const redirectFocus = (toEnd) => {
    const frame = frameRef.current;
    if (frame === null) return;
    const focusable = focusableIn(frame);
    (toEnd ? focusable.at(-1) : focusable[0])?.focus();
  };
  const frameStyle = filled ? {} : shown === null ? { width: kind.resizable ? void 0 : kind.width } : kind.resizable ? {
    left: shown.x,
    top: shown.y,
    width: shown.width,
    height: shown.height
  } : {
    left: shown.x,
    top: shown.y,
    width: kind.width,
    maxHeight: viewport.height
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      ref: layerRef,
      className: "in-page-window-layer",
      "data-gesturing": gesturing || void 0,
      "data-in-page-window-depth": depth,
      style: { zIndex: 1e4 + depth },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "in-page-window-backdrop",
            role: "presentation",
            onPointerDown: (event) => {
              if (event.button === 0) close();
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            ref: frameRef,
            "aria-labelledby": titleId,
            "aria-modal": "true",
            className: className === void 0 ? "in-page-window" : `in-page-window ${className}`,
            "data-compact": compact || void 0,
            "data-connected-web-auxiliary-route": name,
            "data-in-page-window": name ?? "dialog",
            "data-maximized": !compact && filled || void 0,
            "data-placed": shown !== null || void 0,
            "data-resizable": kind.resizable || void 0,
            role: "dialog",
            style: frameStyle,
            tabIndex: -1,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "span",
                {
                  "data-in-page-window-sentinel": "",
                  tabIndex: 0,
                  onFocus: () => redirectFocus(true)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "in-page-window__chrome", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "header",
                  {
                    className: "in-page-window__titlebar",
                    onDoubleClick: (event) => {
                      if (event.target.closest("button") === null) {
                        toggleMaximized();
                      }
                    },
                    onPointerCancel: (event) => endGesture(event, true),
                    onPointerDown: (event) => beginGesture(event, null),
                    onPointerMove: continueGesture,
                    onPointerUp: (event) => endGesture(event, false),
                    children: [
                      icon === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { "aria-hidden": "true", className: "in-page-window__icon", children: icon }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "in-page-window__title", id: titleId, children: title }),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "in-page-window__controls", children: [
                        kind.resizable && !compact ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                          "button",
                          {
                            "aria-label": maximized ? "Restore" : "Maximise",
                            "aria-pressed": maximized,
                            className: "in-page-window__control",
                            "data-in-page-window-control": "maximise",
                            type: "button",
                            onClick: toggleMaximized,
                            children: maximized ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Minimize2, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Maximize2, { size: 14 })
                          }
                        ) : null,
                        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                          "button",
                          {
                            "aria-label": "Close",
                            className: "in-page-window__control",
                            "data-in-page-window-control": "close",
                            disabled: busy,
                            type: "button",
                            onClick: close,
                            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { size: 16 })
                          }
                        )
                      ] })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "in-page-window__body", children })
              ] }),
              kind.resizable && !filled ? RESIZE_HANDLES.map(([handle, edges]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "div",
                {
                  "aria-hidden": "true",
                  className: `in-page-window__resize in-page-window__resize--${handle}`,
                  "data-in-page-window-resize": handle,
                  onPointerCancel: (event) => endGesture(event, true),
                  onPointerDown: (event) => beginGesture(event, edges),
                  onPointerMove: continueGesture,
                  onPointerUp: (event) => endGesture(event, false)
                },
                handle
              )) : null,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "span",
                {
                  "data-in-page-window-sentinel": "",
                  tabIndex: 0,
                  onFocus: () => redirectFocus(false)
                }
              )
            ]
          }
        )
      ]
    }
  );
}

// src/components/settings/updatesPageModel.ts
var DEVICE_CHANNEL_LABELS = Object.freeze({
  stable: "Stable",
  nightly: "Nightly",
  canary: "Canary"
});
var SERVER_TRACKS = Object.freeze([
  { channel: "tag", label: "Stable", ref: "latest" },
  { channel: "main", label: "Nightly", ref: "main" },
  { channel: "canary", label: "Canary", ref: "canary" }
]);

// src/components/settings/UpdatesPages.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var DOWNGRADE_WARNING = "This is older than what is running now. Settings and state written by the newer release might not carry over.";

// src/workspace/serverUpgradeModel.ts
var SERVER_UPGRADE_RETURN_DEADLINE_MS = 5 * 6e4;
var SERVER_UPGRADE_MEMORY_MAX_AGE_MS = 24 * 60 * 6e4;
var NOTHING_REMEMBERED = Object.freeze({
  seen: Object.freeze([])
});
var EMPTY_BOARD = Object.freeze({
  entries: Object.freeze([]),
  notices: Object.freeze([]),
  progress: Object.freeze([])
});
function preselectedUpgradeMode(modes) {
  return modes.includes("in-place") ? "in-place" : modes[0] ?? "in-place";
}
function upgradeConsequenceText(mode) {
  return mode === "recreate" ? "The connection to this server drops while its container is recreated. Every terminal on this server ends." : "The connection to this server drops briefly while it restarts. Its terminals keep running.";
}

// src/workspace/ServerUpgradeDialog.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var MODE_LABELS = {
  "in-place": "Upgrade in place",
  recreate: "Recreate the container"
};
function ServerUpgradeConfirmation({
  entry,
  error,
  isStarting,
  mode,
  onCancel,
  onConfirm,
  onModeChange,
  installLatest
}) {
  const { status } = entry;
  const isRunning = status.upgrade.state === "in-progress";
  const available = installLatest?.version ?? status.available?.version;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "div",
    {
      className: "project-edit-modal server-upgrade-dialog",
      "data-server-upgrade-dialog": entry.profileId,
      ...installLatest === void 0 ? {} : { "data-install-latest-dialog": "server" },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "server-upgrade-dialog__summary", children: [
          entry.label,
          " is running ",
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: status.version }),
          ".",
          available === void 0 ? null : installLatest !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            " ",
            "The latest release on its channel is ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: available }),
            "."
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
            " ",
            "Version ",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: available }),
            " is available."
          ] })
        ] }),
        installLatest?.downgrade === true ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "server-upgrade-dialog__warning", "data-install-latest-downgrade": true, children: DOWNGRADE_WARNING }) : null,
        installLatest === void 0 && status.modes.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            className: "server-upgrade-dialog__modes",
            role: "radiogroup",
            "aria-label": "How to upgrade",
            children: status.modes.map((offered) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "server-upgrade-dialog__mode", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                "input",
                {
                  type: "radio",
                  name: "server-upgrade-mode",
                  value: offered,
                  checked: mode === offered,
                  disabled: isStarting,
                  onChange: () => onModeChange(offered)
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "server-upgrade-dialog__mode-label", children: MODE_LABELS[offered] }),
                offered === "recreate" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "server-upgrade-dialog__mode-note", children: "Ends every terminal on this server." }) : null
              ] })
            ] }, offered))
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "p",
          {
            className: "server-upgrade-dialog__consequence",
            "data-server-upgrade-consequence": mode,
            children: upgradeConsequenceText(mode)
          }
        ),
        error !== void 0 || isRunning ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "server-upgrade-dialog__error", role: "alert", children: error ?? "An upgrade is already running." }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "project-edit-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: onCancel, children: "Cancel" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
            "button",
            {
              type: "button",
              className: "server-upgrade-dialog__primary",
              disabled: isStarting || isRunning || available === void 0 || !entry.reachable,
              onClick: onConfirm,
              children: isStarting ? "Starting\u2026" : installLatest === void 0 ? "Upgrade" : "Install"
            }
          )
        ] })
      ]
    }
  );
}
function ServerUpgradeDialog({
  confirmation
}) {
  const { close, entry, installLatest, start } = confirmation;
  const modes = installLatest === void 0 ? entry.status.modes : ["in-place"];
  const [mode, setMode] = (0, import_react6.useState)(() => preselectedUpgradeMode(modes));
  const [isStarting, setIsStarting] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)();
  (0, import_react6.useEffect)(() => {
    if (!modes.includes(mode)) setMode(preselectedUpgradeMode(modes));
  }, [mode, modes]);
  const confirm = () => {
    setError(void 0);
    setIsStarting(true);
    void start(mode).then((refusal) => {
      setIsStarting(false);
      if (refusal === void 0) close();
      else setError(refusal);
    });
  };
  return (0, import_react_dom2.createPortal)(
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      InPageWindow,
      {
        icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          TriangleExclamationPoint,
          {
            size: 14,
            className: "server-upgrade-dialog__title-icon"
          }
        ),
        kind: { resizable: false, width: 440 },
        name: "server-upgrade",
        title: installLatest === void 0 ? `Upgrade ${entry.label}` : `Install latest on ${entry.label}`,
        onClose: close,
        busy: isStarting,
        children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          ServerUpgradeConfirmation,
          {
            entry,
            mode,
            onModeChange: setMode,
            isStarting,
            ...error === void 0 ? {} : { error },
            ...installLatest === void 0 ? {} : { installLatest },
            onCancel: close,
            onConfirm: confirm
          }
        )
      }
    ),
    document.body
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ServerUpgradeConfirmation,
  ServerUpgradeDialog
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
lucide-react/dist/esm/icons/maximize-2.mjs:
lucide-react/dist/esm/icons/minimize-2.mjs:
lucide-react/dist/esm/icons/triangle-exclamation-point.mjs:
lucide-react/dist/esm/icons/x.mjs:
lucide-react/dist/esm/lucide-react.mjs:
  (**
   * @license lucide-react v1.72.0 - ISC
   *
   * This source code is licensed under the ISC license.
   * See the LICENSE file in the root directory of this source tree.
   *)
*/
