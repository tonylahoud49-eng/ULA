/**
 * Resilient JSON Repair Utility
 *
 * Repairs truncated, malformed, or incomplete JSON returned when an AI model
 * reaches its max_completion_tokens / output cap, or encounters unexpected stream termination.
 * Automatically closes unclosed quotes, open arrays, and unclosed object braces.
 */

export function repairTruncatedJson(rawText = "") {
  let text = String(rawText || "").trim();
  if (!text) return "{}";

  // Remove markdown fences if present
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // If it already parses, return it directly
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Needs repair
  }

  // Find the start of the first JSON object or array
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let startIndex = 0;

  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
  } else if (firstBracket >= 0) {
    startIndex = firstBracket;
  }
  text = text.slice(startIndex);

  // Scan text tracking open string state, escape sequences, and container stack
  const stack = [];
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}") {
      if (stack.length && stack[stack.length - 1] === "{") {
        stack.pop();
      }
    } else if (char === "]") {
      if (stack.length && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  // If truncated inside a string, close the string quote
  let repaired = text;
  if (inString) {
    // If it ends with an uncompleted escape, remove the trailing backslash
    if (isEscaped) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  }

  // Remove trailing dangling commas or colons before closing braces
  repaired = repaired.replace(/,\s*$/g, "");
  repaired = repaired.replace(/:\s*$/g, ': null');

  // Re-check stack on current repaired string to close remaining unclosed containers
  const closeStack = [];
  let sInString = false;
  let sEscaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    if (sInString) {
      if (sEscaped) sEscaped = false;
      else if (char === "\\") sEscaped = true;
      else if (char === '"') sInString = false;
      continue;
    }
    if (char === '"') {
      sInString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      closeStack.push(char);
    } else if (char === "}" && closeStack[closeStack.length - 1] === "{") {
      closeStack.pop();
    } else if (char === "]" && closeStack[closeStack.length - 1] === "[") {
      closeStack.pop();
    }
  }

  // If still in string after repair, close it
  if (sInString) {
    repaired += '"';
  }

  // Clean trailing commas after closing string
  repaired = repaired.replace(/,\s*$/g, "");
  repaired = repaired.replace(/:\s*$/g, ': null');

  // Close open brackets and braces in reverse order
  while (closeStack.length > 0) {
    const openChar = closeStack.pop();
    // Clean any dangling comma right before closing
    repaired = repaired.replace(/,\s*$/g, "");
    if (openChar === "{") {
      repaired += "}";
    } else if (openChar === "[") {
      repaired += "]";
    }
  }

  return repaired;
}

/**
 * Safely parse JSON with automatic repair fallback.
 * Guaranteed not to throw for partial JSON payloads.
 */
export function safeParseJsonWithRepair(rawText, fallback = {}) {
  if (!rawText) return fallback;
  try {
    return JSON.parse(rawText);
  } catch {
    try {
      const repaired = repairTruncatedJson(rawText);
      return JSON.parse(repaired);
    } catch {
      return fallback;
    }
  }
}
