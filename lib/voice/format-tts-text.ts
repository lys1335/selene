const MULTI_CHAR_CODE_TOKENS: Array<[token: string, speech: string]> = [
  ["!==", "not triple equals"],
  ["===", "triple equals"],
  ["??=", "nullish coalescing equals"],
  ["&&=", "and and equals"],
  ["||=", "or or equals"],
  ["=>", "arrow"],
  ["==", "double equals"],
  ["!=", "not equals"],
  [">=", "greater than or equal to"],
  ["<=", "less than or equal to"],
  ["++", "plus plus"],
  ["--", "minus minus"],
  ["&&", "and and"],
  ["||", "or or"],
  ["??", "nullish coalescing"],
  ["?.", "optional chaining"],
  ["::", "double colon"],
  ["->", "arrow"],
  ["+=", "plus equals"],
  ["-=", "minus equals"],
  ["*=", "asterisk equals"],
  ["/=", "slash equals"],
  ["%=", "percent equals"],
  ["**", "double asterisk"],
  ["//", "double slash"],
  ["/*", "slash asterisk"],
  ["*/", "asterisk slash"],
  ["...", "ellipsis"],
];

const SINGLE_CHAR_CODE_TOKENS = new Map<string, string>([
  ["{", "open brace"],
  ["}", "close brace"],
  ["[", "open bracket"],
  ["]", "close bracket"],
  ["(", "open parenthesis"],
  [")", "close parenthesis"],
  ["<", "less than"],
  [">", "greater than"],
  ["=", "equals"],
  ["+", "plus"],
  ["-", "minus"],
  ["*", "asterisk"],
  ["/", "slash"],
  ["%", "percent"],
  ["!", "exclamation mark"],
  ["?", "question mark"],
  [".", "dot"],
  [",", "comma"],
  [":", "colon"],
  [";", "semicolon"],
  ["#", "hash"],
  ["@", "at sign"],
  ["&", "ampersand"],
  ["|", "pipe"],
  ["\\", "backslash"],
  ["_", "underscore"],
  ["~", "tilde"],
  ["^", "caret"],
  ["$", "dollar sign"],
  ["`", "backtick"],
  ["'", "single quote"],
  ["\"", "double quote"],
]);

function normalizeSpeechWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCodeWhitespace(code: string): string {
  return code
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatCodeForSpeech(code: string, speakSymbols = false): string {
  if (!speakSymbols) {
    return normalizeCodeWhitespace(code);
  }
  let index = 0;
  const parts: string[] = [];

  while (index < code.length) {
    const current = code[index];

    if (current === "\r") {
      index += 1;
      continue;
    }

    if (current === "\n") {
      parts.push("\n");
      index += 1;
      continue;
    }

    if (/\s/.test(current)) {
      parts.push(" ");
      index += 1;
      continue;
    }

    const multiCharToken = MULTI_CHAR_CODE_TOKENS.find(([token]) => code.startsWith(token, index));
    if (multiCharToken) {
      parts.push(` ${multiCharToken[1]} `);
      index += multiCharToken[0].length;
      continue;
    }

    const singleCharToken = SINGLE_CHAR_CODE_TOKENS.get(current);
    if (singleCharToken) {
      parts.push(` ${singleCharToken} `);
      index += 1;
      continue;
    }

    parts.push(current);
    index += 1;
  }

  return normalizeSpeechWhitespace(parts.join(""));
}

function formatCodeBlockForSpeech(code: string, speakCodeSymbols = false): string {
  const spokenCode = formatCodeForSpeech(code.trim(), speakCodeSymbols);
  return spokenCode.length > 0 ? `\nCode: ${spokenCode}\n` : "";
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatTextForTTS(
  text: string,
  readCodeBlocks = false,
  speakCodeSymbols = false,
): string {
  let result = text;

  if (readCodeBlocks) {
    // Replace code with sentinels, format code separately, then restore after
    // markdown scrubbing so code content isn't mutated by heading/list regexes.
    const codeSlots: string[] = [];
    const sentinel = (i: number) => `\x00CODE${i}\x00`;

    result = result.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, code: string) => {
      const i = codeSlots.length;
      codeSlots.push(formatCodeBlockForSpeech(code, speakCodeSymbols));
      return sentinel(i);
    });
    result = result.replace(/`([^`]+)`/g, (_match, code: string) => {
      const i = codeSlots.length;
      codeSlots.push(formatCodeForSpeech(code, speakCodeSymbols));
      return sentinel(i);
    });

    result = stripMarkdown(result);

    for (let i = 0; i < codeSlots.length; i++) {
      result = result.replace(sentinel(i), codeSlots[i]);
    }
    return result;
  }

  result = result.replace(/`{1,3}[^`]*`{1,3}/g, "");
  return stripMarkdown(result);
}
