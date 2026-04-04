interface ComposerCaptureMetadata {
  activeAppName?: string | null;
  activeWindowTitle?: string | null;
  browserUrl?: string | null;
}

interface BuildSimpleComposerSubmissionArgs {
  inputValue: string;
  enhancedContext?: string | null;
  captureMetadata?: ComposerCaptureMetadata | null;
}

export function buildSimpleComposerSubmission({
  inputValue,
  captureMetadata,
}: BuildSimpleComposerSubmissionArgs): string {
  const composerText = inputValue.trim();
  const contextParts: string[] = [];

  if (captureMetadata?.activeAppName && captureMetadata.activeWindowTitle) {
    contextParts.push(
      `[Screen Context: ${captureMetadata.activeAppName} — ${captureMetadata.activeWindowTitle}]`,
    );
  } else if (captureMetadata?.activeWindowTitle) {
    contextParts.push(`[Screen Context: ${captureMetadata.activeWindowTitle}]`);
  }

  if (captureMetadata?.browserUrl) {
    contextParts.push(`[URL: ${captureMetadata.browserUrl}]`);
  }

  if (contextParts.length === 0) {
    return composerText;
  }

  if (!composerText) {
    return contextParts.join("\n");
  }

  return `${contextParts.join("\n")}\n\n${composerText}`;
}
