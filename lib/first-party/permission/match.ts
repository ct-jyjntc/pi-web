/**
 * Pattern matchers for native permission rules (bash commands + file paths).
 */

export function matchBashPattern(pattern: string, command: string): boolean {
  return globToRegExp(pattern, false).test(command.trim());
}

/**
 * Split a shell line on unquoted `&&`, `||`, `;`, `|`, and newlines so deny
 * rules like `rm -rf *` still apply to `echo hi && rm -rf /`.
 */
export function splitBashCommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      current += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    if ((ch === "&" || ch === "|") && command[i + 1] === ch) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (ch === "|") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [command.trim()];
}

export function matchPathPattern(pattern: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const re = globToRegExp(pattern, true);
  return re.test(normalized) || re.test(basename(normalized));
}

function globToRegExp(pattern: string, pathMode: boolean): RegExp {
  if (!pattern || pattern === "*") return /^[\s\S]*$/;
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*" && pathMode && pattern[i + 1] === "*") {
      out += ".*";
      i += 1;
      if (pattern[i + 1] === "/") i += 1;
      continue;
    }
    if (ch === "*") {
      out += pathMode ? "[^/]*" : ".*";
      continue;
    }
    if (ch === "?") {
      out += pathMode ? "[^/]" : ".";
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`);
}

function basename(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] ?? filePath;
}
