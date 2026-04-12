import fs from "fs/promises";
import { existsSync, statSync, readdirSync } from "fs";
import { join, relative, basename, extname } from "path";

export type FrameworkType =
  | "react"
  | "nextjs"
  | "vue"
  | "nuxt"
  | "svelte"
  | "sveltekit"
  | "angular"
  | "astro"
  | "php"
  | "laravel"
  | "django"
  | "flask"
  | "static"
  | "unknown";

export interface DetectedFramework {
  type: FrameworkType;
  version?: string;
  buildTool: "esbuild" | "vite" | "webpack" | "none" | "custom";
  cssFramework: "tailwind" | "css-modules" | "sass" | "plain" | "unknown";
  entryPoints: string[];
  configFiles: string[];
  packageManager:
    | "npm"
    | "yarn"
    | "pnpm"
    | "bun"
    | "composer"
    | "pip"
    | "unknown";
}

export interface ProjectEntry {
  path: string;
  name: string;
  route?: string;
  type: "page" | "component" | "layout" | "style" | "api" | "other";
}

export interface ProjectStructure {
  pages: ProjectEntry[];
  components: ProjectEntry[];
  layouts: ProjectEntry[];
  styles: ProjectEntry[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileExists(filePath: string): boolean {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

function globMatch(dir: string, prefix: string): string | undefined {
  try {
    const entries = readdirSync(dir);
    return entries.find((e) => e.startsWith(prefix));
  } catch {
    return undefined;
  }
}

function readJsonSync(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("fs").readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function detectPackageManager(
  root: string
):
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "composer"
  | "pip"
  | "unknown" {
  if (fileExists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fileExists(join(root, "yarn.lock"))) return "yarn";
  if (fileExists(join(root, "bun.lockb"))) return "bun";
  if (fileExists(join(root, "package-lock.json"))) return "npm";
  if (fileExists(join(root, "composer.lock"))) return "composer";
  if (fileExists(join(root, "requirements.txt"))) return "pip";
  if (fileExists(join(root, "package.json"))) return "npm";
  return "unknown";
}

function detectCssFramework(
  root: string
): "tailwind" | "css-modules" | "sass" | "plain" | "unknown" {
  if (globMatch(root, "tailwind.config")) return "tailwind";

  // Recursively check for css-modules or sass (shallow scan to avoid perf issues)
  try {
    const dirsToScan = ["src", "app", "components", "styles", "pages"].filter(
      (d) => fileExists(join(root, d))
    );
    for (const dir of dirsToScan) {
      const found = scanDirShallow(join(root, dir));
      if (found.hasCssModules) return "css-modules";
      if (found.hasSass) return "sass";
    }
  } catch {
    // ignore scan errors
  }

  return "plain";
}

function scanDirShallow(dir: string): {
  hasCssModules: boolean;
  hasSass: boolean;
} {
  let hasCssModules = false;
  let hasSass = false;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        if (entry.name.includes(".module.css")) hasCssModules = true;
        if (entry.name.endsWith(".scss") || entry.name.endsWith(".sass"))
          hasSass = true;
      } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const sub = scanDirShallow(join(dir, entry.name));
        if (sub.hasCssModules) hasCssModules = true;
        if (sub.hasSass) hasSass = true;
      }
      if (hasCssModules || hasSass) break;
    }
  } catch {
    // ignore
  }
  return { hasCssModules, hasSass };
}

function collectEntryPoints(
  root: string,
  framework: FrameworkType
): string[] {
  const candidates: string[] = [];
  switch (framework) {
    case "nextjs":
      if (fileExists(join(root, "app", "layout.tsx")))
        candidates.push("app/layout.tsx");
      if (fileExists(join(root, "app", "layout.ts")))
        candidates.push("app/layout.ts");
      if (fileExists(join(root, "pages", "_app.tsx")))
        candidates.push("pages/_app.tsx");
      if (fileExists(join(root, "pages", "_app.js")))
        candidates.push("pages/_app.js");
      break;
    case "react":
      for (const p of [
        "src/index.tsx",
        "src/index.jsx",
        "src/index.ts",
        "src/index.js",
        "src/main.tsx",
        "src/main.jsx",
        "index.html",
      ]) {
        if (fileExists(join(root, p))) candidates.push(p);
      }
      break;
    case "vue":
    case "nuxt":
      for (const p of ["src/main.ts", "src/main.js", "app.vue"]) {
        if (fileExists(join(root, p))) candidates.push(p);
      }
      break;
    case "svelte":
    case "sveltekit":
      for (const p of [
        "src/routes/+layout.svelte",
        "src/main.ts",
        "src/main.js",
      ]) {
        if (fileExists(join(root, p))) candidates.push(p);
      }
      break;
    case "angular":
      if (fileExists(join(root, "src", "main.ts")))
        candidates.push("src/main.ts");
      break;
    case "astro":
      if (fileExists(join(root, "src", "pages", "index.astro")))
        candidates.push("src/pages/index.astro");
      break;
    case "laravel":
      if (fileExists(join(root, "public", "index.php")))
        candidates.push("public/index.php");
      break;
    case "php":
      if (fileExists(join(root, "index.php"))) candidates.push("index.php");
      break;
    case "django":
      if (fileExists(join(root, "manage.py"))) candidates.push("manage.py");
      break;
    case "flask":
      for (const p of ["app.py", "main.py", "wsgi.py"]) {
        if (fileExists(join(root, p))) candidates.push(p);
      }
      break;
    case "static":
      if (fileExists(join(root, "index.html"))) candidates.push("index.html");
      break;
    default:
      break;
  }
  return candidates;
}

function collectConfigFiles(root: string): string[] {
  const configs: string[] = [];
  const knownConfigs = [
    "package.json",
    "tsconfig.json",
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "nuxt.config.ts",
    "nuxt.config.js",
    "svelte.config.js",
    "svelte.config.ts",
    "angular.json",
    "astro.config.mjs",
    "astro.config.ts",
    "vite.config.ts",
    "vite.config.js",
    "webpack.config.js",
    "tailwind.config.js",
    "tailwind.config.ts",
    "tailwind.config.cjs",
    "postcss.config.js",
    "postcss.config.cjs",
    "composer.json",
    "requirements.txt",
    ".eslintrc.json",
    "eslint.config.js",
    "prettier.config.js",
    ".prettierrc",
  ];
  for (const c of knownConfigs) {
    if (fileExists(join(root, c))) configs.push(c);
  }
  return configs;
}

// ---------------------------------------------------------------------------
// Recursive directory scan helpers for buildProjectStructure
// ---------------------------------------------------------------------------

const SCAN_EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "out",
  "target",
  ".cache",
  "storybook-static",
  "__pycache__",
  ".venv",
]);

async function scanDirectory(
  dir: string,
  root: string,
  extensions: string[],
  maxDepth: number = 6,
  currentDepth: number = 0
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SCAN_EXCLUDED_DIRS.has(entry.name))
        continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await scanDirectory(
          fullPath,
          root,
          extensions,
          maxDepth,
          currentDepth + 1
        );
        results.push(...sub);
      } else if (
        entry.isFile() &&
        extensions.some((ext) => entry.name.endsWith(ext))
      ) {
        results.push(relative(root, fullPath).replace(/\\/g, "/"));
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return results;
}

function filePathToRoute(filePath: string, framework: FrameworkType): string | undefined {
  if (framework === "nextjs") {
    // App Router: app/dashboard/page.tsx -> /dashboard
    const appMatch = filePath.match(/^app\/(.+)\/page\.\w+$/);
    if (appMatch) {
      const route = "/" + appMatch[1].replace(/\/\(.*?\)/g, "");
      return route === "/" ? "/" : route;
    }
    if (filePath.match(/^app\/page\.\w+$/)) return "/";

    // Pages Router: pages/about.tsx -> /about, pages/blog/index.tsx -> /blog
    const pagesMatch = filePath.match(/^pages\/(.+)\.\w+$/);
    if (pagesMatch) {
      const seg = pagesMatch[1];
      if (seg === "index") return "/";
      if (seg.startsWith("_")) return undefined; // _app, _document
      return "/" + seg.replace(/\/index$/, "");
    }
  }

  if (framework === "nuxt" || framework === "vue") {
    const pagesMatch = filePath.match(/^pages\/(.+)\.\w+$/);
    if (pagesMatch) {
      const seg = pagesMatch[1];
      if (seg === "index") return "/";
      return "/" + seg.replace(/\/index$/, "");
    }
  }

  if (framework === "sveltekit" || framework === "svelte") {
    const routeMatch = filePath.match(
      /^src\/routes\/(.+)\/\+page\.svelte$/
    );
    if (routeMatch) return "/" + routeMatch[1];
    if (filePath === "src/routes/+page.svelte") return "/";
  }

  if (framework === "astro") {
    const pagesMatch = filePath.match(/^src\/pages\/(.+)\.\w+$/);
    if (pagesMatch) {
      const seg = pagesMatch[1];
      if (seg === "index") return "/";
      return "/" + seg.replace(/\/index$/, "");
    }
  }

  if (framework === "static") {
    const htmlMatch = filePath.match(/^(.+)\.html$/);
    if (htmlMatch) {
      const seg = htmlMatch[1];
      if (seg === "index") return "/";
      return "/" + seg;
    }
  }

  if (framework === "laravel") {
    const bladeMatch = filePath.match(
      /^resources\/views\/(.+)\.blade\.php$/
    );
    if (bladeMatch) return "/" + bladeMatch[1].replace(/\//g, ".");
  }

  if (framework === "django") {
    const templateMatch = filePath.match(/^templates\/(.+)\.html$/);
    if (templateMatch) return "/" + templateMatch[1];
  }

  return undefined;
}

function toProjectEntry(
  filePath: string,
  type: ProjectEntry["type"],
  framework: FrameworkType
): ProjectEntry {
  return {
    path: filePath,
    name: basename(filePath, extname(filePath)),
    route: type === "page" ? filePathToRoute(filePath, framework) : undefined,
    type,
  };
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Detect the framework, build tool, CSS framework, and other metadata
 * for a project at the given root directory.
 */
export async function detectFramework(
  projectRoot: string
): Promise<DetectedFramework> {
  const pkg = readJsonSync(join(projectRoot, "package.json"));
  const deps: Record<string, string> = {
    ...((pkg?.dependencies as Record<string, string>) ?? {}),
    ...((pkg?.devDependencies as Record<string, string>) ?? {}),
  };

  let type: FrameworkType = "unknown";
  let buildTool: DetectedFramework["buildTool"] = "none";
  let version: string | undefined;

  // 1. Next.js — confidence-based detection (config file is optional)
  if (
    globMatch(projectRoot, "next.config") ||
    (deps["next"] && (
      fileExists(join(projectRoot, "app", "page.tsx")) ||
      fileExists(join(projectRoot, "app", "page.jsx")) ||
      fileExists(join(projectRoot, "app", "page.ts")) ||
      fileExists(join(projectRoot, "app", "page.js")) ||
      fileExists(join(projectRoot, "app", "layout.tsx")) ||
      fileExists(join(projectRoot, "app", "layout.jsx")) ||
      fileExists(join(projectRoot, "pages")) ||
      hasNextScript(pkg)
    ))
  ) {
    type = "nextjs";
    buildTool = deps["turbopack"] ? "custom" : "webpack";
    version = deps["next"];
  }
  // 2. Nuxt
  else if (globMatch(projectRoot, "nuxt.config")) {
    type = "nuxt";
    buildTool = "vite";
    version = deps["nuxt"];
  }
  // 3. SvelteKit
  else if (globMatch(projectRoot, "svelte.config")) {
    type = "sveltekit";
    buildTool = "vite";
    version = deps["@sveltejs/kit"] ?? deps["svelte"];
  }
  // 4. Angular
  else if (fileExists(join(projectRoot, "angular.json"))) {
    type = "angular";
    buildTool = "webpack";
    version = deps["@angular/core"];
  }
  // 5. Astro
  else if (globMatch(projectRoot, "astro.config")) {
    type = "astro";
    buildTool = "vite";
    version = deps["astro"];
  }
  // 6. Laravel
  else if (
    fileExists(join(projectRoot, "artisan")) &&
    fileExists(join(projectRoot, "composer.json"))
  ) {
    type = "laravel";
    buildTool = "none";
    const composer = readJsonSync(join(projectRoot, "composer.json"));
    const req = (composer?.require ?? {}) as Record<string, string>;
    version = req["laravel/framework"];
  }
  // 7. PHP
  else if (fileExists(join(projectRoot, "composer.json"))) {
    type = "php";
    buildTool = "none";
  }
  // 8. Django
  else if (fileExists(join(projectRoot, "manage.py"))) {
    const hasDjango =
      Object.keys(deps).includes("django") ||
      checkRequirementsTxt(projectRoot, "django");
    if (hasDjango) {
      type = "django";
      buildTool = "none";
    }
  }
  // 9. Package.json framework detection
  else if (pkg) {
    if (deps["react"]) {
      type = "react";
      version = deps["react"];
      buildTool = deps["vite"] ? "vite" : deps["esbuild"] ? "esbuild" : "webpack";
    } else if (deps["vue"]) {
      type = "vue";
      version = deps["vue"];
      buildTool = deps["vite"] ? "vite" : "webpack";
    } else if (deps["svelte"]) {
      type = "svelte";
      version = deps["svelte"];
      buildTool = "vite";
    }
  }
  // 10. Flask
  else if (checkRequirementsTxt(projectRoot, "flask")) {
    type = "flask";
    buildTool = "none";
  }
  // 11. Static HTML
  else if (hasHtmlFiles(projectRoot)) {
    type = "static";
    buildTool = "none";
  }

  return {
    type,
    version: version?.replace(/[\^~>=<]/g, "") || undefined,
    buildTool,
    cssFramework: detectCssFramework(projectRoot),
    entryPoints: collectEntryPoints(projectRoot, type),
    configFiles: collectConfigFiles(projectRoot),
    packageManager: detectPackageManager(projectRoot),
  };
}

/**
 * Parse all dependencies (dependencies + devDependencies) from the project's
 * manifest file (package.json, composer.json, or requirements.txt).
 */
export function parseDependencies(
  projectRoot: string
): Map<string, string> {
  const result = new Map<string, string>();

  // package.json
  const pkg = readJsonSync(join(projectRoot, "package.json"));
  if (pkg) {
    const deps = (pkg.dependencies ?? {}) as Record<string, string>;
    const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(deps)) result.set(k, v);
    for (const [k, v] of Object.entries(devDeps)) result.set(k, v);
  }

  // composer.json
  const composer = readJsonSync(join(projectRoot, "composer.json"));
  if (composer) {
    const req = (composer.require ?? {}) as Record<string, string>;
    const reqDev = (composer["require-dev"] ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(req)) result.set(k, v);
    for (const [k, v] of Object.entries(reqDev)) result.set(k, v);
  }

  // requirements.txt
  const reqTxtPath = join(projectRoot, "requirements.txt");
  if (existsSync(reqTxtPath)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const raw = require("fs").readFileSync(reqTxtPath, "utf-8") as string;
      const lines = raw.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqMatch = trimmed.match(/^([a-zA-Z0-9_-]+)==(.+)$/);
        if (eqMatch) {
          result.set(eqMatch[1], eqMatch[2]);
        } else {
          const nameMatch = trimmed.match(/^([a-zA-Z0-9_-]+)/);
          if (nameMatch) result.set(nameMatch[1], "*");
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return result;
}

/**
 * Scan the project directory and build a structured map of pages, components,
 * layouts, and styles based on the detected framework conventions.
 */
export async function buildProjectStructure(
  projectRoot: string,
  framework: FrameworkType
): Promise<ProjectStructure> {
  const structure: ProjectStructure = {
    pages: [],
    components: [],
    layouts: [],
    styles: [],
  };

  const jsExts = [".tsx", ".jsx", ".ts", ".js"];
  const styleExts = [".css", ".scss", ".sass", ".less"];

  try {
    switch (framework) {
      case "nextjs": {
        // App Router pages
        if (fileExists(join(projectRoot, "app"))) {
          const appFiles = await scanDirectory(
            join(projectRoot, "app"),
            projectRoot,
            [...jsExts]
          );
          for (const f of appFiles) {
            const name = basename(f, extname(f));
            if (name === "page") {
              structure.pages.push(toProjectEntry(f, "page", framework));
            } else if (name === "layout") {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            } else if (name === "route") {
              structure.pages.push(toProjectEntry(f, "api", framework));
            }
          }
        }

        // Pages Router
        if (fileExists(join(projectRoot, "pages"))) {
          const pageFiles = await scanDirectory(
            join(projectRoot, "pages"),
            projectRoot,
            jsExts
          );
          for (const f of pageFiles) {
            const name = basename(f, extname(f));
            if (name.startsWith("_")) continue;
            if (f.startsWith("pages/api/")) {
              structure.pages.push(toProjectEntry(f, "api", framework));
            } else {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }

        // Components
        for (const compDir of ["components", "src/components"]) {
          if (fileExists(join(projectRoot, compDir))) {
            const compFiles = await scanDirectory(
              join(projectRoot, compDir),
              projectRoot,
              jsExts
            );
            for (const f of compFiles) {
              structure.components.push(
                toProjectEntry(f, "component", framework)
              );
            }
          }
        }

        // Styles
        const styleFiles = await scanDirectory(
          projectRoot,
          projectRoot,
          styleExts,
          3
        );
        for (const f of styleFiles) {
          structure.styles.push(toProjectEntry(f, "style", framework));
        }
        break;
      }

      case "react": {
        // Pages
        for (const pageDir of ["src/pages", "src/views"]) {
          if (fileExists(join(projectRoot, pageDir))) {
            const files = await scanDirectory(
              join(projectRoot, pageDir),
              projectRoot,
              jsExts
            );
            for (const f of files) {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }

        // Components
        for (const compDir of ["src/components", "components"]) {
          if (fileExists(join(projectRoot, compDir))) {
            const files = await scanDirectory(
              join(projectRoot, compDir),
              projectRoot,
              jsExts
            );
            for (const f of files) {
              structure.components.push(
                toProjectEntry(f, "component", framework)
              );
            }
          }
        }

        // Styles
        if (fileExists(join(projectRoot, "src"))) {
          const files = await scanDirectory(
            join(projectRoot, "src"),
            projectRoot,
            styleExts,
            3
          );
          for (const f of files) {
            structure.styles.push(toProjectEntry(f, "style", framework));
          }
        }
        break;
      }

      case "vue":
      case "nuxt": {
        const vueExts = [".vue", ...jsExts];

        if (fileExists(join(projectRoot, "pages"))) {
          const files = await scanDirectory(
            join(projectRoot, "pages"),
            projectRoot,
            vueExts
          );
          for (const f of files) {
            structure.pages.push(toProjectEntry(f, "page", framework));
          }
        }

        if (fileExists(join(projectRoot, "components"))) {
          const files = await scanDirectory(
            join(projectRoot, "components"),
            projectRoot,
            vueExts
          );
          for (const f of files) {
            structure.components.push(
              toProjectEntry(f, "component", framework)
            );
          }
        }

        if (fileExists(join(projectRoot, "layouts"))) {
          const files = await scanDirectory(
            join(projectRoot, "layouts"),
            projectRoot,
            vueExts
          );
          for (const f of files) {
            structure.layouts.push(toProjectEntry(f, "layout", framework));
          }
        }
        break;
      }

      case "svelte":
      case "sveltekit": {
        const svelteExts = [".svelte", ...jsExts];

        if (fileExists(join(projectRoot, "src", "routes"))) {
          const files = await scanDirectory(
            join(projectRoot, "src", "routes"),
            projectRoot,
            svelteExts
          );
          for (const f of files) {
            const name = basename(f);
            if (name.startsWith("+page")) {
              structure.pages.push(toProjectEntry(f, "page", framework));
            } else if (name.startsWith("+layout")) {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            }
          }
        }

        for (const compDir of [
          "src/lib/components",
          "src/components",
          "src/lib",
        ]) {
          if (fileExists(join(projectRoot, compDir))) {
            const files = await scanDirectory(
              join(projectRoot, compDir),
              projectRoot,
              svelteExts
            );
            for (const f of files) {
              structure.components.push(
                toProjectEntry(f, "component", framework)
              );
            }
          }
        }
        break;
      }

      case "angular": {
        if (fileExists(join(projectRoot, "src", "app"))) {
          const files = await scanDirectory(
            join(projectRoot, "src", "app"),
            projectRoot,
            jsExts
          );
          for (const f of files) {
            if (f.includes(".component.")) {
              structure.components.push(
                toProjectEntry(f, "component", framework)
              );
            } else if (f.includes(".module.")) {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            }
          }
        }
        break;
      }

      case "astro": {
        const astroExts = [".astro", ...jsExts];

        if (fileExists(join(projectRoot, "src", "pages"))) {
          const files = await scanDirectory(
            join(projectRoot, "src", "pages"),
            projectRoot,
            astroExts
          );
          for (const f of files) {
            structure.pages.push(toProjectEntry(f, "page", framework));
          }
        }

        if (fileExists(join(projectRoot, "src", "components"))) {
          const files = await scanDirectory(
            join(projectRoot, "src", "components"),
            projectRoot,
            astroExts
          );
          for (const f of files) {
            structure.components.push(
              toProjectEntry(f, "component", framework)
            );
          }
        }

        if (fileExists(join(projectRoot, "src", "layouts"))) {
          const files = await scanDirectory(
            join(projectRoot, "src", "layouts"),
            projectRoot,
            astroExts
          );
          for (const f of files) {
            structure.layouts.push(toProjectEntry(f, "layout", framework));
          }
        }
        break;
      }

      case "laravel":
      case "php": {
        const phpExts = [".php", ".blade.php"];

        if (fileExists(join(projectRoot, "resources", "views"))) {
          const files = await scanDirectory(
            join(projectRoot, "resources", "views"),
            projectRoot,
            phpExts
          );
          for (const f of files) {
            if (f.includes("layout")) {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            } else {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }

        if (fileExists(join(projectRoot, "public"))) {
          const files = await scanDirectory(
            join(projectRoot, "public"),
            projectRoot,
            [".html", ".css", ".php"],
            2
          );
          for (const f of files) {
            if (f.endsWith(".css")) {
              structure.styles.push(toProjectEntry(f, "style", framework));
            } else {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }
        break;
      }

      case "django": {
        if (fileExists(join(projectRoot, "templates"))) {
          const files = await scanDirectory(
            join(projectRoot, "templates"),
            projectRoot,
            [".html"]
          );
          for (const f of files) {
            if (basename(f).startsWith("base") || f.includes("layout")) {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            } else {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }

        // Scan for static CSS
        if (fileExists(join(projectRoot, "static"))) {
          const files = await scanDirectory(
            join(projectRoot, "static"),
            projectRoot,
            styleExts,
            3
          );
          for (const f of files) {
            structure.styles.push(toProjectEntry(f, "style", framework));
          }
        }
        break;
      }

      case "flask": {
        if (fileExists(join(projectRoot, "templates"))) {
          const files = await scanDirectory(
            join(projectRoot, "templates"),
            projectRoot,
            [".html"]
          );
          for (const f of files) {
            if (basename(f).startsWith("base") || f.includes("layout")) {
              structure.layouts.push(toProjectEntry(f, "layout", framework));
            } else {
              structure.pages.push(toProjectEntry(f, "page", framework));
            }
          }
        }

        if (fileExists(join(projectRoot, "static"))) {
          const files = await scanDirectory(
            join(projectRoot, "static"),
            projectRoot,
            styleExts,
            3
          );
          for (const f of files) {
            structure.styles.push(toProjectEntry(f, "style", framework));
          }
        }
        break;
      }

      case "static": {
        const htmlFiles = await scanDirectory(projectRoot, projectRoot, [
          ".html",
        ], 2);
        for (const f of htmlFiles) {
          structure.pages.push(toProjectEntry(f, "page", framework));
        }

        const cssFiles = await scanDirectory(
          projectRoot,
          projectRoot,
          styleExts,
          2
        );
        for (const f of cssFiles) {
          structure.styles.push(toProjectEntry(f, "style", framework));
        }
        break;
      }

      default:
        // unknown - return empty structure
        break;
    }
  } catch {
    // return whatever we managed to collect
  }

  return structure;
}

/**
 * Check whether the given path is inside a Git repository
 * (handles both normal repos and worktrees where `.git` is a file).
 */
export function isGitRepository(projectRoot: string): boolean {
  try {
    const gitPath = join(projectRoot, ".git");
    if (!existsSync(gitPath)) return false;
    const stat = statSync(gitPath);
    // .git can be a directory (normal) or a file (worktree/submodule)
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Validate that the given path is a usable project directory.
 * Checks existence, readability, and presence of at least one project marker.
 */
export async function validateProjectPath(
  projectRoot: string
): Promise<ValidationResult> {
  try {
    // Check existence
    const stat = await fs.stat(projectRoot);
    if (!stat.isDirectory()) {
      return { valid: false, reason: "Path is not a directory" };
    }
  } catch {
    return { valid: false, reason: "Path does not exist or is not accessible" };
  }

  // Check readability
  try {
    await fs.access(projectRoot, fs.constants.R_OK);
  } catch {
    return { valid: false, reason: "Directory is not readable" };
  }

  // Check for project markers
  const markers = [
    "package.json",
    "composer.json",
    "requirements.txt",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
  ];

  const hasMarker = markers.some((m) => fileExists(join(projectRoot, m)));
  if (!hasMarker) {
    // Also check for HTML files
    if (!hasHtmlFiles(projectRoot)) {
      return {
        valid: false,
        reason:
          "No project markers found (package.json, composer.json, requirements.txt, or .html files)",
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function hasNextScript(pkg: Record<string, unknown> | null): boolean {
  if (!pkg?.scripts) return false;
  const scripts = pkg.scripts as Record<string, string>;
  return Object.values(scripts).some(
    (cmd) => typeof cmd === "string" && /\bnext\b/.test(cmd),
  );
}

function checkRequirementsTxt(root: string, packageName: string): boolean {
  const reqPath = join(root, "requirements.txt");
  if (!existsSync(reqPath)) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require("fs").readFileSync(reqPath, "utf-8") as string;
    return raw.toLowerCase().includes(packageName.toLowerCase());
  } catch {
    return false;
  }
}

function hasHtmlFiles(root: string): boolean {
  try {
    const entries = readdirSync(root);
    return entries.some((e) => e.endsWith(".html"));
  } catch {
    return false;
  }
}
