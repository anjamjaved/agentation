import { createRoot } from "react-dom/client";
import { Agentation } from "../src";

const shell = new URLSearchParams(location.search).has("shell");
document.documentElement.classList.toggle("shell", shell);

function Rows({ label, count }: { label: string; count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="row" data-testid={`${label}-${i + 1}`}>
          {label} row {i + 1}
        </div>
      ))}
    </>
  );
}

function Playground() {
  return (
    <main>
      <h1>Scroll containers</h1>
      <p>
        Annotate something inside each box, then scroll that box. The marker should stay on its
        element, then wait on the box's edge once the element scrolls out. Click it to scroll back.
      </p>
      <nav>
        <a href="?">Document scroll</a>
        <a href="?shell">App shell (main scrolls, body doesn't)</a>
      </nav>

      <section>
        <h2>1. Page content (baseline)</h2>
        <div className="card" data-testid="page-card">
          A plain card in the document flow.
        </div>
      </section>

      <section>
        <h2>2. Vertical scroll container</h2>
        <div className="scroller v-scroll" data-testid="v-scroll">
          <Rows label="vertical" count={30} />
        </div>
      </section>

      <section>
        <h2>3. Horizontal scroll container</h2>
        <div className="scroller h-scroll" data-testid="h-scroll">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="card" data-testid={`horizontal-${i + 1}`}>
              Card {i + 1}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>4. Nested scroll containers</h2>
        <div className="scroller nested-outer" data-testid="nested-outer">
          <p>Outer box. Scroll down to find the inner box.</p>
          <div className="scroller nested-inner" data-testid="nested-inner">
            <Rows label="nested" count={20} />
          </div>
        </div>
      </section>

      <section>
        <h2>5. Fixed panel with its own scroll</h2>
        <p>The panel pinned to the right of the viewport.</p>
        <div className="scroller fixed-panel" data-testid="fixed-panel">
          <Rows label="fixed" count={20} />
        </div>
      </section>

      <div className="spacer">Spacer so the document (or main) scrolls too</div>

      <Agentation />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Playground />);
