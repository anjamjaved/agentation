import { afterEach, describe, expect, it, vi } from "vitest";
import { annotationElementFromPoint, deepElementFromPoint, parentSelectionTarget, pierceElementFromPoint } from "./hit-testing";

function box(el: Element, width = 100, height = 40) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, width, height));
  return el as HTMLElement;
}
function stack(elements: Element[], root: Document | ShadowRoot = document) {
  Object.defineProperty(root, "elementFromPoint", { configurable: true, value: () => elements[0] ?? null });
  Object.defineProperty(root, "elementsFromPoint", { configurable: true, value: () => elements });
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("deep selection", () => {
  it("keeps ordinary picking intact and selects content through an empty overlay only in deep mode", () => {
    document.body.innerHTML = '<div id="overlay"></div><button>Continue</button>';
    const overlay = box(document.querySelector("div")!, 500, 200);
    const button = box(document.querySelector("button")!);
    stack([overlay, button, document.body]);
    expect(deepElementFromPoint(10, 10)).toBe(overlay);
    expect(pierceElementFromPoint(10, 10)).toBe(button);
  });

  it("can select a visual-only swatch through an empty overlay", () => {
    document.body.innerHTML = '<div id="overlay"></div><div id="swatch"></div>';
    const overlay = box(document.querySelector("#overlay")!, 500, 200);
    const swatch = box(document.querySelector("#swatch")!, 30, 30);
    stack([overlay, swatch, document.body]);
    expect(pierceElementFromPoint(10, 10)).toBe(swatch);
  });

  it("looks through overlays inside an open shadow root", () => {
    const host = document.body.appendChild(document.createElement("section"));
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div></div><button>Inside component</button>';
    const overlay = box(root.querySelector("div")!, 500, 200);
    const button = box(root.querySelector("button")!);
    box(host, 500, 200);
    stack([host, document.body]);
    stack([overlay, button, host], root);
    expect(deepElementFromPoint(10, 10)).toBe(overlay);
    expect(pierceElementFromPoint(10, 10)).toBe(button);
  });

  it("skips invisible shadow content when checkVisibility is unavailable", () => {
    const host = document.body.appendChild(document.createElement("section"));
    host.style.opacity = "0";
    const root = host.attachShadow({ mode: "open" });
    const ghost = box(root.appendChild(document.createElement("button")));
    ghost.textContent = "Hidden";
    const visible = box(document.body.appendChild(document.createElement("button")));
    visible.textContent = "Visible";
    stack([host, visible]);
    stack([ghost, host], root);
    expect(pierceElementFromPoint(10, 10)).toBe(visible);
  });

  it("does not return an invisible ghost as the last resort", () => {
    const ghost = box(document.body.appendChild(document.createElement("div")));
    ghost.style.opacity = "0";
    stack([ghost, document.body, document.documentElement]);
    expect(pierceElementFromPoint(10, 10)).toBeNull();
  });

  it("does not pierce through Agentation controls to the host page", () => {
    document.body.innerHTML = '<div data-feedback-toolbar></div><button>Host</button>';
    const toolbar = box(document.querySelector("div")!, 500, 200);
    const host = box(document.querySelector("button")!);
    stack([toolbar, host]);
    expect(pierceElementFromPoint(10, 10)).toBeNull();
  });

  it("recovers the saved target through the marker and page overlay when editing", () => {
    document.body.innerHTML = '<div data-annotation-marker></div><div id="cover"></div><button>Saved target</button>';
    const marker = box(document.querySelector('[data-annotation-marker]')!, 22, 22);
    const cover = box(document.querySelector('#cover')!, 500, 200);
    const button = box(document.querySelector('button')!);
    stack([marker, cover, button, document.body]);
    expect(annotationElementFromPoint(10, 10, { width: 100, height: 40 })).toBe(button);
    // A real annotation on the wrapper keeps its larger target.
    expect(annotationElementFromPoint(10, 10, { width: 500, height: 200 })).toBe(cover);
    expect(annotationElementFromPoint(10, 10, { width: 10, height: 10 })).toBeNull();
  });
});

describe("parent selection", () => {
  it("climbs one level, crosses shadow hosts and stops at the document body", () => {
    document.body.innerHTML = '<section><p>Alpha</p></section>';
    const section = document.querySelector("section") as HTMLElement;
    const paragraph = document.querySelector("p") as HTMLElement;
    expect(parentSelectionTarget(paragraph)).toBe(section);
    expect(parentSelectionTarget(section)).toBe(document.body);
    expect(parentSelectionTarget(document.body)).toBe(document.body);
    expect(parentSelectionTarget(null)).toBeNull();

    const host = document.body.appendChild(document.createElement("aside"));
    const button = host.attachShadow({ mode: "open" }).appendChild(document.createElement("button"));
    expect(parentSelectionTarget(button)).toBe(host);
  });
});
