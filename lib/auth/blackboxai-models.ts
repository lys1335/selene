/**
 * BlackBox AI Model Definitions
 *
 * BlackBox AI provides access to 400+ models through a unified
 * OpenAI-compatible API at https://api.blackbox.ai, including:
 * - Native BlackBox models (search, coding, video)
 * - Routed models from Anthropic, OpenAI, Google, DeepSeek, Meta, xAI, Mistral, etc.
 *
 * Model IDs use the flat format from the BlackBox docs (e.g., "claude-sonnet-4.5").
 * No prefix is needed — IDs are sent directly to the API.
 *
 * Full catalogue: https://docs.blackbox.ai/api-reference/models/chat-models
 */

/**
 * Complete catalogue of all 400 models supported by BlackBox AI.
 * Sourced from https://docs.blackbox.ai/api-reference/models/chat-models
 * Used for model ID validation. Users can also enter custom IDs.
 */
export const BLACKBOX_ALL_MODEL_IDS = [
  // ── Anthropic ──────────────────────────────────────────────────────────
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-3-haiku",
  "claude-3.5-haiku",
  "claude-3.7-sonnet:thinking",
  "claude-3.7-sonnet",
  "claude-haiku-4.5",
  "claude-opus-4",
  "claude-opus-4.1",
  "claude-sonnet-4",

  // ── OpenAI ─────────────────────────────────────────────────────────────
  "gpt-5.2-codex",
  "chatgpt-4o-latest",
  "gpt-3.5-turbo",
  "gpt-3.5-turbo-0613",
  "gpt-3.5-turbo-16k",
  "gpt-3.5-turbo-instruct",
  "gpt-4",
  "gpt-4-1106-preview",
  "gpt-4-turbo",
  "gpt-4-turbo-preview",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o:extended",
  "gpt-4o",
  "gpt-4o-2024-05-13",
  "gpt-4o-2024-08-06",
  "gpt-4o-2024-11-20",
  "gpt-4o-audio-preview",
  "gpt-4o-mini",
  "gpt-4o-mini-2024-07-18",
  "gpt-4o-mini-search-preview",
  "gpt-4o-search-preview",
  "gpt-5",
  "gpt-5-chat",
  "gpt-5-codex",
  "gpt-5-image",
  "gpt-5-image-mini",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro",
  "gpt-5.1",
  "gpt-5.1-chat",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-chat",
  "gpt-5.2-pro",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-audio",
  "gpt-audio-mini",
  "gpt-oss-120b:exacto",
  "gpt-oss-120b",
  "gpt-oss-20b",
  "gpt-oss-safeguard-20b",
  "o1",
  "o1-pro",
  "o3",
  "o3-deep-research",
  "o3-mini",
  "o3-mini-high",
  "o3-pro",
  "o4-mini",
  "o4-mini-deep-research",
  "o4-mini-high",

  // ── Google ─────────────────────────────────────────────────────────────
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite-001",
  "gemini-2.5-flash",
  "gemini-2.5-flash-image",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash-lite-preview-09-2025",
  "gemini-2.5-flash-preview-09-2025",
  "gemini-2.5-pro",
  "gemini-2.5-pro-preview",
  "gemini-2.5-pro-preview-05-06",
  "gemini-3-flash-preview",
  "gemini-3-pro-image-preview",
  "gemma-2-27b-it",
  "gemma-2-9b-it",
  "gemma-3-12b-it",
  "gemma-3-12b-it:free",
  "gemma-3-4b-it",
  "gemma-3-4b-it:free",
  "gemma-3n-e2b-it:free",
  "gemma-3n-e4b-it",
  "gemma-3n-e4b-it:free",
  "imagen-3",
  "imagen-3-fast",
  "imagen-4",
  "imagen-4-fast",
  "imagen-4-ultra",
  "nano-banana",
  "nano-banana-pro",
  "veo-2",
  "veo-3",
  "veo-3-fast",

  // ── DeepSeek ───────────────────────────────────────────────────────────
  "deepseek-chat",
  "deepseek-chat-v3-0324",
  "deepseek-chat-v3.1",
  "deepseek-r1",
  "deepseek-r1-0528",
  "deepseek-r1-0528:free",
  "deepseek-r1-distill-qwen-32b",
  "deepseek-v3.1-terminus:exacto",
  "deepseek-v3.1-terminus",
  "deepseek-v3.2",
  "deepseek-v3.2-exp",
  "deepseek-v3.2-speciale",

  // ── Meta Llama ─────────────────────────────────────────────────────────
  "llama-3-70b-instruct",
  "llama-3-8b-instruct",
  "llama-3.1-405b",
  "llama-3.1-405b-instruct",
  "llama-3.1-405b-instruct:free",
  "llama-3.1-70b-instruct",
  "llama-3.1-8b-instruct",
  "llama-3.2-11b-vision-instruct",
  "llama-3.2-1b-instruct",
  "llama-3.2-3b-instruct",
  "llama-3.2-3b-instruct:free",
  "llama-3.3-70b-instruct",
  "llama-4-maverick",
  "llama-4-scout",
  "llama-guard-2-8b",
  "llama-guard-3-8b",
  "llama-guard-4-12b",

  // ── xAI ────────────────────────────────────────────────────────────────
  "grok-3",
  "grok-3-beta",
  "grok-3-mini",
  "grok-3-mini-beta",
  "grok-4",
  "grok-4-fast",
  "grok-4.1-fast",
  "grok-code-fast-1",

  // ── Mistral ────────────────────────────────────────────────────────────
  "codestral-2508",
  "devstral-2512",
  "devstral-medium",
  "devstral-small",
  "ministral-14b-2512",
  "ministral-3b",
  "ministral-3b-2512",
  "ministral-8b",
  "ministral-8b-2512",
  "mistral-7b-instruct",
  "mistral-7b-instruct-v0.1",
  "mistral-7b-instruct-v0.2",
  "mistral-7b-instruct-v0.3",
  "mistral-large",
  "mistral-large-2407",
  "mistral-large-2411",
  "mistral-large-2512",
  "mistral-medium-3",
  "mistral-medium-3.1",
  "mistral-nemo",
  "mistral-saba",
  "mistral-small-24b-instruct-2501",
  "mistral-small-3.1-24b-instruct:free",
  "mistral-small-3.2-24b-instruct",
  "mistral-small-creative",
  "mistral-tiny",
  "mixtral-8x22b-instruct",
  "mixtral-8x7b-instruct",
  "pixtral-12b",
  "pixtral-large-2411",
  "voxtral-small-24b-2507",

  // ── Qwen ───────────────────────────────────────────────────────────────
  "qwen-2.5-72b-instruct",
  "qwen-2.5-7b-instruct",
  "qwen-2.5-coder-32b-instruct",
  "qwen-2.5-vl-7b-instruct:free",
  "qwen-2.5-vl-7b-instruct",
  "qwen-image",
  "qwen-max",
  "qwen-plus",
  "qwen-plus-2025-07-28:thinking",
  "qwen-plus-2025-07-28",
  "qwen-turbo",
  "qwen-vl-max",
  "qwen-vl-plus",
  "qwen2.5-coder-7b-instruct",
  "qwen2.5-vl-32b-instruct",
  "qwen2.5-vl-72b-instruct",
  "qwen3-14b",
  "qwen3-235b-a22b",
  "qwen3-235b-a22b-2507",
  "qwen3-235b-a22b-thinking-2507",
  "qwen3-30b-a3b",
  "qwen3-30b-a3b-instruct-2507",
  "qwen3-30b-a3b-thinking-2507",
  "qwen3-32b",
  "qwen3-4b:free",
  "qwen3-8b",
  "qwen3-coder:free",
  "qwen3-coder:exacto",
  "qwen3-coder-30b-a3b-instruct",
  "qwen3-coder-flash",
  "qwen3-coder-plus",
  "qwen3-next-80b-a3b-instruct",
  "qwen3-next-80b-a3b-instruct:free",
  "qwen3-next-80b-a3b-thinking",
  "qwen3-vl-235b-a22b-instruct",
  "qwen3-vl-235b-a22b-thinking",
  "qwen3-vl-30b-a3b-instruct",
  "qwen3-vl-30b-a3b-thinking",
  "qwen3-vl-32b-instruct",
  "qwen3-vl-8b-instruct",
  "qwen3-vl-8b-thinking",
  "qwq-32b",

  // ── Cohere ─────────────────────────────────────────────────────────────
  "command-a",
  "command-r-08-2024",
  "command-r-plus-08-2024",
  "command-r7b-12-2024",

  // ── MiniMax ────────────────────────────────────────────────────────────
  "image-01",
  "minimax-01",
  "minimax-free",
  "minimax-m1",
  "minimax-m2",
  "minimax-m2-her",
  "minimax-m2.1",

  // ── NVIDIA ─────────────────────────────────────────────────────────────
  "llama-3.1-nemotron-70b-instruct",
  "llama-3.1-nemotron-ultra-253b-v1",
  "llama-3.3-nemotron-super-49b-v1.5",
  "nemotron-3-nano-30b-a3b",
  "nemotron-3-nano-30b-a3b:free",
  "nemotron-nano-12b-v2-vl",
  "nemotron-nano-12b-v2-vl:free",
  "nemotron-nano-9b-v2",
  "nemotron-nano-9b-v2:free",
  "sana",
  "sana-sprint-1.6b",

  // ── Microsoft ──────────────────────────────────────────────────────────
  "phi-4",
  "wizardlm-2-8x22b",

  // ── Perplexity ─────────────────────────────────────────────────────────
  "sonar",
  "sonar-deep-research",
  "sonar-pro",
  "sonar-pro-search",
  "sonar-reasoning-pro",

  // ── Inception ──────────────────────────────────────────────────────────
  "mercury",
  "mercury-coder",

  // ── BlackBox Native ────────────────────────────────────────────────────
  "blackbox-search",
  "cogvideox-5b",
  "fast-animatediff",
  "fast-svd",
  "fast-svd-lcm",
  "gemini-flash-edit",
  "hunyuan-video-lora",
  "mochi-v1",
  "qwen3-coder",
  "qwen3-max",
  "qwen3-vl-235b-a22b",
  "qwen3-vl-32b",
  "ray-2",
  "sora-2-image-to-video",
  "sora-2-image-to-video-pro",
  "sora-2-text-to-video",
  "sora-2-text-to-video-pro",
  "sora-2-video-remix",
  "veo-3.1",
  "veo-3.1-fast",

  // ── AI21 ───────────────────────────────────────────────────────────────
  "jamba-large-1.7",
  "jamba-mini-1.7",

  // ── Aion Labs ──────────────────────────────────────────────────────────
  "aion-1.0",
  "aion-1.0-mini",
  "aion-rp-llama-3.1-8b",

  // ── Alibaba ────────────────────────────────────────────────────────────
  "tongyi-deepresearch-30b-a3b",

  // ── AllenAI ────────────────────────────────────────────────────────────
  "molmo-2-8b:free",
  "olmo-2-0325-32b-instruct",
  "olmo-3-32b-think",
  "olmo-3-7b-instruct",
  "olmo-3-7b-think",
  "olmo-3.1-32b-instruct",
  "olmo-3.1-32b-think",

  // ── Alpindale ──────────────────────────────────────────────────────────
  "goliath-120b",

  // ── Amazon ─────────────────────────────────────────────────────────────
  "nova-2-lite-v1",
  "nova-lite-v1",
  "nova-micro-v1",
  "nova-premier-v1",
  "nova-pro-v1",

  // ── Anthracite ─────────────────────────────────────────────────────────
  "magnum-v4-72b",

  // ── Arcee AI ───────────────────────────────────────────────────────────
  "coder-large",
  "maestro-reasoning",
  "spotlight",
  "trinity-large-preview:free",
  "trinity-mini",
  "trinity-mini:free",
  "virtuoso-large",

  // ── Baidu ──────────────────────────────────────────────────────────────
  "ernie-4.5-21b-a3b",
  "ernie-4.5-21b-a3b-thinking",
  "ernie-4.5-300b-a47b",
  "ernie-4.5-vl-28b-a3b",
  "ernie-4.5-vl-424b-a47b",

  // ── Black Forest Labs ──────────────────────────────────────────────────
  "flux-1.1-pro",
  "flux-1.1-pro-ultra",
  "flux-dev",
  "flux-kontext-max",
  "flux-kontext-pro",
  "flux-schnell",

  // ── Bria ───────────────────────────────────────────────────────────────
  "fibo",
  "image-3.2",

  // ── Bytedance ──────────────────────────────────────────────────────────
  "seed-1.6",
  "seed-1.6-flash",
  "seedream-3",
  "seedream-4",
  "ui-tars-1.5-7b",

  // ── Cognitivecomputations ──────────────────────────────────────────────
  "dolphin-mistral-24b-venice-edition:free",

  // ── DeepCogito ─────────────────────────────────────────────────────────
  "cogito-v2-preview-llama-109b-moe",
  "cogito-v2-preview-llama-405b",
  "cogito-v2-preview-llama-70b",
  "cogito-v2.1-671b",

  // ── EleutherAI ─────────────────────────────────────────────────────────
  "llemma_7b",

  // ── EssentialAI ────────────────────────────────────────────────────────
  "rnj-1-instruct",

  // ── Gemini Image Tools ─────────────────────────────────────────────────
  "edit",
  "multi",
  "edit-image",

  // ── Gryphe ─────────────────────────────────────────────────────────────
  "mythomax-l2-13b",

  // ── IBM Granite ────────────────────────────────────────────────────────
  "granite-4.0-h-micro",

  // ── Ideogram ───────────────────────────────────────────────────────────
  "ideogram-v2",
  "ideogram-v2-turbo",
  "ideogram-v2a",
  "ideogram-v2a-turbo",
  "ideogram-v3",

  // ── Inflection ─────────────────────────────────────────────────────────
  "inflection-3-pi",
  "inflection-3-productivity",

  // ── Kwaipilot ──────────────────────────────────────────────────────────
  "kat-coder-pro",

  // ── Liquid ─────────────────────────────────────────────────────────────
  "lfm-2.2-6b",
  "lfm-2.5-1.2b-instruct:free",
  "lfm-2.5-1.2b-thinking:free",
  "lfm2-8b-a1b",

  // ── Lucataco ───────────────────────────────────────────────────────────
  "dreamshaper",

  // ── Luma ───────────────────────────────────────────────────────────────
  "photon",
  "photon-flash",

  // ── Mancer ─────────────────────────────────────────────────────────────
  "weaver",

  // ── Meituan ────────────────────────────────────────────────────────────
  "longcat-flash-chat",

  // ── Moonshot AI ────────────────────────────────────────────────────────
  "kimi-dev-72b",
  "kimi-k2:free",
  "kimi-k2",
  "kimi-k2-0905",
  "kimi-k2-0905:exacto",
  "kimi-k2-thinking",
  "kimi-k2.5",

  // ── Morph ──────────────────────────────────────────────────────────────
  "morph-v3-fast",
  "morph-v3-large",

  // ── Neversleep ─────────────────────────────────────────────────────────
  "llama-3.1-lumimaid-8b",
  "noromaid-20b",

  // ── Nex-AGI ────────────────────────────────────────────────────────────
  "deepseek-v3.1-nex-n1",

  // ── Nousresearch ───────────────────────────────────────────────────────
  "hermes-2-pro-llama-3-8b",
  "hermes-3-llama-3.1-405b:free",
  "hermes-3-llama-3.1-405b",
  "hermes-3-llama-3.1-70b",
  "hermes-4-405b",

  // ── OpenGVLab ──────────────────────────────────────────────────────────
  "internvl3-78b",

  // ── Playground AI ──────────────────────────────────────────────────────
  "playground-v25",

  // ── Prime Intellect ────────────────────────────────────────────────────
  "intellect-3",

  // ── PrunaAI ────────────────────────────────────────────────────────────
  "hidream-l1-dev",
  "hidream-l1-fast",
  "hidream-l1-full",
  "wan-2.2-image",

  // ── Raifle ─────────────────────────────────────────────────────────────
  "sorcererlm-8x22b",

  // ── Recraft AI ─────────────────────────────────────────────────────────
  "recraft-v3",
  "recraft-v3-svg",

  // ── Relace ─────────────────────────────────────────────────────────────
  "relace-apply-3",
  "relace-search",

  // ── Sao10k ─────────────────────────────────────────────────────────────
  "l3-euryale-70b",
  "l3-lunaris-8b",
  "l3.1-70b-hanami-x1",
  "l3.1-euryale-70b",
  "l3.3-euryale-70b",

  // ── Stability AI ───────────────────────────────────────────────────────
  "stable-diffusion",
  "stable-diffusion-3.5-large",
  "stable-diffusion-3.5-medium",

  // ── Stepfun AI ─────────────────────────────────────────────────────────
  "step3",

  // ── Tencent ────────────────────────────────────────────────────────────
  "hunyuan-a13b-instruct",
  "hunyuan-image-3",

  // ── TheDrummer ─────────────────────────────────────────────────────────
  "cydonia-24b-v4.1",
  "rocinante-12b",
  "skyfall-36b-v2",
  "unslopnemo-12b",

  // ── TNGTech ────────────────────────────────────────────────────────────
  "deepseek-r1t-chimera",
  "deepseek-r1t-chimera:free",
  "deepseek-r1t2-chimera:free",
  "tng-r1t-chimera:free",

  // ── Undi95 ─────────────────────────────────────────────────────────────
  "remm-slerp-l2-13b",

  // ── Upstage ────────────────────────────────────────────────────────────
  "solar-pro-3:free",

  // ── Writer ─────────────────────────────────────────────────────────────
  "palmyra-x5",

  // ── Xiaomi ─────────────────────────────────────────────────────────────
  "mimo-v2-flash",

  // ── Z-AI (Zhipu/GLM) ──────────────────────────────────────────────────
  "glm-4-32b",
  "glm-4.5",
  "glm-4.5-air:free",
  "glm-4.5-air",
  "glm-4.5v",
  "glm-4.6:exacto",
  "glm-4.6",
  "glm-4.6v",
  "glm-4.7",
  "glm-4.7-flash",

  // ── Alfredpros ─────────────────────────────────────────────────────────
  "codellama-7b-instruct-solidity",

] as const;

export type BlackBoxModelId = (typeof BLACKBOX_ALL_MODEL_IDS)[number] | (string & {});

/**
 * Curated models shown in the UI model picker.
 * Focused on text-based LLMs (no image/video generators).
 * Users can enter any model ID from the full catalogue via custom input.
 */
export const BLACKBOX_MODEL_IDS = [
  // Anthropic
  "claude-sonnet-4.6",
  "claude-sonnet-4.5",
  "claude-opus-4.6",
  "claude-opus-4.5",
  "claude-opus-4.1",
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-4.5",
  "claude-3.7-sonnet",
  "claude-3.7-sonnet:thinking",
  "claude-3.5-haiku",
  "claude-3-haiku",

  // OpenAI
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.1-codex",
  "gpt-5.1",
  "gpt-5-pro",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "chatgpt-4o-latest",
  "o4-mini",
  "o4-mini-high",
  "o3",
  "o3-pro",
  "o3-mini",
  "o3-mini-high",
  "o1",
  "o1-pro",
  "gpt-5.4",
  "gpt-5.4-pro",

  // Google
  "gemini-3-pro-preview",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-001",

  // DeepSeek
  "deepseek-r1",
  "deepseek-r1-0528",
  "deepseek-r1-0528:free",
  "deepseek-chat",
  "deepseek-chat-v3-0324",
  "deepseek-chat-v3.1",
  "deepseek-v3.2",
  "deepseek-v3.2-exp",
  "deepseek-v3.2-speciale",
  "deepseek-v3.1-terminus",
  "deepseek-r1-distill-qwen-32b",

  // Meta Llama
  "llama-4-maverick",
  "llama-4-scout",
  "llama-3.3-70b-instruct",
  "llama-3.1-405b-instruct",
  "llama-3.1-405b-instruct:free",

  // xAI
  "grok-4",
  "grok-4-fast",
  "grok-4.1-fast",
  "grok-3",
  "grok-3-mini",
  "grok-code-fast-1",

  // Mistral
  "mistral-large",
  "mistral-large-2512",
  "mistral-medium-3",
  "mistral-medium-3.1",
  "mistral-small-3.2-24b-instruct",
  "mistral-small-3.1-24b-instruct:free",
  "mistral-small-creative",
  "codestral-2508",
  "devstral-small",
  "devstral-medium",
  "devstral-2512",
  "pixtral-large-2411",

  // Qwen
  "qwen3-235b-a22b",
  "qwen3-235b-a22b-2507",
  "qwen3-32b",
  "qwen3-coder-plus",
  "qwen3-coder-flash",
  "qwen3-coder:free",
  "qwen3-next-80b-a3b-instruct",
  "qwen3-next-80b-a3b-instruct:free",
  "qwen3-next-80b-a3b-thinking",
  "qwen3-14b",
  "qwen3-8b",
  "qwen3-4b:free",
  "qwq-32b",
  "qwen-max",
  "qwen-2.5-coder-32b-instruct",
  "qwen2.5-vl-32b-instruct",
  "qwen2.5-vl-72b-instruct",

  // Cohere
  "command-a",
  "command-r-plus-08-2024",

  // MiniMax
  "minimax-m1",
  "minimax-m2",
  "minimax-m2.1",

  // NVIDIA
  "llama-3.1-nemotron-ultra-253b-v1",
  "llama-3.3-nemotron-super-49b-v1.5",

  // Microsoft
  "phi-4",

  // Perplexity
  "sonar",
  "sonar-pro",
  "sonar-deep-research",
  "sonar-reasoning-pro",

  // Inception
  "mercury-coder",

  // DeepCogito
  "cogito-v2.1-671b",
  "cogito-v2-preview-llama-405b",

  // Moonshot AI
  "kimi-k2",
  "kimi-k2.5",
  "kimi-k2-thinking",

  // BlackBox Native
  "blackbox-search",
  "qwen3-coder",
  "qwen3-max",

  // Z-AI (Zhipu/GLM)
  "glm-4.7",
  "glm-4.6",
  "glm-4.5",

  // Hermes
  "hermes-4-405b",
  "hermes-3-llama-3.1-405b",

] as const;

// Default models for different roles
export const BLACKBOX_DEFAULT_MODELS = {
  chat: "claude-sonnet-4.5" as BlackBoxModelId,
  utility: "gpt-4o-mini" as BlackBoxModelId,
  research: "claude-opus-4.5" as BlackBoxModelId,
  vision: "gpt-4o" as BlackBoxModelId,
  coding: "gpt-5.2-codex" as BlackBoxModelId,
  reasoning: "deepseek-r1" as BlackBoxModelId,
};

// BlackBox AI API configuration
export const BLACKBOX_CONFIG = {
  BASE_URL: "https://api.blackbox.ai",
} as const;

// Model display names (curated models only; others use the raw model ID)
const MODEL_LABELS: Record<string, string> = {
  // Anthropic
  "claude-sonnet-4.6": "Anthropic: Claude Sonnet 4.6",
  "claude-sonnet-4.5": "Anthropic: Claude Sonnet 4.5",
  "claude-opus-4.6": "Anthropic: Claude Opus 4.6",
  "claude-opus-4.5": "Anthropic: Claude Opus 4.5",
  "claude-opus-4.1": "Anthropic: Claude Opus 4.1",
  "claude-opus-4": "Anthropic: Claude Opus 4",
  "claude-sonnet-4": "Anthropic: Claude Sonnet 4",
  "claude-haiku-4.5": "Anthropic: Claude Haiku 4.5",
  "claude-3.7-sonnet": "Anthropic: Claude 3.7 Sonnet",
  "claude-3.7-sonnet:thinking": "Anthropic: Claude 3.7 Sonnet (thinking)",
  "claude-3.5-haiku": "Anthropic: Claude 3.5 Haiku",
  "claude-3-haiku": "Anthropic: Claude 3 Haiku",

  // OpenAI
  "gpt-5.2-codex": "OpenAI: GPT-5.2 Codex",
  "gpt-5.2": "OpenAI: GPT-5.2",
  "gpt-5.2-pro": "OpenAI: GPT-5.2 Pro",
  "gpt-5.1-codex": "OpenAI: GPT-5.1 Codex",
  "gpt-5.1": "OpenAI: GPT-5.1",
  "gpt-5-pro": "OpenAI: GPT-5 Pro",
  "gpt-5": "OpenAI: GPT-5",
  "gpt-5-codex": "OpenAI: GPT-5 Codex",
  "gpt-5-mini": "OpenAI: GPT-5 Mini",
  "gpt-5-nano": "OpenAI: GPT-5 Nano",
  "gpt-4.1": "OpenAI: GPT-4.1",
  "gpt-4.1-mini": "OpenAI: GPT-4.1 Mini",
  "gpt-4.1-nano": "OpenAI: GPT-4.1 Nano",
  "gpt-4o": "OpenAI: GPT-4o",
  "gpt-4o-mini": "OpenAI: GPT-4o Mini",
  "chatgpt-4o-latest": "OpenAI: ChatGPT-4o",
  "o4-mini": "OpenAI: o4 Mini",
  "o4-mini-high": "OpenAI: o4 Mini High",
  "o3": "OpenAI: o3",
  "o3-pro": "OpenAI: o3 Pro",
  "o3-mini": "OpenAI: o3 Mini",
  "o3-mini-high": "OpenAI: o3 Mini High",
  "o1": "OpenAI: o1",
  "o1-pro": "OpenAI: o1 Pro",
  "gpt-5.4": "OpenAI: GPT-5.4",
  "gpt-5.4-pro": "OpenAI: GPT-5.4 Pro",

  // Google
  "gemini-3-pro-preview": "Google: Gemini 3 Pro Preview",
  "gemini-3.1-pro-preview": "Google: Gemini 3.1 Pro Preview",
  "gemini-3-flash-preview": "Google: Gemini 3 Flash Preview",
  "gemini-2.5-pro": "Google: Gemini 2.5 Pro",
  "gemini-2.5-pro-preview": "Google: Gemini 2.5 Pro Preview",
  "gemini-2.5-flash": "Google: Gemini 2.5 Flash",
  "gemini-2.5-flash-lite": "Google: Gemini 2.5 Flash Lite",
  "gemini-2.0-flash-001": "Google: Gemini 2.0 Flash",

  // DeepSeek
  "deepseek-r1": "DeepSeek: R1",
  "deepseek-r1-0528": "DeepSeek: R1 0528",
  "deepseek-r1-0528:free": "DeepSeek: R1 0528 (free)",
  "deepseek-chat": "DeepSeek: V3",
  "deepseek-chat-v3-0324": "DeepSeek: V3 0324",
  "deepseek-chat-v3.1": "DeepSeek: V3.1",
  "deepseek-v3.2": "DeepSeek: V3.2",
  "deepseek-v3.2-exp": "DeepSeek: V3.2 Exp",
  "deepseek-v3.2-speciale": "DeepSeek: V3.2 Speciale",
  "deepseek-v3.1-terminus": "DeepSeek: V3.1 Terminus",
  "deepseek-r1-distill-qwen-32b": "DeepSeek: R1 Distill Qwen 32B",

  // Meta
  "llama-4-maverick": "Meta: Llama 4 Maverick",
  "llama-4-scout": "Meta: Llama 4 Scout",
  "llama-3.3-70b-instruct": "Meta: Llama 3.3 70B Instruct",
  "llama-3.1-405b-instruct": "Meta: Llama 3.1 405B Instruct",
  "llama-3.1-405b-instruct:free": "Meta: Llama 3.1 405B Instruct (free)",

  // xAI
  "grok-4": "xAI: Grok 4",
  "grok-4-fast": "xAI: Grok 4 Fast",
  "grok-4.1-fast": "xAI: Grok 4.1 Fast",
  "grok-3": "xAI: Grok 3",
  "grok-3-mini": "xAI: Grok 3 Mini",
  "grok-code-fast-1": "xAI: Grok Code Fast 1",

  // Mistral
  "mistral-large": "Mistral: Mistral Large",
  "mistral-large-2512": "Mistral: Mistral Large 2512",
  "mistral-medium-3": "Mistral: Mistral Medium 3",
  "mistral-medium-3.1": "Mistral: Mistral Medium 3.1",
  "mistral-small-3.2-24b-instruct": "Mistral: Mistral Small 3.2 24B",
  "mistral-small-3.1-24b-instruct:free": "Mistral: Mistral Small 3.1 24B (free)",
  "mistral-small-creative": "Mistral: Mistral Small Creative",
  "codestral-2508": "Mistral: Codestral 2508",
  "devstral-small": "Mistral: Devstral Small",
  "devstral-medium": "Mistral: Devstral Medium",
  "devstral-2512": "Mistral: Devstral 2512",
  "pixtral-large-2411": "Mistral: Pixtral Large 2411",

  // Qwen
  "qwen3-235b-a22b": "Qwen: Qwen3 235B A22B",
  "qwen3-235b-a22b-2507": "Qwen: Qwen3 235B A22B 2507",
  "qwen3-32b": "Qwen: Qwen3 32B",
  "qwen3-coder-plus": "Qwen: Qwen3 Coder Plus",
  "qwen3-coder-flash": "Qwen: Qwen3 Coder Flash",
  "qwen3-coder:free": "Qwen: Qwen3 Coder (free)",
  "qwen3-next-80b-a3b-instruct": "Qwen: Qwen3 Next 80B A3B Instruct",
  "qwen3-next-80b-a3b-instruct:free": "Qwen: Qwen3 Next 80B A3B Instruct (free)",
  "qwen3-next-80b-a3b-thinking": "Qwen: Qwen3 Next 80B A3B Thinking",
  "qwen3-14b": "Qwen: Qwen3 14B",
  "qwen3-8b": "Qwen: Qwen3 8B",
  "qwen3-4b:free": "Qwen: Qwen3 4B (free)",
  "qwq-32b": "Qwen: QwQ 32B",
  "qwen-max": "Qwen: Qwen-Max",
  "qwen-2.5-coder-32b-instruct": "Qwen: Qwen2.5 Coder 32B Instruct",
  "qwen2.5-vl-32b-instruct": "Qwen: Qwen2.5 VL 32B Instruct",
  "qwen2.5-vl-72b-instruct": "Qwen: Qwen2.5 VL 72B Instruct",

  // Cohere
  "command-a": "Cohere: Command A",
  "command-r-plus-08-2024": "Cohere: Command R+ (08-2024)",

  // MiniMax
  "minimax-m1": "MiniMax: MiniMax M1",
  "minimax-m2": "MiniMax: MiniMax M2",
  "minimax-m2.1": "MiniMax: MiniMax M2.1",

  // NVIDIA
  "llama-3.1-nemotron-ultra-253b-v1": "NVIDIA: Llama 3.1 Nemotron Ultra 253B v1",
  "llama-3.3-nemotron-super-49b-v1.5": "NVIDIA: Llama 3.3 Nemotron Super 49B v1.5",

  // Microsoft
  "phi-4": "Microsoft: Phi 4",

  // Perplexity
  "sonar": "Perplexity: Sonar",
  "sonar-pro": "Perplexity: Sonar Pro",
  "sonar-deep-research": "Perplexity: Sonar Deep Research",
  "sonar-reasoning-pro": "Perplexity: Sonar Reasoning Pro",

  // Inception
  "mercury-coder": "Inception: Mercury Coder",

  // DeepCogito
  "cogito-v2.1-671b": "DeepCogito: Cogito V2.1 671B",
  "cogito-v2-preview-llama-405b": "DeepCogito: Cogito V2 Preview Llama 405B",

  // Moonshot AI
  "kimi-k2": "Moonshot: Kimi K2",
  "kimi-k2.5": "Moonshot: Kimi K2.5",
  "kimi-k2-thinking": "Moonshot: Kimi K2 Thinking",

  // BlackBox Native
  "blackbox-search": "BLACKBOX: Search",
  "qwen3-coder": "BLACKBOX: Qwen3 Coder",
  "qwen3-max": "BLACKBOX: Qwen3 Max",

  // Z-AI
  "glm-4.7": "Z-AI: GLM 4.7",
  "glm-4.6": "Z-AI: GLM 4.6",
  "glm-4.5": "Z-AI: GLM 4.5",

  // Hermes
  "hermes-4-405b": "Nous: Hermes 4 405B",
  "hermes-3-llama-3.1-405b": "Nous: Hermes 3 405B Instruct",
};

// Context window sizes (tokens) — known values for frequently used models
export const BLACKBOX_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  "claude-sonnet-4.6": 200000,
  "claude-sonnet-4.5": 200000,
  "claude-opus-4.6": 200000,
  "claude-opus-4.5": 200000,
  "claude-opus-4.1": 200000,
  "claude-opus-4": 200000,
  "claude-sonnet-4": 200000,
  "claude-haiku-4.5": 200000,
  "claude-3.7-sonnet": 200000,
  "claude-3.7-sonnet:thinking": 200000,
  "claude-3.5-haiku": 200000,
  "claude-3-haiku": 200000,

  // OpenAI
  "gpt-5.2-codex": 400000,
  "gpt-5.2": 400000,
  "gpt-5.1": 400000,
  "gpt-5.1-codex": 400000,
  "gpt-5.4": 400000,
  "gpt-5.4-pro": 400000,
  "gpt-4.1": 1047576,
  "gpt-4.1-mini": 1047576,
  "gpt-4.1-nano": 1047576,
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "chatgpt-4o-latest": 128000,
  "o4-mini": 200000,
  "o4-mini-high": 200000,
  "o3": 200000,
  "o3-pro": 200000,
  "o3-mini": 200000,
  "o3-mini-high": 200000,
  "o1": 200000,
  "o1-pro": 200000,

  // Google
  "gemini-3-pro-preview": 1048576,
  "gemini-3.1-pro-preview": 1048576,
  "gemini-3-flash-preview": 1048576,
  "gemini-2.5-pro": 1048576,
  "gemini-2.5-pro-preview": 1048576,
  "gemini-2.5-flash": 1048576,
  "gemini-2.5-flash-lite": 1048576,
  "gemini-2.0-flash-001": 1048576,

  // DeepSeek
  "deepseek-r1": 128000,
  "deepseek-r1-0528": 128000,
  "deepseek-r1-0528:free": 163840,
  "deepseek-chat": 163840,
  "deepseek-chat-v3-0324": 163840,
  "deepseek-chat-v3.1": 163840,
  "deepseek-v3.2": 163840,
  "deepseek-v3.1-terminus": 163840,
  "deepseek-r1-distill-qwen-32b": 131072,

  // Meta Llama
  "llama-4-maverick": 1048576,
  "llama-4-scout": 1048576,
  "llama-3.3-70b-instruct": 131072,
  "llama-3.1-405b-instruct": 32768,
  "llama-3.1-405b-instruct:free": 32768,

  // xAI
  "grok-3": 131072,
  "grok-3-mini": 131072,
  "grok-code-fast-1": 256000,

  // Mistral
  "mistral-large": 128000,
  "mistral-medium-3": 131072,
  "codestral-2508": 262144,
  "devstral-small": 128000,
  "pixtral-large-2411": 131072,

  // Qwen
  "qwen3-235b-a22b": 40960,
  "qwen3-32b": 40960,
  "qwen3-14b": 40960,
  "qwen3-8b": 128000,
  "qwq-32b": 131072,
  "qwen-max": 32768,
  "qwen-2.5-coder-32b-instruct": 32768,

  // Cohere
  "command-a": 256000,

  // MiniMax
  "minimax-m1": 1000000,
  "minimax-m2": 204800,
  "minimax-m2.1": 204800,

  // NVIDIA
  "llama-3.1-nemotron-ultra-253b-v1": 131072,

  // Perplexity
  "sonar": 127072,
  "sonar-pro": 200000,
  "sonar-deep-research": 128000,

  // BlackBox Native
  "blackbox-search": 1048576,
};

// Free models — auto-detected from IDs ending in ":free" plus known free-tier models
export const BLACKBOX_FREE_MODEL_IDS = new Set(
  BLACKBOX_ALL_MODEL_IDS.filter((id) => id.endsWith(":free"))
);

/**
 * Get display name for a BlackBox AI model
 */
export function getBlackBoxModelDisplayName(modelId: string): string {
  return MODEL_LABELS[modelId] || modelId;
}

/**
 * Get curated BlackBox AI models with display names for UI
 */
export function getBlackBoxModels(): Array<{ id: BlackBoxModelId; name: string }> {
  return [...new Set(BLACKBOX_MODEL_IDS)].map((id) => ({
    id,
    name: getBlackBoxModelDisplayName(id),
  }));
}

/**
 * Check if a model ID is a known BlackBox AI model
 */
const ALL_MODEL_SET = new Set<string>(BLACKBOX_ALL_MODEL_IDS);
export function isBlackBoxModel(modelId: string): boolean {
  return ALL_MODEL_SET.has(modelId) || ALL_MODEL_SET.has(modelId.toLowerCase());
}

/**
 * Get context window size for a BlackBox AI model
 */
export function getBlackBoxContextWindow(modelId: string): number {
  return BLACKBOX_CONTEXT_WINDOWS[modelId] ?? 128000;
}
