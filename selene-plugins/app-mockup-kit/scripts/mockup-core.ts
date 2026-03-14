import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PresetId =
  | "browser-chrome"
  | "browser-safari"
  | "iphone-14-pro"
  | "pixel-6-pro"
  | "ipad-pro"
  | "macbook-pro"
  | "window"
  | "plain";

export type ShadowStyle = "none" | "soft" | "lifted";
export type BackgroundSpec = `solid:${string}` | `gradient:${string},${string}` | "transparent";

type FrameKind = "browser" | "iphone" | "pixel" | "tablet" | "laptop" | "window" | "plain";

export interface RenderOptions {
  input: string;
  output: string;
  preset: PresetId;
  title?: string;
  subtitle?: string;
  url?: string;
  background: BackgroundSpec;
  padding: number;
  shadow: ShadowStyle;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface FrameModel {
  id: PresetId;
  kind: FrameKind;
  width: number;
  height: number;
  frame: Rect;
  display: Rect;
  topBar?: Rect;
  metadata?: Record<string, number | string>;
}

interface DrawContext {
  model: FrameModel;
  imageHref: string;
  title?: string;
  subtitle?: string;
  url?: string;
  frameShadowId: string;
  displayClipId: string;
}

const FRAME_MODELS: Record<PresetId, FrameModel> = {
  "browser-chrome": {
    id: "browser-chrome",
    kind: "browser",
    width: 1600,
    height: 1020,
    frame: { x: 48, y: 48, width: 1504, height: 924, radius: 24 },
    topBar: { x: 48, y: 48, width: 1504, height: 102, radius: 24 },
    display: { x: 48, y: 150, width: 1504, height: 822, radius: 0 },
    metadata: {
      variant: "chrome",
      controlsHeight: 50,
      controlsInset: 28,
      trafficLightSize: 14,
      trafficLightGap: 9,
      addressBarHeight: 30,
      addressBarRadius: 8,
      navWidth: 70,
      settingsWidth: 30,
    },
  },
  "browser-safari": {
    id: "browser-safari",
    kind: "browser",
    width: 1600,
    height: 1020,
    frame: { x: 48, y: 48, width: 1504, height: 924, radius: 24 },
    topBar: { x: 48, y: 48, width: 1504, height: 102, radius: 24 },
    display: { x: 48, y: 150, width: 1504, height: 822, radius: 0 },
    metadata: {
      variant: "safari",
      controlsHeight: 50,
      controlsInset: 28,
      trafficLightSize: 12,
      trafficLightGap: 8,
      addressBarHeight: 30,
      addressBarRadius: 15,
      navWidth: 0,
      settingsWidth: 0,
    },
  },
  "iphone-14-pro": {
    id: "iphone-14-pro",
    kind: "iphone",
    width: 428,
    height: 868,
    frame: { x: 0, y: 0, width: 428, height: 868, radius: 68 },
    display: { x: 19, y: 19, width: 390, height: 830, radius: 49 },
    metadata: {
      shellBorder: 1,
      shellInset: 6,
      topStripeOffset: 85,
      bottomStripeOffset: 85,
      stripeWidth: 7,
      headerWidth: 120,
      headerHeight: 35,
      headerTop: 29,
      islandWidth: 74,
      islandHeight: 33,
      islandTop: 30,
      cameraSize: 9,
      cameraOffsetX: 36,
      cameraTop: 42,
      sideButtonWidth: 3,
      sideButtonTop: 115,
      sideButtonHeight: 32,
      sideButtonGapOne: 60,
      sideButtonGapTwo: 140,
      powerButtonTop: 200,
      powerButtonHeight: 100,
    },
  },
  "pixel-6-pro": {
    id: "pixel-6-pro",
    kind: "pixel",
    width: 404,
    height: 862,
    frame: { x: 2, y: 0, width: 400, height: 862, radius: 28 },
    display: { x: 14, y: 20, width: 376, height: 816, radius: 27 },
    metadata: {
      headerWidth: 294,
      headerHeight: 10,
      sensorSize: 22,
      sensorTop: 39,
      sensorBarWidth: 206,
      sensorBarHeight: 4,
      sensorBarTopOffset: -18,
      accentBottomWidth: 44,
      accentBottomHeight: 2,
      accentSideWidth: 11,
      accentSideHeight: 9,
      buttonWidth: 3,
      volumeTop: 306,
      volumeHeight: 102,
      powerTop: 194,
      powerHeight: 58,
    },
  },
  "ipad-pro": {
    id: "ipad-pro",
    kind: "tablet",
    width: 560,
    height: 778,
    frame: { x: 0, y: 0, width: 560, height: 778, radius: 36 },
    display: { x: 27, y: 27, width: 506, height: 724, radius: 11 },
    metadata: {
      shellInsetOne: 1,
      shellInsetTwo: 3,
      topButtonWidth: 36,
      topButtonHeight: 2,
      topButtonRight: 40,
      sideButtonWidth: 2,
      sideButtonHeight: 32,
      sideButtonTop: 63,
      sideButtonGap: 37,
      sensorPillSize: 10,
      sensorPillSpacingLeft: -20,
      sensorPillSpacingRight: 70,
      sensorTop: 12,
      cameraSize: 6,
      cameraTop: 14,
    },
  },
  "macbook-pro": {
    id: "macbook-pro",
    kind: "laptop",
    width: 740,
    height: 434,
    frame: { x: 61, y: 0, width: 618, height: 418, radius: 20 },
    display: { x: 70, y: 9, width: 600, height: 375, radius: 10 },
    metadata: {
      bottomLipHeight: 24,
      notchWidth: 64,
      notchHeight: 12,
      notchTop: 11,
      baseY: 408,
      baseWidth: 740,
      baseHeight: 24,
      baseCutoutWidth: 120,
      baseCutoutHeight: 10,
      baseShadowSpan: 300,
    },
  },
  window: {
    id: "window",
    kind: "window",
    width: 1500,
    height: 980,
    frame: { x: 30, y: 30, width: 1440, height: 920, radius: 26 },
    topBar: { x: 30, y: 30, width: 1440, height: 84, radius: 26 },
    display: { x: 72, y: 114, width: 1356, height: 792, radius: 12 },
    metadata: {
      trafficLightSize: 16,
      trafficLightGap: 10,
    },
  },
  plain: {
    id: "plain",
    kind: "plain",
    width: 1440,
    height: 960,
    frame: { x: 40, y: 40, width: 1360, height: 880, radius: 30 },
    display: { x: 64, y: 64, width: 1312, height: 832, radius: 22 },
  },
};

export function listPresets(): PresetId[] {
  return Object.keys(FRAME_MODELS) as PresetId[];
}

export function getFrameModel(preset: PresetId): FrameModel {
  return FRAME_MODELS[preset];
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function extToMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

async function loadInputAsDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) {
    return input;
  }

  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to fetch input image: ${response.status} ${response.statusText}`);
    }
    const mime = response.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  const buffer = await readFile(input);
  return `data:${extToMime(input)};base64,${buffer.toString("base64")}`;
}

function buildBackground(background: BackgroundSpec, width: number, height: number): string {
  if (background === "transparent") {
    return "";
  }

  if (background.startsWith("solid:")) {
    const color = escapeXml(background.slice("solid:".length));
    return `<rect width="${width}" height="${height}" fill="${color}" rx="36" />`;
  }

  const gradient = background.slice("gradient:".length);
  const [from, to] = gradient.split(",").map((part) => escapeXml(part.trim()));
  return `
    <defs>
      <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${from}" />
        <stop offset="100%" stop-color="${to}" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg-gradient)" rx="36" />
  `;
}

function buildShadowFilter(style: ShadowStyle, filterId: string): string {
  if (style === "none") {
    return "";
  }

  if (style === "lifted") {
    return `
      <filter id="${filterId}" x="-20%" y="-20%" width="160%" height="180%">
        <feDropShadow dx="0" dy="30" stdDeviation="28" flood-color="#020617" flood-opacity="0.28" />
        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#020617" flood-opacity="0.18" />
      </filter>
    `;
  }

  return `
    <filter id="${filterId}" x="-20%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020617" flood-opacity="0.18" />
    </filter>
  `;
}

function buildCaption(title?: string, subtitle?: string, width = 0): string {
  if (!title && !subtitle) {
    return "";
  }

  const titleY = 86;
  const subtitleY = subtitle ? 124 : 0;
  return `
    <g transform="translate(${width / 2}, 0)">
      ${title ? `<text x="0" y="${titleY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="700" fill="#e5eefb">${escapeXml(title)}</text>` : ""}
      ${subtitle ? `<text x="0" y="${subtitleY}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" font-weight="500" fill="#bfd0ea">${escapeXml(subtitle)}</text>` : ""}
    </g>
  `;
}

function displayDefs(ctx: DrawContext): string {
  const { display } = ctx.model;
  return `
    <clipPath id="${ctx.displayClipId}">
      <rect x="${display.x}" y="${display.y}" width="${display.width}" height="${display.height}" rx="${display.radius ?? 0}" ry="${display.radius ?? 0}" />
    </clipPath>
  `;
}

function displayImage(ctx: DrawContext): string {
  const { display } = ctx.model;
  return `<image href="${ctx.imageHref}" x="${display.x}" y="${display.y}" width="${display.width}" height="${display.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${ctx.displayClipId})" />`;
}

function drawTrafficLights(x: number, y: number, size: number, gap: number): string {
  const radius = size / 2;
  return ["#ff5f57", "#febc2e", "#28c840"].map((fill, index) => {
    const cx = x + radius + index * (size + gap);
    return `<circle cx="${cx}" cy="${y + radius}" r="${radius}" fill="${fill}" />`;
  }).join("");
}

function browserSvg(ctx: DrawContext): string {
  const { model, url, frameShadowId } = ctx;
  const topBar = model.topBar!;
  const meta = model.metadata!;
  const variant = String(meta.variant);
  const controlsInset = Number(meta.controlsInset);
  const controlsHeight = Number(meta.controlsHeight);
  const trafficLightSize = Number(meta.trafficLightSize);
  const trafficLightGap = Number(meta.trafficLightGap);
  const addressBarHeight = Number(meta.addressBarHeight);
  const addressBarRadius = Number(meta.addressBarRadius);
  const navWidth = Number(meta.navWidth);
  const settingsWidth = Number(meta.settingsWidth);
  const trafficLightsWidth = trafficLightSize * 3 + trafficLightGap * 2;
  const leftClusterWidth = variant === "safari" ? trafficLightsWidth : trafficLightsWidth + navWidth + 24;
  const rightClusterWidth = variant === "safari" ? 24 : settingsWidth + 24;
  const addressBarX = topBar.x + controlsInset + leftClusterWidth;
  const addressBarY = topBar.y + (topBar.height - addressBarHeight) / 2 + 4;
  const addressBarWidth = topBar.width - controlsInset * 2 - leftClusterWidth - rightClusterWidth;
  const chromeBg = variant === "safari" ? "#eef2f7" : "#e6ecefcf";
  const controlsBg = variant === "safari" ? "#ffffff" : "#ffffffa8";
  const bodyStroke = variant === "safari" ? "#cfd8e3" : "#d7dee8";

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="#ffffff" stroke="${bodyStroke}" stroke-width="2" />
      <path d="M ${model.frame.x + model.frame.radius} ${topBar.y} H ${model.frame.x + model.frame.width - model.frame.radius} Q ${model.frame.x + model.frame.width} ${topBar.y} ${model.frame.x + model.frame.width} ${topBar.y + model.frame.radius} V ${topBar.y + topBar.height} H ${model.frame.x} V ${topBar.y + model.frame.radius} Q ${model.frame.x} ${topBar.y} ${model.frame.x + model.frame.radius} ${topBar.y} Z" fill="${chromeBg}" />
      ${displayImage(ctx)}
      <rect x="${addressBarX}" y="${addressBarY}" width="${addressBarWidth}" height="${addressBarHeight}" rx="${addressBarRadius}" fill="${controlsBg}" stroke="#d7dee8" />
      ${drawTrafficLights(topBar.x + controlsInset, topBar.y + (topBar.height - trafficLightSize) / 2 + 4, trafficLightSize, trafficLightGap)}
      ${variant === "chrome" ? `<g fill="#94a3b8"><path d="M ${topBar.x + controlsInset + trafficLightsWidth + 14} ${topBar.y + controlsHeight / 2 + 7} l -9 -7 h 18 z" /><path d="M ${topBar.x + controlsInset + trafficLightsWidth + 42} ${topBar.y + controlsHeight / 2} l 9 -7 v 14 z" /></g>` : ""}
      <text x="${addressBarX + addressBarWidth / 2}" y="${addressBarY + addressBarHeight / 2 + 7}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="500" fill="#64748b">${escapeXml(url || "example.app")}</text>
      ${variant === "chrome" ? `<circle cx="${model.frame.x + model.frame.width - controlsInset - 15}" cy="${topBar.y + topBar.height / 2 + 4}" r="10" fill="${controlsBg}" stroke="#d7dee8" />` : ""}
    </g>
  `;
}

function iphoneSvg(ctx: DrawContext): string {
  const { model, frameShadowId } = ctx;
  const meta = model.metadata!;
  const headerWidth = Number(meta.headerWidth);
  const headerHeight = Number(meta.headerHeight);
  const headerTop = Number(meta.headerTop);
  const islandWidth = Number(meta.islandWidth);
  const islandHeight = Number(meta.islandHeight);
  const islandTop = Number(meta.islandTop);
  const cameraSize = Number(meta.cameraSize);
  const cameraOffsetX = Number(meta.cameraOffsetX);
  const cameraTop = Number(meta.cameraTop);
  const sideButtonWidth = Number(meta.sideButtonWidth);
  const sideButtonTop = Number(meta.sideButtonTop);
  const sideButtonHeight = Number(meta.sideButtonHeight);
  const sideButtonGapOne = Number(meta.sideButtonGapOne);
  const sideButtonGapTwo = Number(meta.sideButtonGapTwo);
  const powerButtonTop = Number(meta.powerButtonTop);
  const powerButtonHeight = Number(meta.powerButtonHeight);
  const stripeWidth = Number(meta.stripeWidth);
  const topStripeOffset = Number(meta.topStripeOffset);
  const bottomStripeOffset = Number(meta.bottomStripeOffset);

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="0" y="0" width="${model.width}" height="${model.height}" rx="${model.frame.radius}" fill="#010101" stroke="#1b1721" stroke-width="1" />
      <rect x="6" y="6" width="${model.width - 12}" height="${model.height - 12}" rx="${model.frame.radius - 6}" fill="none" stroke="#342c3f" stroke-width="6" />
      ${displayImage(ctx)}
      <rect x="0" y="${topStripeOffset}" width="${model.width}" height="7" fill="rgba(1,1,1,0.25)" />
      <rect x="0" y="${model.height - bottomStripeOffset - 7}" width="${model.width}" height="7" fill="rgba(1,1,1,0.25)" />
      <rect x="${(model.width - headerWidth) / 2}" y="${headerTop}" width="${headerWidth}" height="${headerHeight}" rx="20" fill="#010101" />
      <rect x="${(model.width - islandWidth) / 2}" y="${islandTop}" width="${islandWidth}" height="${islandHeight}" rx="17" fill="#010101" />
      <circle cx="${model.width / 2 + cameraOffsetX + cameraSize / 2}" cy="${cameraTop + cameraSize / 2}" r="${cameraSize / 2}" fill="url(#iphone-camera)" />
      <rect x="-2" y="${sideButtonTop}" width="${sideButtonWidth}" height="${sideButtonHeight}" rx="2" fill="#1b1721" />
      <rect x="-2" y="${sideButtonTop + sideButtonGapOne}" width="${sideButtonWidth}" height="62" rx="2" fill="#1b1721" />
      <rect x="-2" y="${sideButtonTop + sideButtonGapTwo}" width="${sideButtonWidth}" height="62" rx="2" fill="#1b1721" />
      <rect x="${model.width - 1}" y="${powerButtonTop}" width="${sideButtonWidth}" height="${powerButtonHeight}" rx="2" fill="#1b1721" />
      <rect x="${stripeWidth}" y="${topStripeOffset}" width="${model.width - stripeWidth * 2}" height="7" fill="none" stroke="rgba(1,1,1,0.25)" stroke-width="0" />
    </g>
  `;
}

function pixelSvg(ctx: DrawContext): string {
  const { model, frameShadowId } = ctx;
  const meta = model.metadata!;
  const headerWidth = Number(meta.headerWidth);
  const headerHeight = Number(meta.headerHeight);
  const sensorSize = Number(meta.sensorSize);
  const sensorTop = Number(meta.sensorTop);
  const sensorBarWidth = Number(meta.sensorBarWidth);
  const sensorBarHeight = Number(meta.sensorBarHeight);
  const sensorBarTopOffset = Number(meta.sensorBarTopOffset);
  const accentBottomWidth = Number(meta.accentBottomWidth);
  const accentBottomHeight = Number(meta.accentBottomHeight);
  const accentSideWidth = Number(meta.accentSideWidth);
  const accentSideHeight = Number(meta.accentSideHeight);
  const buttonWidth = Number(meta.buttonWidth);
  const volumeTop = Number(meta.volumeTop);
  const volumeHeight = Number(meta.volumeHeight);
  const powerTop = Number(meta.powerTop);
  const powerHeight = Number(meta.powerHeight);

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="#121212" />
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="none" stroke="#fdfdfc" stroke-width="6" stroke-linejoin="round" opacity="0.9" />
      <rect x="${(model.width - headerWidth) / 2}" y="0" width="${headerWidth}" height="${headerHeight}" fill="url(#pixel-topbar)" />
      ${displayImage(ctx)}
      <rect x="${model.width / 2 - sensorBarWidth / 2}" y="${sensorTop + sensorBarTopOffset}" width="${sensorBarWidth}" height="${sensorBarHeight}" rx="2" fill="url(#pixel-sensor-bar)" />
      <circle cx="${model.width / 2}" cy="${sensorTop}" r="${sensorSize / 2}" fill="#121212" />
      <circle cx="${model.width / 2}" cy="${sensorTop}" r="4" fill="url(#iphone-camera)" />
      <rect x="${model.width / 2 - accentBottomWidth / 2}" y="${model.height - accentBottomHeight}" width="${accentBottomWidth}" height="${accentBottomHeight}" rx="2" fill="url(#pixel-bottom-accent)" />
      <rect x="${model.width / 2 + 40}" y="${model.height - accentSideHeight}" width="${accentSideWidth}" height="${accentSideHeight}" fill="#cbcbc8" />
      <rect x="${model.width - buttonWidth}" y="${powerTop}" width="${buttonWidth}" height="${powerHeight}" fill="#b2b2ae" />
      <rect x="${model.width - buttonWidth}" y="${volumeTop}" width="${buttonWidth}" height="${volumeHeight}" fill="#b2b2ae" />
    </g>
  `;
}

function tabletSvg(ctx: DrawContext): string {
  const { model, frameShadowId } = ctx;
  const meta = model.metadata!;
  const topButtonWidth = Number(meta.topButtonWidth);
  const topButtonHeight = Number(meta.topButtonHeight);
  const topButtonRight = Number(meta.topButtonRight);
  const sideButtonWidth = Number(meta.sideButtonWidth);
  const sideButtonHeight = Number(meta.sideButtonHeight);
  const sideButtonTop = Number(meta.sideButtonTop);
  const sideButtonGap = Number(meta.sideButtonGap);
  const sensorPillSize = Number(meta.sensorPillSize);
  const sensorTop = Number(meta.sensorTop);
  const cameraSize = Number(meta.cameraSize);
  const cameraTop = Number(meta.cameraTop);

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="0" y="0" width="${model.width}" height="${model.height}" rx="${model.frame.radius}" fill="#0d0d0d" />
      <rect x="1" y="1" width="${model.width - 2}" height="${model.height - 2}" rx="${model.frame.radius - 1}" fill="none" stroke="#babdbf" stroke-width="1" />
      <rect x="3" y="3" width="${model.width - 6}" height="${model.height - 6}" rx="${model.frame.radius - 3}" fill="none" stroke="#e2e3e4" stroke-width="2" />
      ${displayImage(ctx)}
      <rect x="${model.width - topButtonRight - topButtonWidth}" y="-2" width="${topButtonWidth}" height="${topButtonHeight}" fill="#babdbf" />
      <rect x="${model.width - sideButtonWidth}" y="${sideButtonTop}" width="${sideButtonWidth}" height="${sideButtonHeight}" fill="#babdbf" />
      <rect x="${model.width - sideButtonWidth}" y="${sideButtonTop + sideButtonGap}" width="${sideButtonWidth}" height="${sideButtonHeight}" fill="#babdbf" />
      <circle cx="${model.width / 2 - 20}" cy="${sensorTop + sensorPillSize / 2}" r="${sensorPillSize / 2}" fill="#1a1a1a" />
      <circle cx="${model.width / 2}" cy="${sensorTop + cameraSize / 2}" r="${cameraSize / 2}" fill="url(#iphone-camera)" />
      <circle cx="${model.width / 2 + 70}" cy="${sensorTop + sensorPillSize / 2}" r="${sensorPillSize / 2}" fill="#1a1a1a" />
    </g>
  `;
}

function laptopSvg(ctx: DrawContext): string {
  const { model, frameShadowId } = ctx;
  const meta = model.metadata!;
  const bottomLipHeight = Number(meta.bottomLipHeight);
  const notchWidth = Number(meta.notchWidth);
  const notchHeight = Number(meta.notchHeight);
  const notchTop = Number(meta.notchTop);
  const baseY = Number(meta.baseY);
  const baseWidth = Number(meta.baseWidth);
  const baseHeight = Number(meta.baseHeight);
  const baseCutoutWidth = Number(meta.baseCutoutWidth);
  const baseCutoutHeight = Number(meta.baseCutoutHeight);
  const baseShadowSpan = Number(meta.baseShadowSpan);

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="#0d0d0d" />
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="none" stroke="#c8cacb" stroke-width="2" />
      <rect x="${model.frame.x + 2}" y="${model.frame.y + model.frame.height - bottomLipHeight - 2}" width="${model.frame.width - 4}" height="${bottomLipHeight}" rx="18" fill="url(#laptop-bottom-lip)" />
      ${displayImage(ctx)}
      <path d="M ${model.width / 2 - notchWidth / 2} ${notchTop} h ${notchWidth} v ${notchHeight} q 0 4 -4 4 h -${notchWidth - 8} q -4 0 -4 -4 z" fill="#0d0d0d" />
      <rect x="0" y="${baseY}" width="${baseWidth}" height="${baseHeight}" rx="12" fill="url(#laptop-base)" stroke="#a0a3a7" stroke-width="1" />
      <rect x="${model.width / 2 - baseCutoutWidth / 2}" y="${baseY}" width="${baseCutoutWidth}" height="${baseCutoutHeight}" rx="0 0 10 10" fill="#e2e3e4" />
      <rect x="${model.width / 2 - 20}" y="${baseY + baseHeight - 2}" width="40" height="2" fill="transparent" />
      <rect x="${model.width / 2 - 20 - baseShadowSpan}" y="${baseY + baseHeight - 2}" width="${baseShadowSpan}" height="2" fill="#272727" />
      <rect x="${model.width / 2 + 20}" y="${baseY + baseHeight - 2}" width="${baseShadowSpan}" height="2" fill="#272727" />
    </g>
  `;
}

function windowSvg(ctx: DrawContext): string {
  const { model, url, frameShadowId } = ctx;
  const topBar = model.topBar!;
  const meta = model.metadata!;
  const size = Number(meta.trafficLightSize);
  const gap = Number(meta.trafficLightGap);

  return `
    <g filter="url(#${frameShadowId})">
      <rect x="${model.frame.x}" y="${model.frame.y}" width="${model.frame.width}" height="${model.frame.height}" rx="${model.frame.radius}" fill="#f8fafc" />
      <path d="M ${model.frame.x + model.frame.radius} ${topBar.y} H ${model.frame.x + model.frame.width - model.frame.radius} Q ${model.frame.x + model.frame.width} ${topBar.y} ${model.frame.x + model.frame.width} ${topBar.y + model.frame.radius} V ${topBar.y + topBar.height} H ${model.frame.x} V ${topBar.y + model.frame.radius} Q ${model.frame.x} ${topBar.y} ${model.frame.x + model.frame.radius} ${topBar.y} Z" fill="#e2e8f0" />
      ${displayImage(ctx)}
      ${drawTrafficLights(model.frame.x + 44, topBar.y + 26, size, gap)}
      <text x="${model.width / 2}" y="${topBar.y + 48}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="600" fill="#334155">${escapeXml(url || "Desktop Preview")}</text>
    </g>
  `;
}

function plainSvg(ctx: DrawContext): string {
  return `
    <g>
      <rect x="${ctx.model.frame.x}" y="${ctx.model.frame.y}" width="${ctx.model.frame.width}" height="${ctx.model.frame.height}" rx="${ctx.model.frame.radius}" fill="#ffffff" />
      ${displayImage(ctx)}
    </g>
  `;
}

function renderFrame(ctx: DrawContext): string {
  switch (ctx.model.kind) {
    case "browser":
      return browserSvg(ctx);
    case "iphone":
      return iphoneSvg(ctx);
    case "pixel":
      return pixelSvg(ctx);
    case "tablet":
      return tabletSvg(ctx);
    case "laptop":
      return laptopSvg(ctx);
    case "window":
      return windowSvg(ctx);
    case "plain":
      return plainSvg(ctx);
  }
}

export async function renderMockup(options: RenderOptions): Promise<{ outputPath: string; svg: string }> {
  const model = getFrameModel(options.preset);
  if (!model) {
    throw new Error(`Unknown preset: ${options.preset}`);
  }

  const padding = Math.max(0, options.padding);
  const captionOffset = options.title || options.subtitle ? 130 : 0;
  const canvasWidth = model.width + padding * 2;
  const canvasHeight = model.height + padding * 2 + captionOffset;
  const frameShadowId = "frame-shadow";
  const displayClipId = `display-clip-${model.id}`;
  const imageHref = await loadInputAsDataUrl(options.input);
  const caption = buildCaption(options.title, options.subtitle, canvasWidth);
  const shadowFilter = buildShadowFilter(options.shadow, frameShadowId);
  const background = buildBackground(options.background, canvasWidth, canvasHeight);

  const ctx: DrawContext = {
    model,
    imageHref,
    title: options.title,
    subtitle: options.subtitle,
    url: options.url,
    frameShadowId,
    displayClipId,
  };

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" fill="none">
  <defs>
    ${shadowFilter}
    ${displayDefs(ctx)}
    <radialGradient id="iphone-camera" cx="30%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#6074bf" />
      <stop offset="35%" stop-color="#513785" />
      <stop offset="60%" stop-color="#24555e" />
      <stop offset="100%" stop-color="#111827" />
    </radialGradient>
    <linearGradient id="pixel-topbar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8d8d86" />
      <stop offset="30%" stop-color="#cbcbc8" />
      <stop offset="100%" stop-color="#cbcbc8" />
    </linearGradient>
    <linearGradient id="pixel-sensor-bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#121212" />
      <stop offset="100%" stop-color="#666661" />
    </linearGradient>
    <linearGradient id="pixel-bottom-accent" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#121212" />
      <stop offset="100%" stop-color="#666661" />
    </linearGradient>
    <linearGradient id="laptop-bottom-lip" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#272727" />
      <stop offset="100%" stop-color="#0d0d0d" />
    </linearGradient>
    <radialGradient id="laptop-base" cx="50%" cy="30%" r="90%">
      <stop offset="0%" stop-color="#e2e3e4" />
      <stop offset="100%" stop-color="#c8cacb" />
    </radialGradient>
  </defs>
  ${background}
  ${caption}
  <g transform="translate(${padding}, ${padding + captionOffset})">
    ${renderFrame(ctx)}
  </g>
</svg>`;

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, svg, "utf8");
  return { outputPath: options.output, svg };
}
