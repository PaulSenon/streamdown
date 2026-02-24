import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HighlightOptions, HighlightResult } from "../lib/plugin-types";

describe("HighlightedCodeBlockBody transition updates", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock("react");
  });

  it("uses startTransition for async highlight callback updates", async () => {
    const startTransitionMock = vi.fn((callback: () => void) => callback());

    vi.doMock("react", async () => {
      const react = await vi.importActual<typeof import("react")>("react");
      return {
        ...react,
        useTransition: () => [false, startTransitionMock] as const,
      };
    });

    const { StreamdownContext } = await import("../index");
    const { PluginContext } = await import("../lib/plugin-context");
    const { HighlightedCodeBlockBody } = await import(
      "../lib/code-block/highlighted-body"
    );

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

    render(
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

    await waitFor(() => {
      expect(resolveHighlight).toBeTruthy();
    });

    act(() => {
      resolveHighlight?.(highlightedResult);
    });

    expect(startTransitionMock).toHaveBeenCalledTimes(1);
  });
});
