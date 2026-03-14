import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMockup, listPresets, type BackgroundSpec, type PresetId, type RenderOptions, type ShadowStyle } from "./mockup-core.js";

function parseArgs(argv: string[]): RenderOptions {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args.set(token, "true");
      continue;
    }
    args.set(token, next);
    index += 1;
  }

  if (args.has("--help") || argv.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (args.has("--list-presets")) {
    for (const preset of listPresets()) {
      console.log(preset);
    }
    process.exit(0);
  }

  const input = args.get("--input");
  const output = args.get("--output");
  const preset = args.get("--preset") as PresetId | undefined;
  if (!input) throw new Error("Missing required flag: --input");
  if (!output) throw new Error("Missing required flag: --output");
  if (!preset) throw new Error("Missing required flag: --preset");
  if (!listPresets().includes(preset)) throw new Error(`Unsupported preset: ${preset}`);

  const background = (args.get("--background") || "gradient:#0f172a,#2563eb") as BackgroundSpec;
  const shadow = (args.get("--shadow") || "lifted") as ShadowStyle;
  const padding = Number(args.get("--padding") || "64");

  if (!Number.isFinite(padding) || padding < 0) {
    throw new Error("--padding must be a non-negative number");
  }

  return {
    input,
    output,
    preset,
    title: args.get("--title") || undefined,
    subtitle: args.get("--subtitle") || undefined,
    url: args.get("--url") || undefined,
    background,
    padding,
    shadow,
  };
}

function printHelp(): void {
  console.log(`Usage:
  tsx scripts/render-mockup.ts --input <path-or-url> --output <file.svg> --preset <preset> [options]

Options:
  --title <text>
  --subtitle <text>
  --url <text>
  --background <solid:#hex | gradient:#hex,#hex | transparent>
  --padding <number>
  --shadow <none | soft | lifted>
  --list-presets
  --help`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await renderMockup(options);
  console.log(JSON.stringify({
    ok: true,
    output: result.outputPath,
    preset: options.preset,
    title: options.title || null,
    subtitle: options.subtitle || null,
  }, null, 2));
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (typeof entry !== "string") {
    return false;
  }

  const normalizedEntry = path.resolve(entry);
  const currentFile = fileURLToPath(import.meta.url);
  return normalizedEntry === currentFile;
}

if (isDirectExecution()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { parseArgs };
