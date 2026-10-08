import { afterEach, describe, expect, it, vi } from "vitest";
import { captureScrollContainer, createScrollProjector, revealInScrollContainer } from "./scroll-containers";
import type { Annotation } from "../types";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom has no layout: give an element a box, a scroll size and a writable scroll offset. */
function scroller(
  element: HTMLElement,
  box: { left: number; top: number; width: number; height: number },
  content = { width: box.width, height: box.height * 4 },
) {
  element.style.overflowY = "auto";
  element.style.overflowX = "auto";
  vi.spyOn(element, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(box.left, box.top, box.width, box.height),
  );
  Object.defineProperties(element, {
    clientLeft: { value: 0, configurable: true },
    clientTop: { value: 0, configurable: true },
    clientWidth: { value: box.width, configurable: true },
    clientHeight: { value: box.height, configurable: true },
    scrollWidth: { value: content.width, configurable: true },
    scrollHeight: { value: content.height, configurable: true },
  });
  return element;
}

function list(count = 10) {
  const container = document.createElement("div");
  for (let i = 0; i < count; i++) {
    const row = document.createElement("p");
    row.textContent = `Row ${i + 1}`;
    container.append(row);
  }
  document.body.append(container);
  return container;
}

function annotation(context: Annotation["scrollContainer"], y = 150): Annotation {
  return {
    id: "a",
    x: 25,
    y,
    comment: "",
    element: "p",
    elementPath: "p",
    timestamp: 0,
    boundingBox: { x: 200, y: y - 10, width: 100, height: 20 },
    scrollContainer: context,
  };
}

describe("scroll container capture", () => {
  it("records the innermost scrollable ancestor and where its content starts", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    container.scrollTop = 40;
    vi.stubGlobal("scrollY", 300);

    const context = captureScrollContainer([container.children[3]], false);

    expect(context).toEqual({ selector: [expect.any(String)], x: 100, y: 100 - 40 + 300 });
    expect(document.querySelector(context!.selector[0])).toBe(container);
  });

  it("uses viewport coordinates for fixed targets", () => {
    const container = scroller(list(), { left: 0, top: 50, width: 200, height: 100 });
    vi.stubGlobal("scrollY", 300);
    expect(captureScrollContainer([container.children[0]], true)?.y).toBe(50);
  });

  it("ignores ancestors that do not actually overflow, and the page itself", () => {
    const container = scroller(list(), { left: 0, top: 0, width: 200, height: 100 }, { width: 200, height: 100 });
    document.body.style.overflowY = "auto";
    expect(captureScrollContainer([container.children[0]], false)).toBeUndefined();
  });

  it("finds the container shared by every target of a multi-select", () => {
    const outer = scroller(document.createElement("section"), { left: 0, top: 0, width: 400, height: 300 });
    const inner = scroller(list(), { left: 0, top: 100, width: 400, height: 100 });
    outer.append(inner, document.createElement("aside"));
    document.body.append(outer);

    const shared = captureScrollContainer([inner.children[0], outer.lastElementChild!], false);
    expect(document.querySelector(shared!.selector[0])).toBe(outer);
    expect(document.querySelector(captureScrollContainer([inner.children[0]], false)!.selector[0])).toBe(inner);
  });

  it("builds one selector per shadow root", () => {
    const host = document.createElement("x-panel");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    const container = scroller(document.createElement("div"), { left: 0, top: 0, width: 200, height: 100 });
    container.append(document.createElement("p"));
    shadow.append(document.createElement("header"), container);

    const context = captureScrollContainer([container.firstElementChild!], false)!;

    expect(context.selector).toHaveLength(2);
    const resolvedHost = document.querySelector(context.selector[0])!;
    expect(resolvedHost).toBe(host);
    expect(resolvedHost.shadowRoot!.querySelector(context.selector[1])).toBe(container);
  });

  it("leaves targets inside frames to the frame projection", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument!.createElement("p");
    frame.contentDocument!.body.append(inner);
    expect(captureScrollContainer([inner], false)).toBeUndefined();
  });
});

const project = (stored: Annotation) => createScrollProjector()(stored);

describe("scroll container projection", () => {
  it("moves markers and boxes with the container's scroll", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));

    container.scrollTop = 30;
    container.scrollLeft = 64;
    const { annotation: projected, pinned } = project(stored)!;

    expect(pinned).toBeUndefined();
    expect(projected.y).toBe(120);
    expect(projected.x).toBeCloseTo(25 - (64 / window.innerWidth) * 100);
    expect(projected.boundingBox).toEqual({ x: 136, y: 110, width: 100, height: 20 });
  });

  it("follows a container that moves because an outer element scrolled", () => {
    const outerBox = { left: 0, top: 0, width: 600, height: 400 };
    const innerBox = { left: 100, top: 100, width: 400, height: 200 };
    const outer = scroller(document.createElement("section"), outerBox);
    const inner = scroller(list(), innerBox);
    outer.append(inner);
    document.body.append(outer);
    const stored = annotation(captureScrollContainer([inner.children[2]], false));

    innerBox.top = 50; // the outer element scrolled by 50
    expect(project(stored)!.annotation.y).toBe(100);
  });

  it("pins a marker scrolled out of view to the edge it left through", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));

    container.scrollTop = 60; // the point is now at y=90, above the box
    const placed = project(stored)!;

    expect(placed.pinned).toBe("top");
    expect(placed.annotation.y).toBe(113);
    expect(placed.annotation.x).toBe(25);
  });

  it("pins sideways when the container scrolls horizontally", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));

    container.scrollLeft = 200;
    const placed = project(stored)!;

    expect(placed.pinned).toBe("left");
    expect((placed.annotation.x / 100) * window.innerWidth).toBeCloseTo(113);
    expect(placed.annotation.y).toBe(150);
  });

  it("pins inside every clipping ancestor", () => {
    const outer = scroller(document.createElement("section"), { left: 0, top: 160, width: 600, height: 400 });
    const inner = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    outer.append(inner);
    document.body.append(outer);

    // y=150 is inside the inner box but above where the outer box starts.
    const placed = project(annotation(captureScrollContainer([inner.children[2]], false)))!;
    expect(placed.pinned).toBe("top");
    expect(placed.annotation.y).toBe(173);
  });

  it("pins to the outer edge when the inner container is scrolled away", () => {
    const outer = scroller(document.createElement("section"), { left: 0, top: 320, width: 600, height: 400 });
    const inner = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    outer.append(inner);
    document.body.append(outer);

    const placed = project(annotation(captureScrollContainer([inner.children[2]], false)))!;
    expect(placed.pinned).toBe("top");
    expect(placed.annotation.y).toBe(333);
  });

  it("drops markers while their container is not rendered", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));
    Object.defineProperties(container, { clientWidth: { value: 0 }, clientHeight: { value: 0 } });
    expect(project(stored)).toBeNull();
  });

  it("is stable when a projected copy is saved and projected again", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false), 250);

    container.scrollTop = 40;
    const saved = project(stored)!.annotation;
    expect(project(saved)!.annotation).toBe(saved);

    container.scrollTop = 0;
    expect(project(saved)!.annotation.y).toBe(250);
  });

  it("keeps the stored position when the container cannot be found", () => {
    const stored = annotation({ selector: ["#missing"], x: 0, y: 0 });
    expect(project(stored)).toEqual({ annotation: stored });
  });

  it("leaves annotations without a container untouched", () => {
    const stored = annotation(undefined);
    expect(project(stored)).toEqual({ annotation: stored });
  });
});

describe("revealing a pinned marker", () => {
  it("scrolls the container so the marker point is centred", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));
    container.scrollBy = vi.fn();

    container.scrollTop = 120; // the point is now at y=30
    expect(revealInScrollContainer(stored)).toBe(true);
    expect(container.scrollBy).toHaveBeenCalledWith({ left: 0, top: -170, behavior: "smooth" });
  });

  it("leaves a container alone when the point is already visible", () => {
    const container = scroller(list(), { left: 100, top: 100, width: 400, height: 200 });
    const stored = annotation(captureScrollContainer([container.children[2]], false));
    container.scrollBy = vi.fn();

    revealInScrollContainer(stored);
    expect(container.scrollBy).not.toHaveBeenCalled();
  });
});
