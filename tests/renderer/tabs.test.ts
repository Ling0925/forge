import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs } from "../../src/renderer/components/primitives/Tabs";

const tabs = [
  {
    id: "runtime",
    label: "运行",
    content: createElement("input", { defaultValue: "unsaved runtime input" }),
  },
  {
    id: "resources",
    label: "资源",
    content: createElement("input", {
      defaultValue: "unsaved server arguments",
    }),
  },
];
describe("inspector tab accessibility and retained domains", () => {
  it("retains inactive domain inputs while excluding them from visible navigation", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        tabs,
        activeId: "runtime",
        onChange: () => {},
        keepMounted: true,
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-controls="tabpanel-resources"');
    expect(html).toContain(
      'id="tabpanel-resources" role="tabpanel" aria-labelledby="tab-btn-resources" hidden=""',
    );
    expect(html).toContain('value="unsaved server arguments"');
    expect(html).toContain(
      'aria-selected="true" aria-controls="tabpanel-runtime" tabindex="0"',
    );
  });
  it("keeps the previous lazy-mount behavior for callers that do not retain domains", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, { tabs, activeId: "resources", onChange: () => {} }),
    );
    expect(html).toContain('value="unsaved server arguments"');
    expect(html).not.toContain('value="unsaved runtime input"');
    expect(html).toContain(
      'id="tabpanel-resources" role="tabpanel" aria-labelledby="tab-btn-resources" class="tabpanel"',
    );
  });
});

it("the primitive hidden-panel style wins over its flex display", () => {
  const css = readFileSync(
    "src/renderer/components/primitives/tabs.css",
    "utf8",
  );
  expect(css).toMatch(/\.tabpanel\[hidden\]\s*\{\s*display:\s*none;/);
  expect(css.indexOf(".tabpanel[hidden]")).toBeGreaterThan(
    css.indexOf(".tabpanel {"),
  );
});

it("inactive retained content has an actual non-rendering inline display as well as hidden semantics", () => {
  const html = renderToStaticMarkup(
    createElement(Tabs, {
      tabs,
      activeId: "runtime",
      onChange: () => {},
      keepMounted: true,
    }),
  );
  expect(html).toContain('hidden="" style="display:none" class="tabpanel"');
  expect(html).not.toContain(
    'id="tabpanel-runtime" role="tabpanel" aria-labelledby="tab-btn-runtime" hidden=',
  );
});
