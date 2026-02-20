import { act, render, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HighlightOptions, HighlightResult } from "../lib/plugin-types";

// Helper for controllable promise (to avoid arbitrary delays)
const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

describe("Code block loading behavior", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("../lib/code-block/highlighted-body");
  });

  it("renders readable text and no loader before lazy module resolves", async () => {
    const lazyModule = createDeferred<{
      HighlightedCodeBlockBody: ComponentType<{
        code: string;
        language: string;
        raw: HighlightResult;
      }>;
    }>();

    // mock the targeted part that MUST be lazyloaded
    let lazyLoaded = false;
    vi.doMock("../lib/code-block/highlighted-body", () =>
      lazyModule.promise.then((mod) => {
        lazyLoaded = true;
        return mod;
      })
    );

    const { StreamdownContext } = await import("../index");
    const { CodeBlock } = await import("../lib/code-block");

    const { container } = render(
      <StreamdownContext.Provider
        value={{
          shikiTheme: ["github-light", "github-dark"],
          controls: true,
          isAnimating: false,
          mode: "streaming",
        }}
      >
        <CodeBlock code={"const x = 1;\n"} language="javascript" />
      </StreamdownContext.Provider>
    );

    // Before Highlighter lazy component loads we already see text content and no loader
    const body = container.querySelector('[data-streamdown="code-block-body"]');
    expect(body?.textContent).toContain("const x = 1;");
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(lazyLoaded).toBe(false);

    // trigger mocked lazyload resolve
    lazyModule.resolve({
      HighlightedCodeBlockBody: () => (
        <pre data-streamdown="code-block-body">lazy module resolved</pre>
      ),
    });

    await waitFor(() => {
      expect(container.textContent).toContain("lazy module resolved");
      expect(lazyLoaded).toBe(true);
    });
  });

  it("applies highlight styles only after manual callback resolution", async () => {
    const { StreamdownContext } = await import("../index");
    const { PluginContext } = await import("../lib/plugin-context");
    const { HighlightedCodeBlockBody } = await import(
      "../lib/code-block/highlighted-body"
    );

    // keep external ref to trigger manually
    let resolveHighlight: ((result: HighlightResult) => void) | null = null;

    const rawResult: HighlightResult = {
      bg: "transparent",
      fg: "inherit",
      tokens: [
        [
          {
            content: "const x = 1;",
            color: "inherit",
            bgColor: "transparent",
            htmlStyle: {},
            offset: 0,
          },
        ],
      ],
    };

    const highlightedResult: HighlightResult = {
      ...rawResult,
      tokens: [
        [
          {
            ...rawResult.tokens[0][0],
            color: "#ff0000",
          },
        ],
      ],
    };

    const codePlugin = {
      name: "shiki" as const,
      type: "code-highlighter" as const,
      highlight: vi.fn(
        (_: HighlightOptions, callback?: (result: HighlightResult) => void) => {
          resolveHighlight = callback ?? null;
          return null;
        }
      ),
      supportsLanguage: vi.fn().mockReturnValue(true),
      getSupportedLanguages: vi.fn().mockReturnValue(["javascript"]),
      getThemes: vi.fn().mockReturnValue(["github-light", "github-dark"]),
    };

    const { container } = render(
      <PluginContext.Provider value={{ code: codePlugin as any }}>
        <StreamdownContext.Provider
          value={{
            shikiTheme: ["github-light", "github-dark"],
            controls: true,
            isAnimating: false,
            mode: "streaming",
          }}
        >
          <HighlightedCodeBlockBody
            code="const x = 1;"
            language="javascript"
            raw={rawResult}
          />
        </StreamdownContext.Provider>
      </PluginContext.Provider>
    );

    const initialToken = container.querySelector(
      '[data-streamdown="code-block-body"] code > span > span'
    ) as HTMLElement | null;
    expect(initialToken).toBeTruthy();
    expect(initialToken?.style.getPropertyValue("--sdm-c")).toBe("inherit");

    await waitFor(() => {
      expect(codePlugin.highlight).toHaveBeenCalledTimes(1);
      expect(resolveHighlight).toBeTruthy();
    });

    // Manually trigger the highlighting
    await act(async () => {
      resolveHighlight?.(highlightedResult);
    });

    await waitFor(() => {
      const updatedToken = container.querySelector(
        '[data-streamdown="code-block-body"] code > span > span'
      ) as HTMLElement | null;
      expect(updatedToken?.style.getPropertyValue("--sdm-c")).toBe("#ff0000");
    });
  });

  it("does not de-highlight on cache miss after first highlight (stable highlight)", async () => {
    const { StreamdownContext } = await import("../index");
    const { PluginContext } = await import("../lib/plugin-context");
    const { HighlightedCodeBlockBody } = await import(
      "../lib/code-block/highlighted-body"
    );

    const rawResult: HighlightResult = {
      bg: "transparent",
      fg: "inherit",
      tokens: [
        [
          {
            content: "const x = 1;",
            color: "inherit",
            bgColor: "transparent",
            htmlStyle: {},
            offset: 0,
          },
        ],
      ],
    };

    const highlightedResult: HighlightResult = {
      ...rawResult,
      tokens: [
        [
          {
            ...rawResult.tokens[0][0],
            color: "#ff0000",
          },
        ],
      ],
    };

    let currentCallback: ((result: HighlightResult) => void) | null = null;

    const codePlugin = {
      name: "shiki" as const,
      type: "code-highlighter" as const,
      highlight: vi.fn(
        (_: HighlightOptions, callback?: (result: HighlightResult) => void) => {
          currentCallback = callback ?? null;
          // Return null to simulate cache miss (async path)
          return null;
        }
      ),
      supportsLanguage: vi.fn().mockReturnValue(true),
      getSupportedLanguages: vi.fn().mockReturnValue(["javascript"]),
      getThemes: vi.fn().mockReturnValue(["github-light", "github-dark"]),
    };

    const { container, rerender } = render(
      <PluginContext.Provider value={{ code: codePlugin as any }}>
        <StreamdownContext.Provider
          value={{
            shikiTheme: ["github-light", "github-dark"],
            controls: true,
            isAnimating: false,
            mode: "streaming",
          }}
        >
          <HighlightedCodeBlockBody
            code="const x = 1;"
            language="javascript"
            raw={rawResult}
          />
        </StreamdownContext.Provider>
      </PluginContext.Provider>
    );

    // Initially should show raw (inherit color)
    await waitFor(() => {
      const token = container.querySelector(
        '[data-streamdown="code-block-body"] code > span > span'
      ) as HTMLElement | null;
      expect(token?.style.getPropertyValue("--sdm-c")).toBe("inherit");
    });

    // First highlight arrives
    await act(async () => {
      currentCallback?.(highlightedResult);
    });

    // Now should show highlighted (red)
    await waitFor(() => {
      const token = container.querySelector(
        '[data-streamdown="code-block-body"] code > span > span'
      ) as HTMLElement | null;
      expect(token?.style.getPropertyValue("--sdm-c")).toBe("#ff0000");
    });

    // Simulate streaming: update code (triggers new highlight request)
    rerender(
      <PluginContext.Provider value={{ code: codePlugin as any }}>
        <StreamdownContext.Provider
          value={{
            shikiTheme: ["github-light", "github-dark"],
            controls: true,
            isAnimating: false,
            mode: "streaming",
          }}
        >
          <HighlightedCodeBlockBody
            code="const x = 1; const y = 2;"
            language="javascript"
            raw={rawResult}
          />
        </StreamdownContext.Provider>
      </PluginContext.Provider>
    );

    // Should NOT de-highlight while waiting for new highlight (cache miss)
    // The color should still be red (previous highlight), not inherit
    const tokenAfterRerender = container.querySelector(
      '[data-streamdown="code-block-body"] code > span > span'
    ) as HTMLElement | null;
    expect(tokenAfterRerender?.style.getPropertyValue("--sdm-c")).toBe(
      "#ff0000"
    );
  });

  it("ignores stale callbacks (out-of-order highlight responses)", async () => {
    const { StreamdownContext } = await import("../index");
    const { PluginContext } = await import("../lib/plugin-context");
    const { HighlightedCodeBlockBody } = await import(
      "../lib/code-block/highlighted-body"
    );

    const rawResult: HighlightResult = {
      bg: "transparent",
      fg: "inherit",
      tokens: [
        [
          {
            content: "const x = 1;",
            color: "inherit",
            bgColor: "transparent",
            htmlStyle: {},
            offset: 0,
          },
        ],
      ],
    };

    const oldHighlight: HighlightResult = {
      ...rawResult,
      tokens: [
        [
          {
            ...rawResult.tokens[0][0],
            color: "#ff0000", // Old: red
          },
        ],
      ],
    };

    const newHighlight: HighlightResult = {
      ...rawResult,
      tokens: [
        [
          {
            ...rawResult.tokens[0][0],
            color: "#00ff00", // New: green
          },
        ],
      ],
    };

    const callbacks: Array<(result: HighlightResult) => void> = [];

    const codePlugin = {
      name: "shiki" as const,
      type: "code-highlighter" as const,
      highlight: vi.fn(
        (_: HighlightOptions, callback?: (result: HighlightResult) => void) => {
          if (callback) {
            callbacks.push(callback);
          }
          return null;
        }
      ),
      supportsLanguage: vi.fn().mockReturnValue(true),
      getSupportedLanguages: vi.fn().mockReturnValue(["javascript"]),
      getThemes: vi.fn().mockReturnValue(["github-light", "github-dark"]),
    };

    const { container, rerender } = render(
      <PluginContext.Provider value={{ code: codePlugin as any }}>
        <StreamdownContext.Provider
          value={{
            shikiTheme: ["github-light", "github-dark"],
            controls: true,
            isAnimating: false,
            mode: "streaming",
          }}
        >
          <HighlightedCodeBlockBody
            code="const x = 1;"
            language="javascript"
            raw={rawResult}
          />
        </StreamdownContext.Provider>
      </PluginContext.Provider>
    );

    // First highlight request made
    await waitFor(() => {
      expect(callbacks.length).toBe(1);
    });

    // Trigger new code before first callback returns
    rerender(
      <PluginContext.Provider value={{ code: codePlugin as any }}>
        <StreamdownContext.Provider
          value={{
            shikiTheme: ["github-light", "github-dark"],
            controls: true,
            isAnimating: false,
            mode: "streaming",
          }}
        >
          <HighlightedCodeBlockBody
            code="const x = 2;"
            language="javascript"
            raw={rawResult}
          />
        </StreamdownContext.Provider>
      </PluginContext.Provider>
    );

    // Second highlight request made
    await waitFor(() => {
      expect(callbacks.length).toBe(2);
    });

    // Second callback resolves first (newer highlight: green)
    await act(async () => {
      callbacks[1](newHighlight);
    });

    // Should show green (newer)
    await waitFor(() => {
      const token = container.querySelector(
        '[data-streamdown="code-block-body"] code > span > span'
      ) as HTMLElement | null;
      expect(token?.style.getPropertyValue("--sdm-c")).toBe("#00ff00");
    });

    // First (stale) callback resolves (older highlight: red)
    await act(async () => {
      callbacks[0](oldHighlight);
    });

    // Should STILL show green (newer), not red (stale)
    const token = container.querySelector(
      '[data-streamdown="code-block-body"] code > span > span'
    ) as HTMLElement | null;
    expect(token?.style.getPropertyValue("--sdm-c")).toBe("#00ff00");
  });
});
