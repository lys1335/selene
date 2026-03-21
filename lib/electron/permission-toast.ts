import { toast } from "sonner";
import { getElectronAPI } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PermissionType = "screen" | "microphone" | "accessibility";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 8_000;

const PERMISSION_MESSAGES: Record<
  PermissionType,
  { title: string; description: string }
> = {
  screen: {
    title: "Screen Recording permission required",
    description:
      "Open System Settings → Privacy & Security → Screen Recording, then enable Selene.",
  },
  microphone: {
    title: "Microphone access required",
    description:
      "Selene needs microphone permission to record voice input.",
  },
  accessibility: {
    title: "Accessibility permission required",
    description:
      "Open System Settings → Privacy & Security → Accessibility, then enable Selene.",
  },
};

// ---------------------------------------------------------------------------
// Dedup — prevent stacking identical permission toasts
// ---------------------------------------------------------------------------

const recentToasts = new Map<PermissionType, number>();
const DEDUP_MS = 4_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show an actionable toast for a missing macOS permission.
 *
 * The toast includes an "Open System Settings" button that triggers the
 * appropriate native permission request or deep-link.
 *
 * Duplicate toasts for the same permission type are suppressed within a
 * short window to avoid toast stacking on rapid hotkey presses.
 */
export function showPermissionToast(type: PermissionType): void {
  // Dedup: skip if we showed the same toast very recently
  const now = Date.now();
  const lastShown = recentToasts.get(type);
  if (lastShown && now - lastShown < DEDUP_MS) return;
  recentToasts.set(type, now);

  const { title, description } = PERMISSION_MESSAGES[type];
  const api = getElectronAPI();

  toast.error(title, {
    description,
    duration: TOAST_DURATION_MS,
    action: {
      label: "Open System Settings",
      onClick: () => {
        switch (type) {
          case "screen":
            void api?.permissions?.requestScreen();
            break;
          case "microphone":
            void api?.permissions?.requestMic();
            break;
          case "accessibility":
            void api?.permissions?.requestAccessibility();
            break;
        }
      },
    },
  });
}
