import { tool, jsonSchema } from "ai";
import {
  callWan22Video,
  isVideoAsyncResult,
} from "@/lib/ai/wan22-video-client";
import { createToolRun, updateToolRun, createImage } from "@/lib/db/queries";
import { withToolLogging } from "@/lib/ai/tool-registry/logging";

// Helper to get current timestamp as ISO string for SQLite
const now = () => new Date().toISOString();

// ==========================================================================
// WAN 2.2 VIDEO TOOL (Image-to-Video with PainterI2V)
// ==========================================================================

const wan22VideoSchema = jsonSchema<{
  image_url?: string;
  base64_image?: string;
  positive: string;
  negative?: string;
  fps?: 10 | 15 | 21 | 24 | 30 | 60;
  duration?: 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 5;
  seed?: number;
}>({
  type: "object",
  title: "Wan22VideoInput",
  description: "Input schema for Wan22 video generation",
  properties: {
    image_url: {
      type: "string",
      format: "uri",
      description:
        "URL of the input image to animate. Either image_url or base64_image must be provided.",
    },
    base64_image: {
      type: "string",
      description:
        "Base64-encoded input image (with or without data:image prefix). Either image_url or base64_image must be provided.",
    },
    positive: {
      type: "string",
      description:
        "Motion prompt describing desired video motion and camera movement. Be specific about actions, movements, and camera angles.",
    },
    negative: {
      type: "string",
      description:
        "Negative prompt for unwanted elements. Default: 'static, blurry, distorted'.",
    },
    fps: {
      type: "number",
      enum: [10, 15, 21, 24, 30, 60],
      default: 21,
      description: "Frames per second. Default is 21.",
    },
    duration: {
      type: "number",
      enum: [0.5, 1, 1.5, 2, 2.5, 3, 5],
      default: 2,
      description: "Video duration in seconds. Default is 2.0 seconds.",
    },
    seed: {
      type: "number",
      description:
        "Optional seed for reproducibility. If not provided, a random seed will be used.",
    },
  },
  required: ["positive"],
  additionalProperties: false,
});

// Args interface for wan22Video
interface Wan22VideoArgs {
  image_url?: string;
  base64_image?: string;
  positive: string;
  negative?: string;
  fps?: 10 | 15 | 21 | 24 | 30 | 60;
  duration?: 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 5;
  seed?: number;
}

/**
 * Core wan22Video execution logic (extracted for logging wrapper)
 */
async function executeWan22Video(sessionId: string, args: Wan22VideoArgs) {
  const { image_url, base64_image, positive, negative, fps, duration, seed } = args;

  if (!image_url && !base64_image) {
    return {
      status: "error",
      error: "Either image_url or base64_image must be provided",
    };
  }

  const toolRun = await createToolRun({
    sessionId,
    toolName: "generateVideoWan22",
    args: { image_url, positive, negative, fps, duration, seed },
    status: "running",
  });

  try {
    // Note: motion_amplitude is always hard-coded to 1.0 in the client
    const result = await callWan22Video(
      {
        image_url,
        base64_image,
        positive,
        negative,
        fps,
        duration,
        seed,
      },
      sessionId
    );

    if (isVideoAsyncResult(result)) {
      await updateToolRun(toolRun.id, {
        status: "pending",
        metadata: { jobId: result.jobId, statusUrl: result.statusUrl },
      });

      return {
        status: "processing",
        message: "WAN 2.2 video generation job started. The result will be available shortly.",
        jobId: result.jobId,
      };
    }

    // Note: We use the images table with format="mp4" for videos
    for (const video of result.videos) {
      await createImage({
        sessionId,
        toolRunId: toolRun.id,
        role: "generated",
        localPath: video.localPath || video.url,
        url: video.url,
        format: video.format,
        metadata: {
          prompt: positive,
          fps: video.fps,
          duration: video.duration,
          mediaType: "video",
        },
      });
    }

    await updateToolRun(toolRun.id, {
      status: "succeeded",
      result: { videos: result.videos },
      completedAt: now(),
    });

    return {
      status: "completed",
      videos: result.videos,
      timeTaken: result.timeTaken,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await updateToolRun(toolRun.id, {
      status: "failed",
      error: errorMessage,
      completedAt: now(),
    });

    return {
      status: "error",
      error: errorMessage,
    };
  }
}

export function createWan22VideoTool(sessionId: string) {
  const executeWithLogging = withToolLogging(
    "generateVideoWan22",
    sessionId,
    (args: Wan22VideoArgs) => executeWan22Video(sessionId, args)
  );

  return tool({
    description: `Animate images into videos with WAN 2.2. Use searchTools first for parameters.`,
    inputSchema: wan22VideoSchema,
    execute: executeWithLogging,
  });
}

// ==========================================================================
// WAN 2.2 PIXEL VIDEO TOOL (Pixel Art Character Animation)
// ==========================================================================

const wan22PixelVideoSchema = jsonSchema<{
  image_url?: string;
  base64_image?: string;
  positive: string;
  negative?: string;
  fps?: 10 | 15 | 21 | 24 | 30 | 60;
  duration?: 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 5;
  seed?: number;
  lora_name?: string;
  lora_strength?: number;
}>({
  type: "object",
  title: "Wan22PixelVideoInput",
  description: "Input schema for Wan22 pixel art video generation",
  properties: {
    image_url: {
      type: "string",
      format: "uri",
      description:
        "URL of the character sprite base image to animate. Either image_url or base64_image must be provided.",
    },
    base64_image: {
      type: "string",
      description:
        "Base64-encoded character sprite image (with or without data:image prefix). Either image_url or base64_image must be provided.",
    },
    positive: {
      type: "string",
      description:
        "Simple, natural animation prompt (1-2 sentences). Describe the overall motion naturally - DO NOT use technical phase breakdowns or frame-by-frame specs. Example: 'Pixel character performs a smooth walking cycle with arm swings, cape flutter, and dust particles from feet.'",
    },
    negative: {
      type: "string",
      description:
        "Negative prompt for unwanted elements (e.g., 'blurry, distorted, low quality').",
    },
    fps: {
      type: "number",
      enum: [10, 15, 21, 24, 30, 60],
      default: 21,
      description: "Frames per second. Use 21 or 24 for smooth animations (recommended). Avoid fps=10 as it produces choppy results.",
    },
    duration: {
      type: "number",
      enum: [0.5, 1, 1.5, 2, 2.5, 3, 5],
      default: 2,
      description: "Video duration in seconds. Default: 2.0",
    },
    seed: {
      type: "number",
      description:
        "Optional seed for reproducibility. If not provided, a random seed will be used.",
    },
    lora_name: {
      type: "string",
      description:
        "LoRA model name. Default: 'wan2.2_animate_adapter_epoch_95.safetensors'. DO NOT CHANGE.",
    },
    lora_strength: {
      type: "number",
      minimum: 0.0,
      maximum: 2.0,
      description: "LoRA strength (0.0-2.0). Default: 1.0. DO NOT CHANGE.",
    },
  },
  required: ["positive"],
  additionalProperties: false,
});

// Args interface for wan22PixelVideo
interface Wan22PixelVideoArgs {
  image_url?: string;
  base64_image?: string;
  positive: string;
  negative?: string;
  fps?: 10 | 15 | 21 | 24 | 30 | 60;
  duration?: 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 5;
  seed?: number;
  lora_name?: string;
  lora_strength?: number;
}

/**
 * Core wan22PixelVideo execution logic (extracted for logging wrapper)
 */
async function executeWan22PixelVideo(sessionId: string, args: Wan22PixelVideoArgs) {
  const {
    image_url,
    base64_image,
    positive,
    negative,
    fps,
    duration,
    seed,
    lora_name,
    lora_strength,
  } = args;

  if (!image_url && !base64_image) {
    return {
      status: "error",
      error: "Either image_url or base64_image must be provided",
    };
  }

  const toolRun = await createToolRun({
    sessionId,
    toolName: "generatePixelVideoWan22",
    args: {
      image_url,
      positive,
      negative,
      fps,
      duration,
      seed,
      lora_name,
      lora_strength,
    },
    status: "running",
  });

  try {
    const result = await callWan22Video(
      {
        image_url,
        base64_image,
        positive,
        negative,
        fps,
        duration,
        seed,
        lora_name: lora_name ?? "wan2.2_animate_adapter_epoch_95.safetensors",
        lora_strength: lora_strength ?? 1.0,
      },
      sessionId
    );

    if (isVideoAsyncResult(result)) {
      await updateToolRun(toolRun.id, {
        status: "pending",
        metadata: { jobId: result.jobId, statusUrl: result.statusUrl },
      });

      return {
        status: "processing",
        message:
          "WAN 2.2 pixel animation generation job started. The result will be available shortly.",
        jobId: result.jobId,
      };
    }

    for (const video of result.videos) {
      await createImage({
        sessionId,
        toolRunId: toolRun.id,
        role: "generated",
        localPath: video.localPath || video.url,
        url: video.url,
        format: video.format,
        metadata: {
          prompt: positive,
          fps: video.fps,
          duration: video.duration,
          mediaType: "video",
          toolType: "pixel-animation",
        },
      });
    }

    await updateToolRun(toolRun.id, {
      status: "succeeded",
      result: { videos: result.videos },
      completedAt: now(),
    });

    return {
      status: "completed",
      videos: result.videos,
      timeTaken: result.timeTaken,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    await updateToolRun(toolRun.id, {
      status: "failed",
      error: errorMessage,
      completedAt: now(),
    });

    return {
      status: "error",
      error: errorMessage,
    };
  }
}

export function createWan22PixelVideoTool(sessionId: string) {
  const executeWithLogging = withToolLogging(
    "generatePixelVideoWan22",
    sessionId,
    (args: Wan22PixelVideoArgs) => executeWan22PixelVideo(sessionId, args)
  );

  return tool({
    description: `Generate pixel art character sprite animations with WAN 2.2. Use searchTools first for parameters.`,
    inputSchema: wan22PixelVideoSchema,
    execute: executeWithLogging,
  });
}

