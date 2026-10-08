import type { Annotation } from "../types";
import { isShadowRoot } from "./frame-dom";

/**
 * Annotations store page coordinates, which only follow document scrolling.
 * For targets inside a scrollable element (a list, a panel, an app shell's
 * <main>), we remember that element and where its scrolled content started,
 * then shift the stored coordinates by however far that content has moved.
 */

type ScrollAnnotation = Pick<
  Annotation,
  "scrollContainer" | "x" | "y" | "isFixed" | "boundingBox" | "elementBoundingBoxes"
>;
type Box = { x: number; y: number; width: number; height: number };

const SCROLLABLE = new Set(["auto", "scroll", "overlay", "hidden"]);
const CLIPPING = new Set([...SCROLLABLE, "clip"]);
const SIMPLE_ID = /^[A-Za-z_][\w-]*$/;

function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return isShadowRoot(root) ? root.host : null;
}

function composedContains(ancestor: Element, node: Element): boolean {
  for (let current: Element | null = node; current; current = composedParent(current))
    if (current === ancestor) return true;
  return false;
}

/** <html> and <body> scroll the viewport, which page coordinates already cover. */
function isPageRoot(element: Element): boolean {
  const doc = element.ownerDocument;
  return element === doc.documentElement || element === doc.body;
}

function isScrollContainer(element: Element): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return (
    (SCROLLABLE.has(style.overflowY) && element.scrollHeight > element.clientHeight) ||
    (SCROLLABLE.has(style.overflowX) && element.scrollWidth > element.clientWidth)
  );
}

function clipsContent(element: Element): boolean {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  return CLIPPING.has(style.overflowX) || CLIPPING.has(style.overflowY);
}

/** One selector per (shadow) root, verified to find this element again. */
function selectorWithinRoot(element: Element): string | null {
  const root = element.getRootNode() as Document | ShadowRoot;
  const steps: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const tag = current.localName;
    if (current.id && SIMPLE_ID.test(current.id) && root.querySelectorAll(`#${current.id}`).length === 1) {
      steps.unshift(`#${current.id}`);
      break;
    }
    if (root.querySelectorAll(tag).length === 1) {
      steps.unshift(tag);
      break;
    }
    const siblings = current.parentElement?.children ?? (current.parentNode as ParentNode).children;
    steps.unshift(`${tag}:nth-child(${Array.prototype.indexOf.call(siblings, current) + 1})`);
  }
  const selector = steps.join(" > ");
  return root.querySelector(selector) === element ? selector : null;
}

function selectorPath(element: Element): string[] | null {
  const path: string[] = [];
  for (let current: Element | null = element; current; ) {
    const selector = selectorWithinRoot(current);
    if (!selector) return null;
    path.unshift(selector);
    const root = current.getRootNode();
    current = isShadowRoot(root) ? root.host : null;
  }
  return path;
}

function resolveSelectorPath(path: string[], doc: Document): Element | null {
  let scope: Document | ShadowRoot | null = doc;
  let element: Element | null = null;
  for (const selector of path) {
    element = scope?.querySelector(selector) ?? null;
    if (!element) return null;
    scope = element.shadowRoot;
  }
  return element;
}

/** Top-left of the container's scrolled content, in annotation coordinates. */
function contentOrigin(container: Element, isFixed: boolean | undefined) {
  const rect = container.getBoundingClientRect();
  return {
    x: rect.left + container.clientLeft - container.scrollLeft,
    y:
      rect.top + container.clientTop - container.scrollTop +
      (isFixed ? 0 : container.ownerDocument.defaultView!.scrollY),
  };
}

/** The container and every ancestor that clips it, innermost first. */
function clippingChain(container: Element): Element[] {
  const chain: Element[] = [];
  for (let current: Element | null = container; current && !isPageRoot(current); current = composedParent(current))
    if (current === container || clipsContent(current)) chain.push(current);
  return chain;
}

/** Where an element shows its content (padding box), in viewport px. */
function clientArea(element: Element): DOMRect {
  const rect = element.getBoundingClientRect();
  return new DOMRect(rect.left + element.clientLeft, rect.top + element.clientTop, element.clientWidth, element.clientHeight);
}

function intersect(rects: DOMRect[]): DOMRect {
  const left = Math.max(...rects.map((rect) => rect.left)), top = Math.max(...rects.map((rect) => rect.top));
  const right = Math.min(...rects.map((rect) => rect.right)), bottom = Math.min(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}

/**
 * Finds the innermost scroll container holding every target and records where
 * its content started. Targets in iframes keep using the frame projection.
 */
export function captureScrollContainer(
  targets: Element[],
  isFixed: boolean | undefined,
  root: Document = document,
): Annotation["scrollContainer"] {
  const [first, ...rest] = targets;
  if (!first || targets.some((target) => target.ownerDocument !== root)) return undefined;
  for (let current = composedParent(first); current && !isPageRoot(current); current = composedParent(current)) {
    if (!isScrollContainer(current) || !rest.every((target) => composedContains(current!, target)))
      continue;
    const selector = selectorPath(current);
    if (!selector) return undefined;
    return { selector, ...contentOrigin(current, isFixed) };
  }
  return undefined;
}

function shift(box: Box, dx: number, dy: number): Box {
  return { ...box, x: box.x + dx, y: box.y + dy };
}

export type PinSide = "top" | "bottom" | "left" | "right";

// Keeps a pinned marker (22px, 26px for groups) inside the edge it is held at.
const PIN_INSET = 13;

/**
 * Projects annotations onto their container's current scroll position.
 * Markers scrolled out of view come back as a display copy held at the edge
 * they left through (`pinned`); never save that copy. Returns null while the container is not
 * rendered, and the stored position when it cannot be found.
 * Create one per render so containers are looked up once per render.
 */
export function createScrollProjector(root: Document = document) {
  const containers = new Map<string, { element: Element; clips: DOMRect[]; visible: DOMRect } | null>();
  const lookup = (selector: string[]) => {
    const key = selector.join("\n");
    if (!containers.has(key)) {
      const element = resolveSelectorPath(selector, root);
      const clips = element ? clippingChain(element).map(clientArea) : [];
      containers.set(key, element && { element, clips, visible: intersect(clips) });
    }
    return containers.get(key);
  };

  return <T extends ScrollAnnotation>(annotation: T): { annotation: T; pinned?: PinSide } | null => {
    const context = annotation.scrollContainer;
    if (!context) return { annotation };
    const container = lookup(context.selector);
    if (!container) return { annotation };
    if (container.clips.some((rect) => rect.width <= 0 || rect.height <= 0)) return null;

    const view = root.defaultView!;
    const origin = contentOrigin(container.element, annotation.isFixed);
    const dx = origin.x - context.x, dy = origin.y - context.y;
    const projected: T = dx === 0 && dy === 0 ? annotation : {
      ...annotation,
      x: annotation.x + (dx / view.innerWidth) * 100,
      y: annotation.y + dy,
      boundingBox: annotation.boundingBox && shift(annotation.boundingBox, dx, dy),
      elementBoundingBoxes: annotation.elementBoundingBoxes?.map((box) => shift(box, dx, dy)),
      // Rebased, so saving a projected copy never applies the same scroll twice.
      scrollContainer: { ...context, ...origin },
    };

    const pointX = (projected.x / 100) * view.innerWidth;
    const pointY = annotation.isFixed ? projected.y : projected.y - view.scrollY;
    const { visible } = container;
    if (pointX >= visible.left && pointX <= visible.right && pointY >= visible.top && pointY <= visible.bottom)
      return { annotation: projected };

    // Clamping through each clip in turn lands on the visible area, or on the
    // nearest outer edge when an inner container is itself scrolled away.
    let x = pointX, y = pointY;
    for (const rect of container.clips) {
      x = clamp(x, rect.left + PIN_INSET, rect.right - PIN_INSET);
      y = clamp(y, rect.top + PIN_INSET, rect.bottom - PIN_INSET);
    }
    return {
      annotation: { ...projected, x: (x / view.innerWidth) * 100, y: annotation.isFixed ? y : y + view.scrollY },
      pinned: Math.abs(y - pointY) >= Math.abs(x - pointX)
        ? y > pointY ? "top" : "bottom"
        : x > pointX ? "left" : "right",
    };
  };
}

/**
 * Scrolls the annotation's container, and any clipping ancestors, so its
 * marker point lands in the middle of what is visible. Expects the saved
 * annotation, not a pinned display copy.
 */
export function revealInScrollContainer(annotation: ScrollAnnotation, root: Document = document): boolean {
  const context = annotation.scrollContainer;
  const container = context && resolveSelectorPath(context.selector, root);
  if (!container) return false;
  const view = root.defaultView!;
  const origin = contentOrigin(container, annotation.isFixed);
  let x = (annotation.x / 100) * view.innerWidth + origin.x - context.x;
  let y = (annotation.isFixed ? annotation.y : annotation.y - view.scrollY) + origin.y - context.y;
  const behavior = view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  for (const element of clippingChain(container)) {
    const area = intersect([clientArea(element), new DOMRect(0, 0, view.innerWidth, view.innerHeight)]);
    const left = x < area.left || x > area.right ? x - (area.left + area.width / 2) : 0;
    const top = y < area.top || y > area.bottom ? y - (area.top + area.height / 2) : 0;
    if (!left && !top) continue;
    element.scrollBy({ left, top, behavior });
    x -= left;
    y -= top;
  }
  return true;
}
