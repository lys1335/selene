import fs from "fs/promises";
import path from "path";

import { normalizeToolResultOutput } from "@/lib/ai/tool-result-utils";
import { transcribeAudio } from "@/lib/audio/transcription";
import { extractTextFromDocument } from "@/lib/documents/parser";
import { getFullPathFromMediaRef } from "@/lib/storage/local-storage";

import {
  sanitizeTextContent,
  stripFakeToolCallJson,
  extractPasteBlocks,
  reinsertPasteBlocks,
} from "./content-sanitizer";
import { reconcileToolCallPairs, toModelToolResultOutput, normalizeToolCallInput } from "./tool-call-utils";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_BASE64_BYTES = 4.5 * 1024 * 1024;
const BASE64_OVERHEAD = 1.37;
const MAX_ATTACHMENT_TEXT_CHARS = 20_000;

type AttachmentPathMetadata = {
  name?: string;
  contentType?: string;
  url?: string;
  localPath?: string;
  filePath?: string;
  size?: number;
  kind?: string;
};

type ModelContentPart = {
  type: string;
  text?: string;
  image?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
};

type MessageInput = {
  role?: string;
  content?: string | unknown;
  parts?: Array<{
    type: string;
    text?: string;
    image?: string;
    url?: string;
    localPath?: string;
    filePath?: string;
    mediaType?: string;
    filename?: string;
    toolName?: string;
    toolCallId?: string;
    input?: unknown;
    output?: unknown;
    result?: unknown;
  }>;
  experimental_attachments?: AttachmentPathMetadata[];
  metadata?: {
    custom?: {
      attachments?: AttachmentPathMetadata[];
    };
  };
};

async function resizeImageIfNeeded(
  buffer: Buffer,
  imageUrl: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const sharp = (await import("sharp")).default;

    let resized = await sharp(buffer)
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    if (resized.length * BASE64_OVERHEAD <= MAX_BASE64_BYTES) {
      console.log(
        `[CHAT API] Resized oversized image: ${imageUrl} ` +
        `(${buffer.length} -> ${resized.length} bytes, ~${Math.round(resized.length * BASE64_OVERHEAD / 1024)}KB base64)`,
      );
      return { buffer: resized, mimeType: "image/jpeg" };
    }

    resized = await sharp(buffer)
      .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    console.log(
      `[CHAT API] Resized oversized image (pass 2): ${imageUrl} ` +
      `(${buffer.length} -> ${resized.length} bytes, ~${Math.round(resized.length * BASE64_OVERHEAD / 1024)}KB base64)`,
    );
    return { buffer: resized, mimeType: "image/jpeg" };
  } catch (resizeError) {
    console.warn(`[CHAT API] Failed to resize image, using original: ${imageUrl}`, resizeError);
    return null;
  }
}

async function imageUrlToBase64(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("http")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/api/media/")) {
    try {
      const relativePath = imageUrl.replace("/api/media/", "");
      const mediaRoot = path.resolve(process.env.LOCAL_DATA_PATH || ".local-data", "media");
      const filePath = path.resolve(mediaRoot, relativePath);
      if (!filePath.startsWith(mediaRoot + path.sep) && filePath !== mediaRoot) {
        console.warn(`[CHAT API] Path traversal blocked: ${imageUrl}`);
        return imageUrl;
      }

      let fileBuffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      let mimeType = IMAGE_MIME_TYPES[ext] || "image/png";

      if (fileBuffer.length * BASE64_OVERHEAD > MAX_BASE64_BYTES && ext in IMAGE_MIME_TYPES) {
        const resized = await resizeImageIfNeeded(fileBuffer, imageUrl);
        if (resized) {
          fileBuffer = Buffer.from(resized.buffer);
          mimeType = resized.mimeType;
        }
      }

      const base64 = fileBuffer.toString("base64");
      console.log(`[CHAT API] Converted image to base64: ${imageUrl} (${mimeType}, ${Math.round(base64.length / 1024)}KB)`);
      return `data:${mimeType};base64,${base64}`;
    } catch (error) {
      console.error(`[CHAT API] Failed to convert image to base64: ${imageUrl}`, error);
    }
  }

  return imageUrl;
}

function normalizeAttachmentString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildAttachmentLookup(msg: {
  experimental_attachments?: Array<AttachmentPathMetadata>;
  metadata?: {
    custom?: {
      attachments?: Array<AttachmentPathMetadata>;
    };
  };
}): Map<string, AttachmentPathMetadata> {
  const lookup = new Map<string, AttachmentPathMetadata>();

  const register = (attachment: AttachmentPathMetadata) => {
    const url = normalizeAttachmentString(attachment.url);
    if (!url) return;

    const existing = lookup.get(url);
    lookup.set(url, {
      url,
      name: normalizeAttachmentString(existing?.name) ?? normalizeAttachmentString(attachment.name),
      contentType: normalizeAttachmentString(existing?.contentType) ?? normalizeAttachmentString(attachment.contentType),
      filePath: normalizeAttachmentString(existing?.filePath) ?? normalizeAttachmentString(attachment.filePath),
      localPath: normalizeAttachmentString(existing?.localPath) ?? normalizeAttachmentString(attachment.localPath),
      kind: normalizeAttachmentString(existing?.kind) ?? normalizeAttachmentString(attachment.kind),
    });
  };

  for (const attachment of msg.metadata?.custom?.attachments ?? []) {
    register(attachment);
  }
  for (const attachment of msg.experimental_attachments ?? []) {
    register(attachment);
  }

  return lookup;
}

function resolveAttachmentForHelper(
  lookup: Map<string, AttachmentPathMetadata>,
  attachment: AttachmentPathMetadata,
): AttachmentPathMetadata {
  const url = normalizeAttachmentString(attachment.url);
  const fromLookup = url ? lookup.get(url) : undefined;

  return {
    name: normalizeAttachmentString(attachment.name) ?? normalizeAttachmentString(fromLookup?.name),
    contentType: normalizeAttachmentString(attachment.contentType) ?? normalizeAttachmentString(fromLookup?.contentType),
    url,
    filePath: normalizeAttachmentString(attachment.filePath) ?? normalizeAttachmentString(fromLookup?.filePath),
    localPath: normalizeAttachmentString(attachment.localPath) ?? normalizeAttachmentString(fromLookup?.localPath),
    kind: normalizeAttachmentString(attachment.kind) ?? normalizeAttachmentString(fromLookup?.kind),
  };
}

function formatAttachmentHelperText(
  attachment: AttachmentPathMetadata,
  fallbackName = "uploaded file",
): string | null {
  const filePath = normalizeAttachmentString(attachment.filePath);
  const localPath = normalizeAttachmentString(attachment.localPath);
  const url = normalizeAttachmentString(attachment.url);

  const pathLabelAndValue: [label: "filePath" | "localPath" | "url", value: string] | null =
    filePath ? ["filePath", filePath]
      : localPath ? ["localPath", localPath]
        : url ? ["url", url]
          : null;

  if (!pathLabelAndValue) return null;

  const displayName = normalizeAttachmentString(attachment.name) ?? fallbackName;
  return `[Attachment: ${displayName} | ${pathLabelAndValue[0]}: ${pathLabelAndValue[1]}]`;
}

function maybePreserveImageReference(
  contentParts: ModelContentPart[],
  imageUrl: string,
  shouldConvert: boolean,
  includeUrlHelpers: boolean,
) {
  if (!shouldConvert && !includeUrlHelpers) {
    contentParts.push({ type: "image", image: imageUrl });
  }
}

function trackAttachmentUrl(
  seenUrls: Set<string>,
  url: string | undefined,
): boolean {
  if (!url) return false;
  if (seenUrls.has(url)) return false;
  seenUrls.add(url);
  return true;
}

function inferAttachmentContentType(attachment: AttachmentPathMetadata, fallback?: string): string {
  const contentType = normalizeAttachmentString(attachment.contentType);
  if (contentType) return contentType;
  const name = normalizeAttachmentString(attachment.name) ?? normalizeAttachmentString(fallback) ?? "";
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".html":
    case ".htm":
      return "text/html";
    case ".csv":
      return "text/csv";
    case ".txt":
      return "text/plain";
    case ".vtt":
      return "text/vtt";
    case ".xml":
      return "application/xml";
    default:
      return "application/octet-stream";
  }
}

function formatDocumentAttachmentContext(
  attachment: AttachmentPathMetadata,
  extractedText: string,
): string {
  const displayName = normalizeAttachmentString(attachment.name) ?? "uploaded document";
  const helper = formatAttachmentHelperText(attachment, displayName);
  const safeText = extractedText.length > MAX_ATTACHMENT_TEXT_CHARS
    ? `${extractedText.slice(0, MAX_ATTACHMENT_TEXT_CHARS)}\n...[truncated]`
    : extractedText;

  return [
    helper,
    `[Attachment content: ${displayName}]`,
    safeText,
  ].filter(Boolean).join("\n");
}

async function extractAttachmentContextText(
  attachment: AttachmentPathMetadata,
  sessionId?: string,
): Promise<string | null> {
  const attachmentPath = normalizeAttachmentString(attachment.filePath)
    ?? getFullPathFromMediaRef(normalizeAttachmentString(attachment.url) ?? "")
    ?? undefined;

  if (!attachmentPath) {
    return formatAttachmentHelperText(attachment);
  }

  try {
    const fileBuffer = await fs.readFile(attachmentPath);
    const contentType = inferAttachmentContentType(attachment, path.basename(attachmentPath));
    const filename = normalizeAttachmentString(attachment.name) ?? path.basename(attachmentPath);

    if (contentType.startsWith("audio/")) {
      const transcription = await transcribeAudio(fileBuffer, contentType, filename);
      const transcript = sanitizeTextContent(transcription.text.trim(), `audio attachment ${filename}`, sessionId);
      if (!transcript) {
        return formatAttachmentHelperText(attachment, filename);
      }
      return [
        formatAttachmentHelperText(attachment, filename),
        `[Audio transcript: ${filename}]`,
        transcript,
      ].filter(Boolean).join("\n");
    }

    const parsed = await extractTextFromDocument(fileBuffer, contentType, filename, "chat-attachment");
    const sanitized = sanitizeTextContent(parsed.text, `attachment ${filename}`, sessionId);
    if (!sanitized) {
      return formatAttachmentHelperText(attachment, filename);
    }

    return formatDocumentAttachmentContext(attachment, sanitized);
  } catch (error) {
    console.warn("[EXTRACT] Failed to extract attachment content", {
      name: attachment.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return formatAttachmentHelperText(attachment, attachment.name || "uploaded file");
  }
}

function appendTextPartIfPresent(
  contentParts: ModelContentPart[],
  text: string | null | undefined,
) {
  if (!text) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  contentParts.push({ type: "text", text: trimmed });
}

async function appendImagePart(
  contentParts: ModelContentPart[],
  attachmentLookup: Map<string, AttachmentPathMetadata>,
  seenAttachmentUrls: Set<string>,
  url: string,
  fallbackName: string,
  includeUrlHelpers: boolean,
  convertUserImagesToBase64: boolean,
  isUserMessage: boolean,
) {
  if (!trackAttachmentUrl(seenAttachmentUrls, url)) return;

  const shouldConvert = convertUserImagesToBase64 && isUserMessage;
  const finalImageUrl = shouldConvert ? await imageUrlToBase64(url) : url;

  if (shouldConvert) {
    contentParts.push({ type: "image", image: finalImageUrl });
  }

  if (includeUrlHelpers) {
    appendTextPartIfPresent(
      contentParts,
      formatAttachmentHelperText(
        resolveAttachmentForHelper(attachmentLookup, { url, name: fallbackName }),
        fallbackName,
      ),
    );
  }

  maybePreserveImageReference(contentParts, url, shouldConvert, includeUrlHelpers);
}

async function appendNonImageAttachment(
  contentParts: ModelContentPart[],
  attachmentLookup: Map<string, AttachmentPathMetadata>,
  attachment: AttachmentPathMetadata,
  sessionId?: string,
) {
  const resolved = resolveAttachmentForHelper(attachmentLookup, attachment);
  appendTextPartIfPresent(contentParts, await extractAttachmentContextText(resolved, sessionId));
}

function buildTextPart(text: string, role: string | undefined, sessionId?: string): string {
  const { cleanedText, pasteBlocks } = extractPasteBlocks(text);
  const strippedText = stripFakeToolCallJson(cleanedText);
  if (!strippedText.trim() && pasteBlocks.length === 0) return "";
  const sanitizedText = sanitizeTextContent(strippedText, `text part in ${role} message`, sessionId);
  return reinsertPasteBlocks(sanitizedText, pasteBlocks);
}

function getStringContent(content: unknown, sessionId?: string): string {
  if (typeof content !== "string" || !content) return "";
  const { cleanedText, pasteBlocks } = extractPasteBlocks(content);
  const stripped = stripFakeToolCallJson(cleanedText);
  if (!stripped.trim() && pasteBlocks.length === 0) return "";
  const sanitized = sanitizeTextContent(stripped, "string content", sessionId);
  return reinsertPasteBlocks(sanitized, pasteBlocks);
}

export async function extractContent(
  msg: MessageInput,
  includeUrlHelpers = false,
  convertUserImagesToBase64 = false,
  sessionId?: string,
): Promise<string | ModelContentPart[]> {
  const hasStructuredParts = Array.isArray(msg.parts) && msg.parts.length > 0;
  const hasMetadataAttachments = Array.isArray(msg.metadata?.custom?.attachments)
    && msg.metadata.custom.attachments.length > 0;
  const hasExperimentalAttachments = Array.isArray(msg.experimental_attachments)
    && msg.experimental_attachments.length > 0;
  const hasStructuredContent =
    hasStructuredParts || hasMetadataAttachments || hasExperimentalAttachments;
  if (!hasStructuredContent) {
    const directContent = getStringContent(msg.content, sessionId);
    if (directContent) {
      return directContent;
    }
  }

  const isUserMessage = msg.role === "user";

  if (msg.parts && Array.isArray(msg.parts)) {
    const attachmentLookup = buildAttachmentLookup(msg);
    const seenAttachmentUrls = new Set<string>();
    const explicitToolResultIds = new Set(
      msg.parts
        .filter(
          (part): part is { type: "tool-result"; toolCallId: string } =>
            part.type === "tool-result" && typeof part.toolCallId === "string",
        )
        .map((part) => part.toolCallId),
    );

    const contentParts: ModelContentPart[] = [];
    let hasExplicitTextPart = false;

    for (const part of msg.parts) {
      if (part.type === "text" && part.text?.trim()) {
        hasExplicitTextPart = true;
        appendTextPartIfPresent(contentParts, buildTextPart(part.text, msg.role, sessionId));
        continue;
      }

      if (part.type === "image" && (part.image || part.url)) {
        await appendImagePart(
          contentParts,
          attachmentLookup,
          seenAttachmentUrls,
          (part.image || part.url) as string,
          "uploaded image",
          includeUrlHelpers,
          convertUserImagesToBase64,
          isUserMessage,
        );
        continue;
      }

      if (part.type === "file" && part.url) {
        if (part.mediaType?.startsWith("image/")) {
          await appendImagePart(
            contentParts,
            attachmentLookup,
            seenAttachmentUrls,
            part.url,
            part.filename || "uploaded image",
            includeUrlHelpers,
            convertUserImagesToBase64,
            isUserMessage,
          );
        } else {
          await appendNonImageAttachment(
            contentParts,
            attachmentLookup,
            {
              name: part.filename,
              contentType: part.mediaType,
              url: part.url,
              localPath: part.localPath,
              filePath: part.filePath,
            },
            sessionId,
          );
        }
        continue;
      }

      if (part.type === "dynamic-tool" && part.toolName) {
        const toolName = part.toolName || "tool";
        const output = part.output as {
          images?: Array<{ url: string; localPath?: string; filePath?: string }>;
          videos?: Array<{ url: string; localPath?: string; filePath?: string }>;
          text?: string;
          status?: string;
        } | null;
        const toolCallId = part.toolCallId;
        const normalizedInput = toolCallId
          ? normalizeToolCallInput(part.input, toolName, toolCallId) ?? {}
          : null;

        if (toolCallId && normalizedInput) {
          contentParts.push({
            type: "tool-call",
            toolCallId,
            toolName,
            input: normalizedInput,
          });
        }

        if (toolCallId && output !== undefined) {
          const normalizedOutput = normalizeToolResultOutput(
            toolName,
            output,
            normalizedInput,
            { mode: "projection" },
          ).output;
          contentParts.push({
            type: "tool-result",
            toolCallId,
            toolName,
            output: toModelToolResultOutput(normalizedOutput),
          });
        }

        if (output?.images && output.images.length > 0) {
          const urlList = output.images
            .map((img, idx) => `  ${idx + 1}. ${img.url}${img.localPath ? ` (localPath: ${img.localPath})` : ""}${img.filePath ? ` (filePath: ${img.filePath})` : ""}`)
            .join("\n");
          contentParts.push({
            type: "text",
            text: `Previously generated ${output.images.length} image(s) using ${toolName}:\n${urlList}\nUse these URLs for EDITING requests. For NEW image generation, call the tool.`,
          });
        } else if (output?.videos && output.videos.length > 0) {
          const urlList = output.videos
            .map((vid, idx) => `  ${idx + 1}. ${vid.url}${vid.localPath ? ` (localPath: ${vid.localPath})` : ""}${vid.filePath ? ` (filePath: ${vid.filePath})` : ""}`)
            .join("\n");
          contentParts.push({
            type: "text",
            text: `Previously generated ${output.videos.length} video(s) using ${toolName}:\n${urlList}\nUse these URLs for EDITING requests. For NEW video generation, call the tool.`,
          });
        } else {
          const resultObj = output as { truncated?: boolean; truncatedContentId?: string } | null;
          if (resultObj?.truncated && resultObj?.truncatedContentId) {
            contentParts.push({
              type: "text",
              text: `\n---\n⚠️ CONTENT TRUNCATED: Full content available via retrieveFullContent with contentId="${resultObj.truncatedContentId}"\n---`,
            });
          }
        }
        continue;
      }

      if (part.type === "tool-call" && part.toolCallId && part.toolName) {
        const normalizedInput = normalizeToolCallInput(part.input, part.toolName, part.toolCallId) ?? {};
        contentParts.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: normalizedInput,
        });

        const rawOutput = part.output ?? part.result;
        if (rawOutput !== undefined && !explicitToolResultIds.has(part.toolCallId)) {
          const normalizedOutput = normalizeToolResultOutput(
            part.toolName,
            rawOutput,
            normalizedInput,
            { mode: "projection" },
          ).output;
          contentParts.push({
            type: "tool-result",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: toModelToolResultOutput(normalizedOutput),
          });
        }
        continue;
      }

      if (part.type === "tool-result" && part.toolCallId && part.toolName) {
        const normalizedInput = normalizeToolCallInput(part.input, part.toolName, part.toolCallId) ?? {};
        const rawOutput = part.output ?? part.result;
        const normalizedOutput = normalizeToolResultOutput(
          part.toolName,
          rawOutput,
          normalizedInput,
          { mode: "projection" },
        ).output;
        contentParts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: toModelToolResultOutput(normalizedOutput),
        });
        continue;
      }

      if (part.type.startsWith("tool-") && part.type !== "tool-call" && part.type !== "tool-result") {
        const toolName = part.type.replace("tool-", "");
        const toolCallId = part.toolCallId;
        const normalizedInput = toolCallId
          ? normalizeToolCallInput(part.input, toolName, toolCallId) ?? {}
          : null;
        if (toolCallId && normalizedInput) {
          contentParts.push({
            type: "tool-call",
            toolCallId,
            toolName,
            input: normalizedInput,
          });
        }

        const toolOutput = part.output ?? part.result;
        if (toolCallId && toolOutput !== undefined) {
          const normalizedOutput = normalizeToolResultOutput(
            toolName,
            toolOutput,
            normalizedInput,
            { mode: "projection" },
          ).output;
          contentParts.push({
            type: "tool-result",
            toolCallId,
            toolName,
            output: toModelToolResultOutput(normalizedOutput),
          });
        }
      }
    }

    if (!hasExplicitTextPart) {
      const directContent = getStringContent(msg.content, sessionId);
      const trimmedDirectContent = directContent.trim();
      if (trimmedDirectContent) {
        contentParts.unshift({ type: "text", text: trimmedDirectContent });
      }
    }

    if (msg.experimental_attachments && Array.isArray(msg.experimental_attachments)) {
      for (const attachment of msg.experimental_attachments) {
        if (!attachment.url) continue;
        if (attachment.contentType?.startsWith("image/")) {
          await appendImagePart(
            contentParts,
            attachmentLookup,
            seenAttachmentUrls,
            attachment.url,
            attachment.name || "uploaded image",
            includeUrlHelpers,
            convertUserImagesToBase64,
            isUserMessage,
          );
        } else {
          await appendNonImageAttachment(contentParts, attachmentLookup, attachment, sessionId);
        }
      }
    }

    const metadataAttachments = msg.metadata?.custom?.attachments;
    if (metadataAttachments && Array.isArray(metadataAttachments)) {
      for (const attachment of metadataAttachments) {
        if (!attachment.url) continue;
        if (attachment.contentType?.startsWith("image/")) {
          await appendImagePart(
            contentParts,
            attachmentLookup,
            seenAttachmentUrls,
            attachment.url,
            attachment.name || "uploaded image",
            includeUrlHelpers,
            convertUserImagesToBase64,
            isUserMessage,
          );
        } else {
          await appendNonImageAttachment(contentParts, attachmentLookup, attachment, sessionId);
        }
      }
    }

    const normalizedParts = reconcileToolCallPairs(contentParts);
    if (normalizedParts.length === 0) {
      return "[Message content not available]";
    }
    if (normalizedParts.length === 1 && normalizedParts[0].type === "text") {
      return normalizedParts[0].text || "";
    }
    return normalizedParts;
  }

  if (
    (msg.experimental_attachments && Array.isArray(msg.experimental_attachments)) ||
    (msg.metadata?.custom?.attachments && Array.isArray(msg.metadata.custom.attachments))
  ) {
    const attachmentLookup = buildAttachmentLookup(msg);
    const seenAttachmentUrls = new Set<string>();
    const contentParts: ModelContentPart[] = [];

    if (typeof msg.content === "string" && msg.content) {
      appendTextPartIfPresent(
        contentParts,
        sanitizeTextContent(msg.content, "string content with attachments", sessionId),
      );
    }

    for (const attachment of msg.metadata?.custom?.attachments ?? []) {
      const contentType = inferAttachmentContentType(attachment, attachment.name);
      if (!attachment.url) {
        if (contentType.startsWith("image/")) {
          appendTextPartIfPresent(
            contentParts,
            includeUrlHelpers
              ? formatAttachmentHelperText(resolveAttachmentForHelper(attachmentLookup, attachment), attachment.name || "uploaded image")
              : null,
          );
        }
        continue;
      }
      if (contentType.startsWith("image/")) {
        await appendImagePart(
          contentParts,
          attachmentLookup,
          seenAttachmentUrls,
          attachment.url,
          attachment.name || "uploaded image",
          includeUrlHelpers,
          convertUserImagesToBase64,
          isUserMessage,
        );
      } else {
        if (!trackAttachmentUrl(seenAttachmentUrls, attachment.url)) continue;
        await appendNonImageAttachment(contentParts, attachmentLookup, attachment, sessionId);
      }
    }

    for (const attachment of msg.experimental_attachments ?? []) {
      const contentType = inferAttachmentContentType(attachment, attachment.name);
      if (!attachment.url) {
        if (contentType.startsWith("image/")) {
          appendTextPartIfPresent(
            contentParts,
            includeUrlHelpers
              ? formatAttachmentHelperText(resolveAttachmentForHelper(attachmentLookup, attachment), attachment.name || "uploaded image")
              : null,
          );
        }
        continue;
      }
      if (contentType.startsWith("image/")) {
        await appendImagePart(
          contentParts,
          attachmentLookup,
          seenAttachmentUrls,
          attachment.url,
          attachment.name || "uploaded image",
          includeUrlHelpers,
          convertUserImagesToBase64,
          isUserMessage,
        );
      } else {
        if (!trackAttachmentUrl(seenAttachmentUrls, attachment.url)) continue;
        await appendNonImageAttachment(contentParts, attachmentLookup, attachment, sessionId);
      }
    }

    if (contentParts.length > 0) {
      if (contentParts.length === 1 && contentParts[0].type === "text") {
        return contentParts[0].text || "";
      }
      return contentParts;
    }
  }

  if (Array.isArray(msg.content)) {
    return msg.content as ModelContentPart[];
  }

  return "[Message content not available]";
}
