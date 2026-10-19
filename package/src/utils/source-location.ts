import * as React from "react";

// =============================================================================
// Source Location Detection Utilities
// =============================================================================
//
// This module provides utilities for detecting React source file locations from
// DOM elements. It works by accessing React's internal fiber tree and extracting
// _debugSource information that's available in development builds.
//
// Compatibility:
// - React 16.8+ (Hooks era)
// - React 17.x
// - React 18.x
// - React 19.x (with fallbacks for changed internals)
//
// Limitations:
// - Only works in development builds (production builds strip _debugSource)
// - Requires React DevTools-style fiber access
// - Some bundlers may strip debug info even in development
// =============================================================================

/**
 * Source location information for a React component
 */
export interface SourceLocation {
  /** Absolute or relative file path */
  fileName: string;
  /** Line number (1-indexed) */
  lineNumber: number;
  /** Column number (0-indexed, may be undefined) */
  columnNumber?: number;
  /** Component display name if available */
  componentName?: string;
  /** React version detected */
  reactVersion?: string;
}

/**
 * Result of source location detection
 */
export interface SourceLocationResult {
  /** Whether source location was found */
  found: boolean;
  /** Source location data (if found) */
  source?: SourceLocation;
  /** Reason if not found */
  reason?: SourceLocationNotFoundReason;
  /** Whether the app appears to be a React app */
  isReactApp: boolean;
  /** Whether running in production mode */
  isProduction: boolean;
}

/**
 * Reasons why source location might not be found
 */
export type SourceLocationNotFoundReason =
  | "not-react-app"
  | "production-build"
  | "no-fiber"
  | "no-debug-source"
  | "react-19-changed"
  | "element-not-in-react-tree"
  | "unknown";

/**
 * React Fiber node structure (partial, for type safety)
 * Based on React's internal FiberNode type
 */
interface ReactFiber {
  // Debug source info (only in development)
  _debugSource?: {
    fileName: string;
    lineNumber: number;
    columnNumber?: number;
  };
  // Owner info (React 19 may use this differently)
  _debugOwner?: ReactFiber;
  // React 19: the stack captured where this fiber's JSX element was created
  _debugStack?: { stack?: string };
  // Component type
  type?: {
    name?: string;
    displayName?: string;
    // For class components
    prototype?: {
      isReactComponent?: boolean;
    };
  } | string | null;
  // Element type for built-in elements
  elementType?: unknown;
  // Tag indicating fiber type
  tag?: number;
  // Fiber tree navigation
  return?: ReactFiber | null;
  child?: ReactFiber | null;
  sibling?: ReactFiber | null;
  // Memoized props (for context)
  memoizedProps?: Record<string, unknown>;
  // State node for class components
  stateNode?: unknown;
}

/**
 * Extended HTMLElement with React fiber properties
 */
interface ReactDOMElement extends HTMLElement {
  // React 16-17 fiber key
  __reactFiber$?: string;
  // React 18+ fiber key pattern
  __reactFiber?: ReactFiber;
  // React internal instance (older pattern)
  __reactInternalInstance$?: string;
  // Alternative patterns
  _reactRootContainer?: unknown;
}

// React fiber tag constants (for reference)
const FIBER_TAGS = {
  FunctionComponent: 0,
  ClassComponent: 1,
  IndeterminateComponent: 2,
  HostRoot: 3,
  HostPortal: 4,
  HostComponent: 5,
  HostText: 6,
  Fragment: 7,
  Mode: 8,
  ContextConsumer: 9,
  ContextProvider: 10,
  ForwardRef: 11,
  Profiler: 12,
  SuspenseComponent: 13,
  MemoComponent: 14,
  SimpleMemoComponent: 15,
  LazyComponent: 16,
} as const;

/**
 * Checks if the page appears to be running a React application
 *
 * @returns Object with detection results
 */
export function detectReactApp(): {
  isReact: boolean;
  version?: string;
  isProduction: boolean;
} {
  if (typeof window === "undefined") {
    return { isReact: false, isProduction: true };
  }

  // Check for React DevTools hook (most reliable)
  const devToolsHook = (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (devToolsHook && typeof devToolsHook === "object") {
    const hook = devToolsHook as Record<string, unknown>;

    // Check for renderers (React 16+)
    const renderers = hook.renderers as Map<number, { version?: string }> | undefined;
    if (renderers && renderers.size > 0) {
      // Get version from first renderer
      const firstRenderer = renderers.values().next().value;
      const version = firstRenderer?.version;

      // Check for production mode via lack of development tools
      const isProduction = !hook.supportsFiber;

      return {
        isReact: true,
        version: version || "unknown",
        isProduction,
      };
    }
  }

  // Fallback: Check for React root markers on DOM
  const hasReactRoot = document.querySelector("[data-reactroot]") !== null;
  const hasReactContainer = (document.getElementById("root") as (HTMLElement & { _reactRootContainer?: unknown }) | null)?._reactRootContainer !== undefined;

  // Check for fiber keys on body's children
  const bodyChildren = document.body.children;
  let hasFiberKey = false;

  for (let i = 0; i < bodyChildren.length && !hasFiberKey; i++) {
    const child = bodyChildren[i];
    const keys = Object.keys(child);
    hasFiberKey = keys.some(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
    );
  }

  if (hasReactRoot || hasReactContainer || hasFiberKey) {
    return {
      isReact: true,
      version: "unknown",
      // Assume production if we can't detect dev tools
      isProduction: !devToolsHook,
    };
  }

  return { isReact: false, isProduction: true };
}

/**
 * Gets the React fiber node associated with a DOM element
 *
 * @param element - DOM element to get fiber for
 * @returns React fiber node or null if not found
 */
export function getFiberFromElement(element: HTMLElement): ReactFiber | null {
  if (!element || typeof element !== "object") {
    return null;
  }

  const keys = Object.keys(element);

  // React 18+ uses __reactFiber$ prefix
  const fiberKey = keys.find((key) => key.startsWith("__reactFiber$"));
  if (fiberKey) {
    return (element as unknown as Record<string, ReactFiber>)[fiberKey] || null;
  }

  // React 16-17 uses __reactInternalInstance$ prefix
  const instanceKey = keys.find((key) => key.startsWith("__reactInternalInstance$"));
  if (instanceKey) {
    return (element as unknown as Record<string, ReactFiber>)[instanceKey] || null;
  }

  // React 19 may use different patterns - check for any fiber-like object
  const possibleFiberKey = keys.find((key) => {
    if (!key.startsWith("__react")) return false;
    const value = (element as unknown as Record<string, unknown>)[key];
    return value && typeof value === "object" && "_debugSource" in (value as object);
  });

  if (possibleFiberKey) {
    return (element as unknown as Record<string, ReactFiber>)[possibleFiberKey] || null;
  }

  return null;
}

/**
 * Gets the display name of a React component from its fiber
 *
 * @param fiber - React fiber node
 * @returns Component name or null
 */
function getComponentName(fiber: ReactFiber): string | null {
  if (!fiber.type) {
    return null;
  }

  // String type means host component (div, span, etc.)
  if (typeof fiber.type === "string") {
    return null; // We want React component names, not HTML tags
  }

  // Function/class component
  if (typeof fiber.type === "object" || typeof fiber.type === "function") {
    const type = fiber.type as { displayName?: string; name?: string };

    // Prefer displayName (set by React DevTools or manually)
    if (type.displayName) {
      return type.displayName;
    }

    // Fall back to function/class name
    if (type.name) {
      return type.name;
    }
  }

  return null;
}

/**
 * Walks up the fiber tree to find the nearest component with _debugSource
 *
 * @param fiber - Starting fiber node
 * @param maxDepth - Maximum tree depth to traverse (default: 50)
 * @returns Object with source info and component name, or null
 */
function findDebugSource(
  fiber: ReactFiber,
  maxDepth = 50
): { source: ReactFiber["_debugSource"]; componentName: string | null } | null {
  let current: ReactFiber | null | undefined = fiber;
  let depth = 0;

  while (current && depth < maxDepth) {
    // Check current fiber for debug source
    if (current._debugSource) {
      return {
        source: current._debugSource,
        componentName: getComponentName(current),
      };
    }

    // Check debug owner (for components that wrap the element)
    if (current._debugOwner?._debugSource) {
      return {
        source: current._debugOwner._debugSource,
        componentName: getComponentName(current._debugOwner),
      };
    }

    // Move up the tree
    current = current.return;
    depth++;
  }

  return null;
}

/**
 * Attempts to find source location using React 19's potentially different structure
 *
 * @param fiber - Starting fiber node
 * @returns Source location info or null
 */
function findDebugSourceReact19(
  fiber: ReactFiber
): { source: ReactFiber["_debugSource"]; componentName: string | null } | null {
  // React 19 may store debug info differently
  // This is a forward-compatible attempt based on React 19 RFCs

  let current: ReactFiber | null | undefined = fiber;
  let depth = 0;
  const maxDepth = 50;

  while (current && depth < maxDepth) {
    // Check for new React 19 debug patterns
    const anyFiber = current as unknown as Record<string, unknown>;

    // Possible React 19 locations for debug info
    const possibleSourceKeys = [
      "_debugSource",
      "__source",
      "_source",
      "debugSource",
    ];

    for (const key of possibleSourceKeys) {
      const source = anyFiber[key];
      if (source && typeof source === "object" && "fileName" in source) {
        return {
          source: source as ReactFiber["_debugSource"],
          componentName: getComponentName(current),
        };
      }
    }

    // Check if debug info is in the element itself
    if (current.memoizedProps) {
      const props = current.memoizedProps as Record<string, unknown>;
      if (props.__source && typeof props.__source === "object") {
        const source = props.__source as { fileName?: string; lineNumber?: number };
        if (source.fileName && source.lineNumber) {
          return {
            source: {
              fileName: source.fileName,
              lineNumber: source.lineNumber,
              columnNumber: (source as { columnNumber?: number }).columnNumber,
            },
            componentName: getComponentName(current),
          };
        }
      }
    }

    current = current.return;
    depth++;
  }

  return null;
}

// =============================================================================
// Stack-Trace Fallback for Source File Detection
// =============================================================================
//
// When _debugSource is unavailable (e.g. Next.js with SWC), we fall back to
// invoking the component function with a throwing hooks dispatcher, parsing
// the error stack trace, and stripping bundler URL prefixes. In dev mode,
// stack frames already contain original source paths.
// =============================================================================

/** Cache: component function → probed SourceLocation (or null if unresolvable) */
const sourceProbeCache = new Map<Function, SourceLocation | null>();

/**
 * Extract the callable function from a fiber, handling wrappers.
 * Returns null for class components, host elements, or unrecognized types.
 */
function unwrapComponentType(fiber: ReactFiber): Function | null {
  const tag = fiber.tag;
  const type = fiber.type;
  const elementType = fiber.elementType as Record<string, unknown> | null | undefined;

  // Host elements (div, span, etc.)
  if (typeof type === "string" || type == null) return null;

  // Class components — skip (need `new`, different lifecycle)
  if (
    typeof type === "function" &&
    (type as { prototype?: { isReactComponent?: boolean } }).prototype?.isReactComponent
  ) {
    return null;
  }

  // FunctionComponent / IndeterminateComponent
  if (
    (tag === FIBER_TAGS.FunctionComponent || tag === FIBER_TAGS.IndeterminateComponent) &&
    typeof type === "function"
  ) {
    return type as Function;
  }

  // ForwardRef
  if (tag === FIBER_TAGS.ForwardRef && elementType) {
    const render = elementType.render;
    if (typeof render === "function") return render as Function;
  }

  // Memo / SimpleMemo
  if (
    (tag === FIBER_TAGS.MemoComponent || tag === FIBER_TAGS.SimpleMemoComponent) &&
    elementType
  ) {
    const inner = elementType.type;
    if (typeof inner === "function") return inner as Function;
  }

  // Generic fallback: if type is a plain function, use it
  if (typeof type === "function") return type as Function;

  return null;
}

/**
 * Access the React hooks dispatcher from React's module internals.
 * These are properties on the `react` module export, NOT on `window`.
 * Returns get/set helpers or null if not found.
 */
function getReactDispatcher(): {
  get: () => unknown;
  set: (d: unknown) => void;
} | null {
  // Access React internals from the imported module
  const reactModule = React as unknown as Record<string, unknown>;

  // React 19: __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H
  const r19 = reactModule.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
    | Record<string, unknown>
    | undefined;
  if (r19 && "H" in r19) {
    return {
      get: () => r19.H,
      set: (d: unknown) => { r19.H = d; },
    };
  }

  // React 16-18: __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher.current
  const r18 = reactModule.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as
    | Record<string, unknown>
    | undefined;
  if (r18) {
    const dispatcher = r18.ReactCurrentDispatcher as
      | { current: unknown }
      | undefined;
    if (dispatcher && "current" in dispatcher) {
      return {
        get: () => dispatcher.current,
        set: (d: unknown) => { dispatcher.current = d; },
      };
    }
  }

  return null;
}

/**
 * Parse the first non-internal frame from an error stack string.
 */
function parseComponentFrame(
  stack: string,
  functionName?: string,
): { fileName: string; line: number; column?: number } | null {
  const lines = stack.split("\n");

  // Patterns to skip: our own bundle, React internals, node_modules, chunk files
  const skipPatterns = [
    /source-location/,
    /\/dist\/index\./,       // Our bundled output (dist/index.mjs, dist/index.js)
    /node_modules\//,        // Any package in node_modules
    /react-dom/,
    /react\.development/,
    /react\.production/,
    /chunk-[A-Z0-9]+/i,
    /\/_next\/static\/chunks\//,
    /\/\.vite\/deps\//,
    /\/_astro\//,
    /\/assets\/[^\s/]+[-.][\w-]{8,}\.m?js(?:[?:]|$)/,
    /react-stack-bottom-frame/,
    /react-reconciler/,
    /scheduler/,
    /<anonymous>/,           // Proxy handler frames
  ];

  // V8 format: "    at FnName (file:line:col)" or "    at file:line:col"
  const v8Re = /^\s*at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)\)?$/;
  // WebKit/Gecko: "FnName@file:line:col" or "@file:line:col"
  const webkitRe = /^[^@]*@(.+?):(\d+):(\d+)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip frames from internal files
    if (skipPatterns.some((p) => p.test(trimmed))) continue;
    // A renamed/combined library bundle no longer has a recognizable filename.
    // Require the probed component's frame instead of returning our Proxy.get
    // or a React hook's generated location as if it were application source.
    if (functionName) {
      const name = functionName.replace(/^bound /, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(?:at (?:Object\\.)?|^)${name}(?: \\(|@| \\[)`).test(trimmed)) continue;
    }

    const match = v8Re.exec(trimmed) || webkitRe.exec(trimmed);
    if (match) {
      return {
        fileName: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
      };
    }
  }

  return null;
}

/**
 * Strip bundler URL prefixes from a raw source path.
 */
function cleanSourcePath(rawPath: string): string {
  let path = rawPath;

  // 1. Strip query params and hashes
  path = path.replace(/[?#].*$/, "");

  // 2. Turbopack project prefix
  path = path.replace(/^turbopack:\/\/\/\[project\]\//, "");

  // 3. webpack-internal
  path = path.replace(/^webpack-internal:\/\/\/\.\//, "");
  path = path.replace(/^webpack-internal:\/\/\//, "");

  // 4. webpack
  path = path.replace(/^webpack:\/\/\/\.\//, "");
  path = path.replace(/^webpack:\/\/\//, "");

  // 5. turbopack generic
  path = path.replace(/^turbopack:\/\/\//, "");

  // 6. http(s)://host:port/
  path = path.replace(/^https?:\/\/[^/]+\//, "");

  // 6b. Vite serves files outside its root as /@fs/<absolute path>
  path = path.replace(/^@fs\//, "/");

  // 7. file:///
  path = path.replace(/^file:\/\/\//, "/");

  // 8. Webpack chunk group prefixes like (app-pages-browser)/./
  path = path.replace(/^\([^)]+\)\/\.\//, "");

  // 9. Leading ./
  path = path.replace(/^\.\//, "");

  return path;
}

/**
 * Probe a single fiber's component function by invoking it with a
 * throwing hooks dispatcher and parsing the resulting error stack.
 */
function probeComponentSource(fiber: ReactFiber): SourceLocation | null {
  const fn = unwrapComponentType(fiber);
  if (!fn) return null;

  // Check cache
  if (sourceProbeCache.has(fn)) {
    return sourceProbeCache.get(fn)!;
  }

  const dispatcher = getReactDispatcher();
  if (!dispatcher) {
    sourceProbeCache.set(fn, null);
    return null;
  }

  const original = dispatcher.get();
  let result: SourceLocation | null = null;

  try {
    // Install a proxy dispatcher that throws an Error (with stack) on any hook access.
    // When the component calls useState/useEffect/etc., the proxy's get trap fires,
    // creating an Error whose stack trace includes the component's source location.
    const stackCapturingDispatcher = new Proxy(
      {},
      {
        get() {
          throw new Error("probe");
        },
      }
    );
    dispatcher.set(stackCapturingDispatcher);

    try {
      // Invoke the component — it will either:
      // 1. Call a hook → throws Error with stack (ideal case)
      // 2. Have no hooks → runs to completion (harmless, discarded), no stack to parse
      fn({});
    } catch (e) {
      if (e instanceof Error && e.message === "probe" && e.stack) {
        const frame = parseComponentFrame(e.stack, fn.name);
        if (frame) {
          const cleaned = cleanSourcePath(frame.fileName);
          result = {
            fileName: cleaned,
            lineNumber: frame.line,
            columnNumber: frame.column,
            componentName: getComponentName(fiber) || undefined,
          };
        }
      }
    }
  } finally {
    dispatcher.set(original);
  }

  sourceProbeCache.set(fn, result);
  return result;
}

/**
 * Walk the fiber tree via .return, probing each fiber for source info.
 * Stops at the first success.
 */
function probeSourceWalk(
  fiber: ReactFiber,
  maxDepth = 15
): SourceLocation | null {
  let current: ReactFiber | null | undefined = fiber;
  let depth = 0;

  while (current && depth < maxDepth) {
    const source = probeComponentSource(current);
    if (source) return source;

    current = current.return;
    depth++;
  }

  return null;
}

// =============================================================================
// React 19: element creation stacks
// =============================================================================
//
// React 19 removed `_debugSource`, but in development every fiber keeps
// `_debugStack`: an Error captured where its JSX element was created. Its
// frames point at the dev server's transformed modules, so on their own they
// give generated line numbers. Vite serves each module with an inline source
// map, which maps the creation site back to the original line. Unlike probing
// a component's first hook, this resolves the selected element itself, and
// walking `_debugOwner` past library code lands on the line that rendered it.

const BASE64_VALUES: Record<string, number> = {};
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  .split("")
  .forEach((char, index) => {
    BASE64_VALUES[char] = index;
  });

/** One decoded mapping: [generatedColumn, sourceIndex, sourceLine, sourceColumn], all 0-indexed. */
type MappingSegment = [number, number, number, number];

/**
 * Decode a source map's VLQ `mappings` into segments per generated line.
 * Segments without a source position are dropped.
 */
function decodeSourceMapMappings(mappings: string): MappingSegment[][] {
  const lines: MappingSegment[][] = [];
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;

  for (const lineText of mappings.split(";")) {
    const segments: MappingSegment[] = [];
    let generatedColumn = 0;

    for (const segmentText of lineText ? lineText.split(",") : []) {
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segmentText) {
        const digit = BASE64_VALUES[char];
        if (digit === undefined) break;
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      if (values.length === 0) continue;

      generatedColumn += values[0];
      if (values.length >= 4) {
        sourceIndex += values[1];
        sourceLine += values[2];
        sourceColumn += values[3];
        segments.push([generatedColumn, sourceIndex, sourceLine, sourceColumn]);
      }
    }

    lines.push(segments);
  }

  return lines;
}

interface LoadedSourceMap {
  sources: string[];
  lines: MappingSegment[][];
}

const sourceMapCache = new Map<string, LoadedSourceMap | null>();

/**
 * Synchronous because annotations are built synchronously. It runs only when
 * an element is picked, in development, against modules the page has already
 * loaded: one blocking request per module (a 304 revalidation on Vite, which
 * serves modules `no-cache`), after which the decoded map stays in memory.
 */
function fetchTextSync(url: string): string | null {
  const request = new XMLHttpRequest();
  request.open("GET", url, false);
  request.send();
  return request.status >= 200 && request.status < 300
    ? request.responseText
    : null;
}

function loadSourceMap(moduleUrl: string): LoadedSourceMap | null {
  const cached = sourceMapCache.get(moduleUrl);
  if (cached !== undefined) return cached;

  let map: LoadedSourceMap | null = null;
  try {
    const code = fetchTextSync(moduleUrl);
    const match = code && /\/\/[#@] sourceMappingURL=(\S+)\s*$/.exec(code);
    if (match) {
      const mapUrl = new URL(match[1], moduleUrl).href;
      const inline = /^data:application\/json[^,]*?(;base64)?,(.*)$/.exec(mapUrl);
      const json = inline
        ? inline[1]
          ? new TextDecoder().decode(
              Uint8Array.from(atob(inline[2]), (char) => char.charCodeAt(0)),
            )
          : decodeURIComponent(inline[2])
        : fetchTextSync(mapUrl);

      if (json) {
        const parsed = JSON.parse(json) as {
          sources?: string[];
          sourceRoot?: string;
          mappings?: string;
        };
        const base = inline ? moduleUrl : mapUrl;
        map = {
          sources: (parsed.sources ?? []).map((source) => {
            const path = (parsed.sourceRoot ?? "") + source;
            try {
              return new URL(path, base).href;
            } catch {
              return path;
            }
          }),
          lines: decodeSourceMapMappings(parsed.mappings ?? ""),
        };
      }
    }
  } catch {
    map = null;
  }

  sourceMapCache.set(moduleUrl, map);
  return map;
}

/**
 * Map a 1-indexed line and column in a served module to its original source.
 */
function mapToOriginalPosition(
  moduleUrl: string,
  line: number,
  column: number,
): SourceLocation | null {
  if (!/^https?:/.test(moduleUrl)) return null;

  const map = loadSourceMap(moduleUrl);
  const segments = map?.lines[line - 1];
  if (!map || !segments || segments.length === 0) return null;

  let best = segments[0];
  for (const segment of segments) {
    if (segment[0] > column - 1) break;
    best = segment;
  }

  const source = map.sources[best[1]];
  if (!source) return null;

  return {
    fileName: cleanSourcePath(source),
    lineNumber: best[2] + 1,
    columnNumber: best[3],
  };
}

/**
 * Resolve where the element's JSX was created, from React 19's `_debugStack`.
 * When the creation frame is library code (a `<Link>` rendering its `<a>`),
 * continue with the owner that rendered the library component.
 */
function findCreationSource(
  fiber: ReactFiber,
  maxDepth = 30,
): SourceLocation | null {
  if (typeof XMLHttpRequest === "undefined") return null;

  let current: ReactFiber | null | undefined = fiber;
  let depth = 0;

  while (current && depth < maxDepth) {
    const stack = current._debugStack?.stack;
    const frame = typeof stack === "string" ? parseComponentFrame(stack) : null;
    if (frame?.column !== undefined) {
      const source = mapToOriginalPosition(frame.fileName, frame.line, frame.column);
      if (source) {
        const owner = current._debugOwner ?? current;
        return { ...source, componentName: getComponentName(owner) ?? undefined };
      }
    }

    current = current._debugOwner;
    depth++;
  }

  return null;
}

/**
 * Gets the source file location for a DOM element in a React application
 *
 * This function attempts to extract the source file path and line number
 * where a React component is defined. This only works in development mode
 * as production builds strip debug information.
 *
 * @param element - DOM element to get source location for
 * @returns SourceLocationResult with location info or reason for failure
 *
 * @example
 * ```ts
 * const result = getSourceLocation(element);
 * if (result.found && result.source) {
 *   console.log(`${result.source.fileName}:${result.source.lineNumber}`);
 *   // Output: "/src/components/Button.tsx:42"
 * }
 * ```
 */
export function getSourceLocation(element: HTMLElement): SourceLocationResult {
  // Try to get fiber directly from the element (same approach as getReactComponentName)
  // This avoids detectReactApp() whose production heuristic can give false positives
  const fiber = getFiberFromElement(element);

  if (!fiber) {
    return {
      found: false,
      reason: "no-fiber",
      isReactApp: false,
      isProduction: false,
    };
  }

  // Try standard React 16-18 debug source finding
  let debugInfo = findDebugSource(fiber);

  // If not found, try React 19 patterns
  if (!debugInfo) {
    debugInfo = findDebugSourceReact19(fiber);
  }

  if (debugInfo?.source) {
    return {
      found: true,
      source: {
        fileName: debugInfo.source.fileName,
        lineNumber: debugInfo.source.lineNumber,
        columnNumber: debugInfo.source.columnNumber,
        componentName: debugInfo.componentName || undefined,
      },
      isReactApp: true,
      isProduction: false,
    };
  }

  // React 19: map the element's creation stack through the module's source map
  const created = findCreationSource(fiber);
  if (created) {
    return { found: true, source: created, isReactApp: true, isProduction: false };
  }

  // Fallback: probe component via stack trace
  const probed = probeSourceWalk(fiber);
  if (probed) {
    return { found: true, source: probed, isReactApp: true, isProduction: false };
  }

  return {
    found: false,
    reason: "no-debug-source",
    isReactApp: true,
    isProduction: false,
  };
}

/**
 * Formats a source location as a clickable file path string
 *
 * @param source - Source location object
 * @param format - Output format: "vscode" for VSCode URL, "path" for file:line format
 * @returns Formatted string
 *
 * @example
 * ```ts
 * formatSourceLocation(source, "path")
 * // Returns: "src/components/Button.tsx:42:8"
 *
 * formatSourceLocation(source, "vscode")
 * // Returns: "vscode://file/absolute/path/src/components/Button.tsx:42:8"
 * ```
 */
export function formatSourceLocation(
  source: SourceLocation,
  format: "path" | "vscode" = "path"
): string {
  const { fileName, lineNumber, columnNumber } = source;

  // Build line:column suffix
  let location = `${fileName}:${lineNumber}`;
  if (columnNumber !== undefined) {
    location += `:${columnNumber}`;
  }

  if (format === "vscode") {
    // VSCode can open files via URL protocol
    // Assumes fileName is absolute or can be resolved
    return `vscode://file${fileName.startsWith("/") ? "" : "/"}${location}`;
  }

  return location;
}

/**
 * Gets source locations for multiple elements at once
 *
 * @param elements - Array of DOM elements
 * @returns Array of source location results
 */
export function getSourceLocations(elements: HTMLElement[]): SourceLocationResult[] {
  return elements.map((element) => getSourceLocation(element));
}

/**
 * Finds the nearest React component ancestor that has source info
 *
 * Useful when clicking on a deeply nested element (like text or an icon)
 * and wanting to find the component that contains it.
 *
 * @param element - Starting DOM element
 * @param maxAncestors - Maximum DOM ancestors to check (default: 10)
 * @returns Source location result
 */
export function findNearestComponentSource(
  element: HTMLElement,
  maxAncestors = 10
): SourceLocationResult {
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < maxAncestors) {
    const result = getSourceLocation(current);

    // Return first successful result
    if (result.found) {
      return result;
    }

    // If we found fiber but no source, keep looking up DOM
    // (might find a parent component with source info)
    current = current.parentElement;
    depth++;
  }

  // Return result for original element (will explain why not found)
  return getSourceLocation(element);
}

/**
 * Gets all component sources in the ancestor chain
 *
 * Useful for understanding the component hierarchy.
 *
 * @param element - Starting DOM element
 * @returns Array of unique source locations from element up to root
 */
export function getComponentHierarchy(element: HTMLElement): SourceLocation[] {
  const fiber = getFiberFromElement(element);
  if (!fiber) {
    return [];
  }

  const sources: SourceLocation[] = [];
  const seenFiles = new Set<string>();

  let current: ReactFiber | null | undefined = fiber;
  let depth = 0;
  const maxDepth = 100;

  while (current && depth < maxDepth) {
    if (current._debugSource) {
      const key = `${current._debugSource.fileName}:${current._debugSource.lineNumber}`;

      // Avoid duplicates
      if (!seenFiles.has(key)) {
        seenFiles.add(key);
        sources.push({
          fileName: current._debugSource.fileName,
          lineNumber: current._debugSource.lineNumber,
          columnNumber: current._debugSource.columnNumber,
          componentName: getComponentName(current) || undefined,
        });
      }
    }

    current = current.return;
    depth++;
  }

  return sources;
}

/**
 * Checks if source location detection is likely to work in the current environment
 *
 * @returns Object describing support status
 */
export function checkSourceLocationSupport(): {
  supported: boolean;
  reason: string;
  suggestions: string[];
} {
  const reactInfo = detectReactApp();

  if (!reactInfo.isReact) {
    return {
      supported: false,
      reason: "No React application detected on this page",
      suggestions: [
        "Ensure you're on a page built with React",
        "The page may use a different framework (Vue, Angular, etc.)",
      ],
    };
  }

  if (reactInfo.isProduction) {
    return {
      supported: false,
      reason: "Production build detected - source info is stripped",
      suggestions: [
        "Run the application in development mode",
        "Set NODE_ENV=development",
        "Ensure your bundler includes source info in development",
      ],
    };
  }

  // Check for DevTools
  const hasDevTools = typeof window !== "undefined" &&
    !!(window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;

  if (!hasDevTools) {
    return {
      supported: true,
      reason: "Development mode detected, but React DevTools not installed",
      suggestions: [
        "Install React DevTools browser extension for best results",
        "Source detection may still work without it",
      ],
    };
  }

  return {
    supported: true,
    reason: `React ${reactInfo.version || "unknown"} development mode detected`,
    suggestions: [],
  };
}
