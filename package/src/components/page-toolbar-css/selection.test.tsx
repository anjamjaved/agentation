import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PageFeedbackToolbarCSS } from "./index";
import { getStorageKey } from "../../utils/storage";
import { StrictMode } from "react";

const originalPoint = document.elementFromPoint;
const originalStack = document.elementsFromPoint;
const root = () => document.querySelector('agentation-toolbar')!.shadowRoot! as unknown as HTMLElement;
const popup = () => root().querySelector('[data-annotation-popup]');
const outlineCount = () => root().querySelectorAll('[class*="SelectOutline"]').length;
const activate = () => fireEvent.keyDown(document, { key: 'f', ctrlKey: true, shiftKey: true });
function point(element: HTMLElement) {
  document.elementFromPoint = () => element;
  document.elementsFromPoint = () => [element, document.body];
}
function rect(element: Element, x: number, y: number, w = 80, h = 30) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(x, y, w, h));
}
function fixture() {
  const onHostClick = vi.fn();
  const onAnnotationAdd = vi.fn();
  render(<><div onClick={onHostClick}><p>Alpha</p><p>Beta</p><p>Gamma</p><div data-testid="empty" /></div><PageFeedbackToolbarCSS onAnnotationAdd={onAnnotationAdd} /></>);
  const alpha = screen.getByText('Alpha');
  const beta = screen.getByText('Beta');
  const gamma = screen.getByText('Gamma');
  rect(alpha, 10, 10); rect(beta, 110, 10); rect(gamma, 210, 10);
  return { alpha, beta, gamma, onHostClick, onAnnotationAdd };
}
function select(element: HTMLElement, flags = { metaKey: true }) {
  point(element); fireEvent.click(element, { ...flags, clientX: 15, clientY: 15 });
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() }, userAgent: 'test-agent' });
});
afterEach(() => {
  cleanup(); document.elementFromPoint = originalPoint; document.elementsFromPoint = originalStack;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('combined selection', () => {
  it('keeps a text selection marker beside the selection after document scrolling in Strict Mode', () => {
    render(<StrictMode><p>Hover over elements</p><PageFeedbackToolbarCSS /></StrictMode>);
    const target = screen.getByText('Hover over elements');
    rect(target, 100, 200, 200, 25);
    point(target);
    activate();
    vi.stubGlobal('scrollY', 350);
    fireEvent.scroll(document);
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'over elements' } as Selection);
    fireEvent.click(target, { clientX: 250, clientY: 210 });
    expect(popup()?.textContent).toContain('over elements');
    const marker = root().querySelector<HTMLElement>('[class*="pending"]')!;
    expect(Number.parseFloat(marker.style.top) - window.scrollY).toBe(210);
    vi.stubGlobal('scrollY', 400);
    fireEvent.scroll(document);
    expect(Number.parseFloat(marker.style.top) - window.scrollY).toBe(160);
  });

  it('keeps a marker on a target inside a scrolling container and pins it to the edge once scrolled out', () => {
    render(<><div data-testid="list" style={{ overflowY: 'auto' }}><p>Row</p></div><PageFeedbackToolbarCSS /></>);
    const list = screen.getByTestId('list');
    const row = screen.getByText('Row');
    rect(list, 0, 100, 400, 200);
    Object.defineProperties(list, { clientWidth: { value: 400 }, clientHeight: { value: 200 }, scrollHeight: { value: 800 } });
    rect(row, 0, 150, 400, 30);
    point(row);
    activate();
    fireEvent.click(row, { clientX: 20, clientY: 160 });
    const marker = () => root().querySelector<HTMLElement>('[data-annotation-pending]');
    expect(Number.parseFloat(marker()!.style.top)).toBe(160);
    list.scrollTop = 40;
    fireEvent.scroll(list);
    expect(Number.parseFloat(marker()!.style.top)).toBe(120);
    list.scrollTop = 100;
    fireEvent.scroll(list);
    expect(marker()!.dataset.pinned).toBe('top');
    expect(Number.parseFloat(marker()!.style.top)).toBe(113);
  });

  it('scrolls a pinned marker\'s target back into view instead of editing it', () => {
    localStorage.setItem(getStorageKey(window.location.pathname), JSON.stringify([{
      id: 'a', x: 5, y: 150, comment: 'Note', element: 'Row', elementPath: 'p', timestamp: Date.now(),
      boundingBox: { x: 0, y: 140, width: 400, height: 30 },
      scrollContainer: { selector: ['#list'], x: 0, y: 100 },
    }]));
    render(<><div id="list" style={{ overflowY: 'auto' }}><p>Row</p></div><PageFeedbackToolbarCSS /></>);
    const list = document.getElementById('list')!;
    rect(list, 0, 100, 400, 200);
    Object.defineProperties(list, { clientWidth: { value: 400 }, clientHeight: { value: 200 }, scrollHeight: { value: 800 } });
    list.scrollBy = vi.fn();
    activate();
    list.scrollTop = 100;
    fireEvent.scroll(list);
    const marker = root().querySelector<HTMLElement>('[data-annotation-marker]')!;
    expect(marker.dataset.pinned).toBe('top');
    expect(marker.getAttribute('aria-label')).toBe('Scroll to annotation 1: Row');
    fireEvent.click(marker);
    expect(list.scrollBy).toHaveBeenCalledWith({ left: 0, top: -150, behavior: 'smooth' });
    expect(root().querySelector('[data-state="edit"]')).toBeNull();
  });

  it('keeps measured hover labels inside both viewport axes', () => {
    const {alpha} = fixture();
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.className?.includes('hoverTooltip') ? 280 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.className?.includes('hoverTooltip') ? 44 : 0;
    });
    activate(); point(alpha);
    for (const [x,y] of [[window.innerWidth-1, 20], [1,1], [window.innerWidth-1,window.innerHeight-1]]) {
      fireEvent.mouseMove(alpha,{clientX:x,clientY:y});
      const tooltip = root().querySelector('[class*="hoverTooltip"]') as HTMLElement;
      expect(Number.parseFloat(tooltip.style.left)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(tooltip.style.left)+280).toBeLessThanOrEqual(window.innerWidth-8);
      expect(Number.parseFloat(tooltip.style.top)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(tooltip.style.top)+44).toBeLessThanOrEqual(window.innerHeight-8);
    }
  });

  it('repositions a visible hover label when the viewport shrinks without pointer movement', () => {
    const {alpha} = fixture();
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(44);
    activate(); point(alpha);
    fireEvent.mouseMove(alpha,{clientX:window.innerWidth-1,clientY:window.innerHeight-1});
    vi.stubGlobal('innerWidth',480);vi.stubGlobal('innerHeight',400);
    fireEvent.resize(window);
    const tooltip = root().querySelector('[class*="hoverTooltip"]') as HTMLElement;
    expect(Number.parseFloat(tooltip.style.left)+280).toBeLessThanOrEqual(472);
    expect(Number.parseFloat(tooltip.style.top)+44).toBeLessThanOrEqual(392);
  });

  it.each(['Meta', 'Control'])('accumulates with %s held before activation and opens on release', async key => {
    const { alpha, beta, onHostClick, onAnnotationAdd } = fixture();
    activate();
    const flags = key === 'Meta' ? { metaKey: true } : { ctrlKey: true };
    point(alpha); fireEvent.click(alpha, flags);
    point(beta); fireEvent.click(beta, flags);
    expect(popup()).toBeNull();
    expect(outlineCount()).toBe(2);
    expect(onHostClick).not.toHaveBeenCalled();
    fireEvent.keyUp(document, { key });
    expect(popup()).not.toBeNull();
    expect(popup()!.textContent).toContain('2 elements');
    fireEvent.change(within(root()).getByRole('textbox'), { target: { value: 'Group feedback' } });
    fireEvent.click(within(root()).getByRole('button', { name: 'Add' }));
    expect(onAnnotationAdd).toHaveBeenCalledOnce();
    expect(onAnnotationAdd.mock.calls[0][0]).toMatchObject({ isMultiSelect: true, comment: 'Group feedback' });
    expect(onAnnotationAdd.mock.calls[0][0].elementBoundingBoxes).toHaveLength(2);
    await act(async () => {});
  });

  it('deselects an element and leaves the remaining element as an ordinary annotation', () => {
    const { alpha, beta } = fixture(); activate();
    select(alpha); select(beta); select(alpha);
    expect(outlineCount()).toBe(1);
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()!.textContent).toContain('Beta');
    expect(popup()!.textContent).not.toContain('2 elements');
  });

  it.each(['Escape', 'blur'])('cancels selection on %s without a popup on later key release', cancellation => {
    const { alpha } = fixture(); activate(); select(alpha);
    if (cancellation === 'blur') fireEvent.blur(window);
    else fireEvent.keyDown(document, { key: 'Escape', metaKey: true });
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()).toBeNull(); expect(outlineCount()).toBe(0);
  });

  it('waits for both primary modifiers to be released', () => {
    const { alpha } = fixture(); activate();
    point(alpha); fireEvent.click(alpha, { metaKey: true, ctrlKey: true });
    fireEvent.keyUp(document, { key: 'Control', metaKey: true });
    expect(popup()).toBeNull();
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()).not.toBeNull();
  });

  it.each([false, true])('adds a drag group without losing clicked elements (release during drag: %s)', releaseDuringDrag => {
    const { alpha, beta } = fixture(); activate(); select(alpha);
    point(beta);
    fireEvent.mouseDown(screen.getByTestId('empty'), { clientX: 100, clientY: 5, metaKey: true });
    fireEvent.mouseMove(beta, { clientX: 195, clientY: 50, metaKey: true });
    if (releaseDuringDrag) fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()).toBeNull();
    fireEvent.mouseUp(beta, { clientX: 195, clientY: 50, metaKey: !releaseDuringDrag });
    if (!releaseDuringDrag) {
      expect(popup()).toBeNull(); expect(outlineCount()).toBe(2);
      fireEvent.keyUp(document, { key: 'Meta' });
    }
    expect(popup()!.textContent).toContain('2 elements');
    expect(popup()!.textContent).toContain('Alpha');
    expect(popup()!.textContent).toContain('Beta');
  });

  it('keeps selected elements inside a web component highlighted', async () => {
    fixture();
    const host = document.body.appendChild(document.createElement('aside'));
    const shadow = host.attachShadow({ mode: 'open' });
    const button = shadow.appendChild(document.createElement('button')); button.textContent = 'Shadow button';
    rect(button, 10, 10);
    activate();
    document.elementFromPoint = () => host; document.elementsFromPoint = () => [host];
    Object.defineProperty(shadow, 'elementFromPoint', { value: () => button });
    Object.defineProperty(shadow, 'elementsFromPoint', { value: () => [button, host] });
    fireEvent.click(host, { metaKey: true });
    expect(outlineCount()).toBe(1);
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()!.textContent).toContain('Shadow button');
    await act(async () => { host.remove(); });
  });

  it('does not send the release click of a selection drag to the host', () => {
    const { beta, onHostClick } = fixture(); activate(); point(beta);
    fireEvent.mouseDown(screen.getByTestId('empty'), { clientX: 100, clientY: 5, metaKey: true });
    fireEvent.mouseMove(beta, { clientX: 195, clientY: 50, metaKey: true });
    fireEvent.mouseUp(beta, { clientX: 195, clientY: 50, metaKey: true });
    fireEvent.click(beta, { metaKey: true });
    expect(onHostClick).not.toHaveBeenCalled();
    expect(outlineCount()).toBe(1);
  });

  it('cancels a drag on Escape without creating feedback on mouse release', () => {
    const { beta } = fixture(); activate(); point(beta);
    fireEvent.mouseDown(screen.getByTestId('empty'), { clientX: 100, clientY: 5, metaKey: true });
    fireEvent.mouseMove(beta, { clientX: 195, clientY: 50, metaKey: true });
    fireEvent.keyDown(document, { key: 'Escape', metaKey: true });
    fireEvent.mouseUp(beta, { clientX: 195, clientY: 50 });
    expect(popup()).toBeNull();
    expect(outlineCount()).toBe(0);
  });

  it('changes the highlighted and picked target together when the modifier changes', () => {
    const { alpha } = fixture();
    const overlay = screen.getByTestId('empty'); rect(overlay, 0, 0, 500, 200);
    document.elementFromPoint = () => overlay; document.elementsFromPoint = () => [overlay, alpha];
    activate();
    fireEvent.mouseMove(overlay, { clientX: 20, clientY: 20 });
    const highlight = () => root().querySelector('[class*="hoverHighlight"]') as HTMLElement;
    expect(highlight().style.width).toBe('500px');
    fireEvent.keyDown(document, { key: 'Meta', metaKey: true });
    expect(highlight().style.width).toBe('80px');
    expect(highlight().style.borderStyle).toBe('dashed');
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(highlight().style.width).toBe('500px');
    fireEvent.click(overlay, { metaKey: true, clientX: 20, clientY: 20 });
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()!.textContent).toContain('Alpha');
  });

  it('does not resurrect the previous page hover while the pointer is over the toolbar', () => {
    const { alpha } = fixture(); activate(); point(alpha);
    fireEvent.mouseMove(alpha, { clientX: 20, clientY: 20 });
    const settings = within(root()).getByRole('button', { name: 'Settings' });
    fireEvent.mouseMove(settings, { composed: true });
    fireEvent.keyDown(document, { key: 'Meta', metaKey: true });
    expect(root().querySelector('[class*="hoverHighlight"]')).toBeNull();
  });

  it('filters detached elements before opening the popup', () => {
    const { alpha, beta } = fixture(); activate(); select(alpha); select(beta);
    // Host removal is independent of React here; restore for React cleanup.
    const parent = alpha.parentNode!; const next = alpha.nextSibling;
    alpha.remove();
    fireEvent.keyUp(document, { key: 'Meta' });
    expect(popup()!.textContent).toContain('Beta');
    expect(popup()!.textContent).not.toContain('2 elements');
    parent.insertBefore(alpha, next);
  });
});
