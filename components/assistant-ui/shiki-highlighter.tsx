"use client";

import type { FC } from "react";
import { useState, useEffect, useRef, memo, useMemo, useCallback } from "react";
import ShikiHighlighter, { type ShikiHighlighterProps } from "react-shiki";
import type { SyntaxHighlighterProps as AUIProps } from "@assistant-ui/react-markdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";

/**
 * Props for the SyntaxHighlighter component
 */
export type HighlighterProps = Omit<
  ShikiHighlighterProps,
  "children" | "theme"
> & {
  theme?: ShikiHighlighterProps["theme"];
} & Pick<AUIProps, "node" | "components" | "language" | "code">;

// Base styles for code blocks
const baseCodeStyles =
  "overflow-x-auto rounded-none text-sm font-mono whitespace-pre [font-variant-ligatures:none] [tab-size:2]";

const COMPACT_CODE_BLOCK_MAX_LINE_LENGTH = 48;
const COMPACT_CODE_BLOCK_MIN_LINE_COUNT = 2;

function normalizeCode(code: string): string {
  return code.replace(/\r\n/g, "\n");
}

function getCodeBlockLayout(code: string): {
  shouldShrinkToFit: boolean;
  isWhitespaceSensitive: boolean;
} {
  const visibleCode = code.endsWith("\n") ? code.slice(0, -1) : code;
  const lines = visibleCode.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  const longestLineLength = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
  const indentedVisibleLines = lines.filter((line) => /^[ \t]+[^\s]/.test(line)).length;
  const punctuationLedLines = lines.filter((line) => /^[ \t]+[./\\*_|-]/.test(line)).length;

  return {
    shouldShrinkToFit:
      nonEmptyLines.length >= COMPACT_CODE_BLOCK_MIN_LINE_COUNT
      && longestLineLength <= COMPACT_CODE_BLOCK_MAX_LINE_LENGTH,
    isWhitespaceSensitive: indentedVisibleLines >= 2 || punctuationLedLines >= 1,
  };
}

function CopyCodeButton({ code }: { code: string }) {
  const t = useTranslations("assistantUi.codeBlock");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "absolute right-2 top-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium backdrop-blur-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal-cream/40",
        copied
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-500"
          : "border-terminal-cream/20 bg-terminal-cream/[0.06] text-terminal-cream/50 hover:border-terminal-cream/35 hover:bg-terminal-cream/[0.12] hover:text-terminal-cream/80"
      )}
      aria-label={t("copyCode")}
    >
      {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// Minimum code length for syntax highlighting (skip tiny snippets)
const MIN_HIGHLIGHT_LENGTH = 100;

type HighlighterVariant = "assistant" | "user";

interface StreamingHighlighterProps extends HighlighterProps {
  variant: HighlighterVariant;
}

/**
 * StreamingCodeHighlighter - Fully optimized for zero-freeze streaming
 *
 * Strategy:
 * 1. Plain text: 0ms render, always visible/laid out
 * 2. Shiki: Mounts ONLY after 800ms stable code + idle time
 * 3. Overlay swap: No layout shifts/artifacts
 * 4. Skips tiny code blocks (<100 chars)
 */
const StreamingCodeHighlighter: FC<StreamingHighlighterProps> = memo(
  ({
    code,
    language,
    theme = "github-dark",
    className,
    addDefaultStyles = false,
    showLanguage = false,
    variant,
    node: _node,
    components: _components,
    ...props
  }) => {
    const [shikiReady, setShikiReady] = useState(false);
    const [shouldRenderShiki, setShouldRenderShiki] = useState(false);
    const shikiContainerRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debounceRef = useRef<any>(null);
    const idleCallbackRef = useRef<number | null>(null);
    const lastCodeRef = useRef(code);

    const normalizedCode = useMemo(() => normalizeCode(code), [code]);
    const { shouldShrinkToFit, isWhitespaceSensitive } = useMemo(
      () => getCodeBlockLayout(normalizedCode),
      [normalizedCode]
    );
    const syntaxSample = useMemo(() => normalizedCode.trim(), [normalizedCode]);
    const skipHighlighting = syntaxSample.length < MIN_HIGHLIGHT_LENGTH;

    const frameClassName = cn(
      "group relative max-w-full overflow-hidden rounded-lg border shadow-sm",
      variant === "assistant"
        ? "border-terminal-cream/[0.08]"
        : "border-terminal-cream/15",
      shouldShrinkToFit ? "inline-block self-start" : "w-full self-stretch"
    );

    const preSpacingClassName = shouldShrinkToFit
      ? "pb-4 pl-4 pr-20 pt-12"
      : "p-4";

    const preToneClassName = variant === "assistant"
      ? "bg-terminal-dark text-terminal-cream"
      : "bg-terminal-cream/10 text-terminal-cream";

    const plainPreClassName = cn(
      baseCodeStyles,
      preToneClassName,
      preSpacingClassName,
      shouldShrinkToFit ? "w-fit max-w-full" : "w-full",
      isWhitespaceSensitive ? "leading-[1.15]" : "leading-6",
      className
    );

    const shikiPreClassName = cn(
      "aui-shiki-base",
      "[&_pre]:overflow-x-auto [&_pre]:rounded-none [&_pre]:text-sm [&_pre]:font-mono [&_pre]:whitespace-pre [&_pre]:[font-variant-ligatures:none] [&_pre]:[tab-size:2]",
      variant === "assistant"
        ? "[&_pre]:!bg-terminal-dark [&_pre]:!text-terminal-cream"
        : "[&_pre]:!bg-terminal-cream/10 [&_pre]:!text-terminal-cream",
      shouldShrinkToFit ? "[&_pre]:w-fit [&_pre]:max-w-full" : "[&_pre]:w-full",
      shouldShrinkToFit
        ? "[&_pre]:pb-4 [&_pre]:pl-4 [&_pre]:pr-20 [&_pre]:pt-12"
        : "[&_pre]:p-4",
      isWhitespaceSensitive ? "[&_pre]:leading-[1.15]" : "[&_pre]:leading-6",
      className
    );

    // Check if Shiki has rendered content - stable callback
    const checkRendered = useCallback((): boolean => {
      const container = shikiContainerRef.current;
      const preElement = container?.querySelector("pre");
      if (preElement?.textContent && preElement.textContent.length > 0) {
        requestAnimationFrame(() => setShikiReady(true));
        return true;
      }
      return false;
    }, []);

    // Aggressive debounce: 800ms stable before mounting Shiki
    useEffect(() => {
      lastCodeRef.current = normalizedCode;

      // Clear pending timers
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (idleCallbackRef.current && "cancelIdleCallback" in window) {
        cancelIdleCallback(idleCallbackRef.current);
        idleCallbackRef.current = null;
      }

      // Reset on code change
      setShikiReady(false);
      setShouldRenderShiki(false);

      // Skip highlighting for tiny blocks
      if (skipHighlighting) return;

      // Schedule mount with requestIdleCallback for idle-first scheduling
      const scheduleMount = () => {
        if (typeof requestIdleCallback !== "undefined") {
          idleCallbackRef.current = requestIdleCallback(
            () => {
              if (lastCodeRef.current === normalizedCode) {
                setShouldRenderShiki(true);
              }
            },
            { timeout: 800 }
          );
        } else {
          // Fallback for browsers without requestIdleCallback
          debounceRef.current = setTimeout(() => {
            if (lastCodeRef.current === normalizedCode) {
              setShouldRenderShiki(true);
            }
          }, 800);
        }
      };

      // Initial debounce before even trying to schedule
      debounceRef.current = setTimeout(scheduleMount, 800);

      return () => {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        if (idleCallbackRef.current && "cancelIdleCallback" in window) {
          cancelIdleCallback(idleCallbackRef.current);
        }
      };
    }, [normalizedCode, skipHighlighting]);

    // MutationObserver: Detect Shiki content ready
    useEffect(() => {
      if (!shouldRenderShiki || !shikiContainerRef.current || skipHighlighting) {
        return;
      }

      // Check immediately in case Shiki rendered synchronously
      if (checkRendered()) return;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            if (checkRendered()) {
              observer.disconnect();
              break;
            }
          }
        }
      });

      observer.observe(shikiContainerRef.current, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Extended fallback timeout
      const fallbackTimer = setTimeout(() => {
        checkRendered();
        observer.disconnect();
      }, 1000);

      return () => {
        observer.disconnect();
        clearTimeout(fallbackTimer);
      };
    }, [shouldRenderShiki, skipHighlighting, checkRendered]);

    // Simple conditional: show plain code OR Shiki, not both
    if (shikiReady && shouldRenderShiki && !skipHighlighting) {
      // Shiki is ready - show highlighted code
      return (
        <div className={frameClassName}>
          <div ref={shikiContainerRef} className={shikiPreClassName}>
            <ShikiHighlighter
              {...props}
              language={language ?? "plaintext"}
              theme={theme}
              addDefaultStyles={addDefaultStyles}
              showLanguage={showLanguage}
              delay={400}
            >
              {normalizedCode}
            </ShikiHighlighter>
          </div>
          <CopyCodeButton code={normalizedCode} />
        </div>
      );
    }

    // Plain code fallback (during streaming or while Shiki loads)
    return (
      <>
        <div className={frameClassName}>
          <pre className={plainPreClassName}>
            <code>{normalizedCode}</code>
          </pre>
          <CopyCodeButton code={normalizedCode} />
        </div>

        {/* Hidden Shiki container for pre-rendering */}
        {shouldRenderShiki && !skipHighlighting && (
          <div
            ref={shikiContainerRef}
            className="sr-only"
            aria-hidden="true"
          >
            <ShikiHighlighter
              {...props}
              language={language ?? "plaintext"}
              theme={theme}
              addDefaultStyles={addDefaultStyles}
              showLanguage={showLanguage}
              delay={400}
            >
              {normalizedCode}
            </ShikiHighlighter>
          </div>
        )}
      </>
    );
  }
);
StreamingCodeHighlighter.displayName = "StreamingCodeHighlighter";

/**
 * SyntaxHighlighter component using react-shiki with streaming optimization
 * Provides syntax highlighting for code blocks in assistant messages
 * Uses dark terminal background with light text
 */
export const SyntaxHighlighter: FC<HighlighterProps> = (props) => (
  <SyntaxHighlighterInner {...props} />
);
SyntaxHighlighter.displayName = "SyntaxHighlighter";

const SyntaxHighlighterInner: FC<HighlighterProps> = (props) => {
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === "dark" ? "github-light" : "github-dark";

  return (
    <StreamingCodeHighlighter
      {...props}
      variant="assistant"
      theme={props.theme ?? shikiTheme}
    />
  );
};
SyntaxHighlighterInner.displayName = "SyntaxHighlighterInner";

/**
 * UserSyntaxHighlighter - For user messages (dark background)
 * Uses a lighter semi-transparent background with light text
 */
export const UserSyntaxHighlighter: FC<HighlighterProps> = (props) => (
  <UserSyntaxHighlighterInner {...props} />
);
UserSyntaxHighlighter.displayName = "UserSyntaxHighlighter";

const UserSyntaxHighlighterInner: FC<HighlighterProps> = (props) => {
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === "dark" ? "github-light" : "github-dark";

  return (
    <StreamingCodeHighlighter
      {...props}
      variant="user"
      theme={props.theme ?? shikiTheme}
    />
  );
};
UserSyntaxHighlighterInner.displayName = "UserSyntaxHighlighterInner";
