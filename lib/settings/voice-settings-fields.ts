/**
 * Shared field definitions for voice, STT, screen capture, and related settings.
 *
 * AppSettings (settings-manager.ts) uses `Partial<VoiceSettingsFields>` (all optional).
 * FormState (settings-types.ts) uses `Required<VoiceSettingsFields>` (all required).
 */
export interface VoiceSettingsFields {
  // TTS
  ttsEnabled: boolean;
  ttsProvider: "elevenlabs" | "openai" | "edge";
  ttsAutoMode: "off" | "always" | "channels-only";
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  openaiTtsVoice: string;
  edgeTtsVoice: string;
  ttsSummarizeThreshold: number;
  ttsReadCodeBlocks: boolean;
  ttsSpeakCodeSymbols: boolean;
  // STT
  sttEnabled: boolean;
  sttProvider: "openai" | "local" | "parakeet";
  sttLocalModel: string;
  voicePostProcessing: boolean;
  transcriberModel: string;
  voiceAgentName: string;
  voiceAudioCues: boolean;
  voiceAutoLearn: boolean;
  voiceActivationMode: "tap" | "push";
  parakeetModel: string;
  parakeetAutoStart: boolean;
  parakeetServerPort: number;
  voiceHotkey: string;
  // Screen / quick capture
  screenCaptureEnabled: boolean;
  screenCaptureShortcut: string;
  quickCaptureEnabled: boolean;
  quickCaptureHotkey: string;
  quickCaptureAutoSend: boolean;
  quickCaptureAutoSendDelay: number;
  screenCaptureExcludedApps: string;
  screenCaptureRetention: "session" | "day" | "week" | "forever";
  screenCapturePreviewBeforeSend: boolean;
  screenCaptureOnboardingSeen: boolean;
  customDictionary: string[];
  // Voice history
  voiceHistoryEnabled: boolean;
  voiceHistoryLimit: number;
  voiceHistoryRetentionDays: number;
  voiceHistoryPreviewLength: number;
  // Voice actions
  voiceActionsEnabled: boolean;
  voiceActionDefaultLanguage: string;
  voiceActionPreserveStyle: boolean;
  voiceActionConfirmDestructive: boolean;
  voiceActionFormalTone: "auto" | "business" | "casual";
  voiceActionTranslationStyle: "natural" | "literal";
  voiceActionSummarizeLength: "short" | "medium" | "long";
}
