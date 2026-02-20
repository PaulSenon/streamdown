import {
  type HTMLAttributes,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { BundledLanguage } from "shiki";
import { StreamdownContext } from "../../index";
import { useCodePlugin } from "../plugin-context";
import type { HighlightResult } from "../plugin-types";
import { CodeBlockBody } from "./body";

type HighlightedCodeBlockBodyProps = HTMLAttributes<HTMLPreElement> & {
  code: string;
  language: string;
  raw: HighlightResult;
};

export const HighlightedCodeBlockBody = ({
  code,
  language,
  raw,
  className,
  ...rest
}: HighlightedCodeBlockBodyProps) => {
  const { shikiTheme } = useContext(StreamdownContext);
  const codePlugin = useCodePlugin();

  // Track if we've ever received a highlighted result.
  // Once true, we never de-highlight again (stable highlight strategy).
  const hasReceivedHighlightRef = useRef(false);

  // Request ID to guard against stale async callbacks.
  // Incremented on each effect run; callbacks only apply if requestId matches.
  const requestIdRef = useRef(0);

  // Current display result.
  const [result, setResult] = useState<HighlightResult>(raw);

  useEffect(() => {
    if (!codePlugin) {
      // No plugin: always show raw, reset highlight flag.
      setResult(raw);
      hasReceivedHighlightRef.current = false;
      return;
    }

    // Increment request ID for this highlight attempt.
    const currentRequestId = ++requestIdRef.current;

    const cachedResult = codePlugin.highlight(
      {
        code,
        language: language as BundledLanguage,
        themes: shikiTheme,
      },
      (highlightedResult) => {
        // Guard: ignore callbacks from stale/out-of-order requests.
        if (currentRequestId !== requestIdRef.current) {
          return;
        }
        hasReceivedHighlightRef.current = true;
        setResult(highlightedResult);
      }
    );

    if (cachedResult) {
      // Synchronous cache hit: update immediately.
      hasReceivedHighlightRef.current = true;
      setResult(cachedResult);
      return;
    }

    // Cache miss:
    // - If we already have a highlight, keep it (don't de-highlight).
    // - If this is the first time (no highlight yet), fall back to raw.
    if (!hasReceivedHighlightRef.current) {
      setResult(raw);
    }
    // If hasReceivedHighlightRef.current is true, we intentionally do NOT
    // call setResult(raw) to avoid the de-highlight flicker.
  }, [code, language, shikiTheme, codePlugin, raw]);

  return (
    <CodeBlockBody
      className={className}
      language={language}
      result={result}
      {...rest}
    />
  );
};
