import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSourceLocation } from "./source-location";

// React 19 fibers carry `_debugStack` (where the JSX was created) instead of
// `_debugSource`. These tests serve fake dev-server modules with inline source
// maps and check that the creation frame is mapped back to the original line.

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

/**
 * A served module whose generated `line` (1-indexed) maps, from column 0, to
 * `sourceLine`/`sourceColumn` (1-indexed / 0-indexed) of `source`.
 */
function moduleWithMap(source: string, line: number, sourceLine: number, sourceColumn: number) {
  const mappings = ";".repeat(line - 1) + vlq(0) + vlq(0) + vlq(sourceLine - 1) + vlq(sourceColumn);
  const map = { version: 3, sources: [source], mappings };
  return `// generated\n//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}\n`;
}

let served: Record<string, string> = {};

beforeEach(() => {
  served = {};
  vi.stubGlobal(
    "XMLHttpRequest",
    class {
      status = 0;
      responseText = "";
      private url = "";
      open(_method: string, url: string) {
        this.url = url;
      }
      send() {
        const body = served[this.url];
        this.status = body === undefined ? 404 : 200;
        this.responseText = body ?? "";
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function creationStack(...frames: string[]) {
  return { stack: ["Error: react-stack-top-frame", ...frames.map((f) => `    at ${f}`)].join("\n") };
}

it("maps the element's creation frame to its original line", () => {
  served["http://localhost:5173/src/Hero.tsx?t=1"] = moduleWithMap("Hero.tsx", 88, 117, 8);

  const owner = { type: function Hero() {}, tag: 0 };
  const element = document.createElement("h1");
  Object.assign(element, {
    __reactFiber$a: {
      type: "h1",
      tag: 5,
      _debugOwner: owner,
      _debugStack: creationStack(
        "exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:12)",
        "Hero (http://localhost:5173/src/Hero.tsx?t=1:88:24)",
      ),
      return: owner,
    },
  });

  expect(getSourceLocation(element)).toMatchObject({
    found: true,
    source: { fileName: "src/Hero.tsx", lineNumber: 117, columnNumber: 8, componentName: "Hero" },
  });
});

it("walks past library-created elements to the owner that rendered them", () => {
  served["http://localhost:5173/src/Nav.tsx"] = moduleWithMap("Nav.tsx", 40, 61, 10);

  const nav = { type: function Nav() {}, tag: 0 };
  const link = {
    type: function Link() {},
    tag: 11,
    _debugOwner: nav,
    _debugStack: creationStack("Nav (http://localhost:5173/src/Nav.tsx:40:7)"),
  };
  const element = document.createElement("a");
  Object.assign(element, {
    __reactFiber$b: {
      type: "a",
      tag: 5,
      _debugOwner: link,
      _debugStack: creationStack("Link (http://localhost:5173/node_modules/.vite/deps/router.js?v=1:862:17)"),
      return: link,
    },
  });

  expect(getSourceLocation(element)).toMatchObject({
    found: true,
    source: { fileName: "src/Nav.tsx", lineNumber: 61, componentName: "Nav" },
  });
});

it("falls back when the module has no source map", () => {
  served["http://localhost:5173/src/Plain.tsx"] = "// no map\n";

  const element = document.createElement("div");
  Object.assign(element, {
    __reactFiber$c: {
      type: "div",
      tag: 5,
      _debugStack: creationStack("Plain (http://localhost:5173/src/Plain.tsx:3:5)"),
      return: null,
    },
  });

  expect(getSourceLocation(element).found).toBe(false);
});

it("reports files Vite serves from outside its root by absolute path", () => {
  served["http://localhost:5173/@fs/repo/packages/ui/Card.tsx"] = moduleWithMap("Card.tsx", 12, 30, 4);

  const element = document.createElement("section");
  Object.assign(element, {
    __reactFiber$d: {
      type: "section",
      tag: 5,
      _debugStack: creationStack("Card (http://localhost:5173/@fs/repo/packages/ui/Card.tsx:12:9)"),
      return: null,
    },
  });

  expect(getSourceLocation(element)).toMatchObject({
    found: true,
    source: { fileName: "/repo/packages/ui/Card.tsx", lineNumber: 30 },
  });
});
