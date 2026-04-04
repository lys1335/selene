"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShortcutRecorder } from "@/components/settings/shortcut-recorder";
import { getElectronAPI } from "@/lib/electron/types";
import type { PermissionCheckResult } from "@/lib/electron/types";
import { cn } from "@/lib/utils";
import {
  Monitor,
  Mic,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Keyboard,
  ChevronRight,
  Lock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// "checking" is a UI-only state, not part of the Electron PermissionStatus enum
type LocalPermissionStatus = "granted" | "denied" | "not-determined" | "restricted" | "unavailable" | "checking";

export interface OnboardingDialogProps {
  open: boolean;
  /** Called when user completes or dismisses onboarding. Receives final shortcut values. */
  onComplete: (result: {
    screenCaptureShortcut: string;
    quickCaptureHotkey: string;
    autoSend: boolean;
    privacy: { excludedApps: string };
  }) => void;
  /** Initial shortcut values from settings */
  initialScreenShortcut?: string;
  initialUnifiedShortcut?: string;
}

type Step = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current, total, stepLabel }: { current: Step; total: number; stepLabel: string }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div key={step} className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full transition-all",
              step < current
                ? "bg-primary"
                : step === current
                  ? "bg-primary w-4"
                  : "bg-muted-foreground/30"
            )}
          />
        </div>
      ))}
      <span className="text-xs text-muted-foreground ml-1">
        {stepLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permission row
// ---------------------------------------------------------------------------

function PermissionRow({
  icon: Icon,
  label,
  status,
  onRequest,
  checkingLabel,
  grantLabel,
}: {
  icon: typeof Monitor;
  label: string;
  status: LocalPermissionStatus;
  onRequest?: () => void;
  checkingLabel: string;
  grantLabel: string;
}) {
  const isGranted = status === "granted" || status === "unavailable";
  const isDenied = status === "denied" || status === "restricted";
  const isPending = status === "not-determined";
  const isChecking = status === "checking";

  return (
    <div className="flex items-center justify-between py-3 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg",
            isGranted
              ? "bg-green-500/10 text-green-500"
              : isDenied
                ? "bg-red-500/10 text-red-500"
                : "bg-muted text-muted-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground capitalize">
            {isChecking ? checkingLabel : status.replace("-", " ")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isChecking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {isGranted && !isChecking && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {isDenied && !isChecking && <XCircle className="h-4 w-4 text-red-500" />}
        {isPending && !isChecking && (
          <Button size="sm" variant="outline" onClick={onRequest}>
            {grantLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OnboardingDialog({
  open,
  onComplete,
  initialScreenShortcut = "CommandOrControl+Shift+S",
  initialUnifiedShortcut = "CommandOrControl+Shift+A",
}: OnboardingDialogProps) {
  const t = useTranslations("quickCapture.onboarding");
  const [step, setStep] = useState<Step>(1);
  const [permissions, setPermissions] = useState<
    Record<"screen" | "microphone" | "accessibility", LocalPermissionStatus>
  >({
    screen: "checking",
    microphone: "checking",
    accessibility: "checking",
  });
  // Track the active screen-permission poll so we can cancel it on unmount / re-request
  const screenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [screenShortcut, setScreenShortcut] = useState(initialScreenShortcut);
  const [unifiedShortcut, setUnifiedShortcut] = useState(initialUnifiedShortcut);
  const [autoSend, setAutoSend] = useState(false);
  const [excludedApps, setExcludedApps] = useState("1Password, Keychain Access, System Preferences");

  const electronAPI = getElectronAPI();
  const isElectron = !!electronAPI;

  // Check permissions on mount
  const checkPermissions = useCallback(async () => {
    if (!electronAPI?.permissions) {
      setPermissions({ screen: "unavailable", microphone: "unavailable", accessibility: "unavailable" });
      return;
    }
    try {
      const result = await electronAPI.permissions.check();
      setPermissions(result);
    } catch {
      setPermissions({ screen: "unavailable", microphone: "unavailable", accessibility: "unavailable" });
    }
  }, [electronAPI]);

  useEffect(() => {
    if (open && step === 1) {
      checkPermissions();
    }
  }, [open, step, checkPermissions]);

  // Cleanup screen-permission poll on unmount
  useEffect(() => {
    return () => {
      if (screenPollRef.current) clearInterval(screenPollRef.current);
      if (screenPollTimeoutRef.current) clearTimeout(screenPollTimeoutRef.current);
    };
  }, []);

  const stopScreenPoll = useCallback(() => {
    if (screenPollRef.current) { clearInterval(screenPollRef.current); screenPollRef.current = null; }
    if (screenPollTimeoutRef.current) { clearTimeout(screenPollTimeoutRef.current); screenPollTimeoutRef.current = null; }
  }, []);

  const requestScreen = useCallback(async () => {
    try {
      await electronAPI?.permissions?.requestScreen();
    } catch (err) {
      console.warn("[Onboarding] requestScreen failed:", err);
      toast.error(t("toastScreenError"));
    }
    // Cancel any existing poll before starting a new one
    stopScreenPoll();
    screenPollRef.current = setInterval(async () => {
      try {
        const result = await electronAPI?.permissions?.check();
        if (result?.screen === "granted") {
          stopScreenPoll();
          setPermissions((prev) => ({ ...prev, screen: "granted" }));
        }
      } catch {
        // IPC error — stop polling
        stopScreenPoll();
      }
    }, 1500);
    screenPollTimeoutRef.current = setTimeout(() => stopScreenPoll(), 30000);
  }, [electronAPI, stopScreenPoll]);

  const requestMic = useCallback(async () => {
    try {
      const granted = await electronAPI?.permissions?.requestMic();
      if (granted) {
        setPermissions((prev) => ({ ...prev, microphone: "granted" }));
      }
    } catch (err) {
      console.warn("[Onboarding] requestMic failed:", err);
      toast.error(t("toastMicError"));
    }
  }, [electronAPI]);

  const requestAccessibility = useCallback(async () => {
    try {
      await electronAPI?.permissions?.requestAccessibility();
    } catch (err) {
      console.warn("[Onboarding] requestAccessibility failed:", err);
      toast.error(t("toastAccessibilityError"));
    }
    setTimeout(checkPermissions, 1000);
  }, [electronAPI, checkPermissions]);

  const handleComplete = () => {
    onComplete({
      screenCaptureShortcut: screenShortcut,
      quickCaptureHotkey: unifiedShortcut,
      autoSend,
      privacy: { excludedApps },
    });
  };

  // Auto-advance step 1 if all critical permissions are granted
  const allCritical =
    permissions.screen === "granted" || permissions.screen === "unavailable";

  // ---------------------------------------------------------------------------
  // Step content
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>{t("grantPermissions")}</DialogTitle>
                <DialogDescription>
                  {t("grantPermissionsDesc")}
                </DialogDescription>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 px-4 py-1 mb-4">
              <PermissionRow
                icon={Monitor}
                label={t("screenRecording")}
                status={permissions.screen}
                onRequest={requestScreen}
                checkingLabel={t("checking")}
                grantLabel={t("grant")}
              />
              <PermissionRow
                icon={Mic}
                label={t("microphone")}
                status={permissions.microphone}
                onRequest={requestMic}
                checkingLabel={t("checking")}
                grantLabel={t("grant")}
              />
              <PermissionRow
                icon={Shield}
                label={t("accessibility")}
                status={permissions.accessibility}
                onRequest={requestAccessibility}
                checkingLabel={t("checking")}
                grantLabel={t("grant")}
              />
            </div>

            {!isElectron && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                {t("desktopAppRequired")}
              </div>
            )}
          </div>
        );

      case 2:
        return (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Keyboard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>{t("configureShortcuts")}</DialogTitle>
                <DialogDescription>
                  {t("configureShortcutsDesc")}
                </DialogDescription>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {t("screenCaptureOnly")}
                </label>
                <ShortcutRecorder value={screenShortcut} onChange={setScreenShortcut} />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("screenCaptureOnlyDesc")}
                </p>
              </div>

              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {t("quickCaptureVoiceScreen")}
                  <Badge variant="secondary" className="ml-2 text-xs">{t("recommended")}</Badge>
                </label>
                <ShortcutRecorder value={unifiedShortcut} onChange={setUnifiedShortcut} />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("quickCaptureVoiceScreenDesc")}
                </p>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Lock className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle>{t("privacyDefaults")}</DialogTitle>
                <DialogDescription>
                  {t("privacyDefaultsDesc")}
                </DialogDescription>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  {t("excludedApps")}
                </label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                  value={excludedApps}
                  onChange={(e) => setExcludedApps(e.target.value)}
                  placeholder="1Password, Keychain Access..."
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("excludedAppsDesc")}
                </p>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                <input
                  type="checkbox"
                  id="autoSendOnboarding"
                  checked={autoSend}
                  onChange={(e) => setAutoSend(e.target.checked)}
                  className="mt-0.5"
                />
                <label htmlFor="autoSendOnboarding" className="text-sm cursor-pointer">
                  <span className="font-medium">{t("autoSendAfterVoice")}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("autoSendAfterVoiceDesc")}
                  </p>
                </label>
              </div>

              <div className="text-xs text-muted-foreground bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <strong>{t("dataNotice")}</strong> {t("dataNoticeText")}
              </div>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
            <DialogTitle className="mb-2">{t("readyTitle")}</DialogTitle>
            <DialogDescription className="mb-6">
              {t.rich("readyDesc", {
                shortcut: unifiedShortcut.replace("CommandOrControl", "⌘").replace("Shift", "⇧").replaceAll("+", " "),
              })}
            </DialogDescription>

            <div className="text-left bg-muted/30 rounded-lg border border-border p-4 space-y-2 text-sm text-muted-foreground">
              <p>✓ {t("checklistCaptures")}</p>
              <p>✓ {t("checklistShortcut")}</p>
              {autoSend && <p>✓ {t("checklistAutoSend")}</p>}
              <p>✓ {t("checklistExcluded", { apps: excludedApps.split(",")[0].trim() })}{excludedApps.split(",").length > 1 ? t("checklistExcludedMore") : ""}</p>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleComplete()}>
      <DialogContent className="max-w-md">
        <DialogHeader className="sr-only">
          <DialogTitle>{t("setupTitle")}</DialogTitle>
          <DialogDescription>{t("setupDesc")}</DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} total={4} stepLabel={t("stepOf", { current: step, total: 4 })} />

        {renderStep()}

        <div className="flex justify-between mt-6">
          {step > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => (s - 1) as Step)}>
              {t("back")}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleComplete}>
              {t("skipSetup")}
            </Button>
          )}

          {step < 4 ? (
            <Button
              size="sm"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={step === 1 && !allCritical && isElectron}
            >
              {step === 1 && !allCritical ? (
                <>{t("waitingForPermissions")}</>
              ) : (
                <>
                  {t("continue")} <ChevronRight className="h-3.5 w-3.5 ml-1" />
                </>
              )}
            </Button>
          ) : (
            <Button size="sm" onClick={handleComplete}>
              {t("doneEnable")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
