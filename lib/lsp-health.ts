/**
 * LSP catalog + PATH discovery + install hints for Settings and agent tools.
 */
import { existsSync, statSync } from "fs";
import { delimiter, join, resolve } from "path";

export type LspCatalogEntry = {
  id: string;
  /** Primary binary name on PATH */
  command: string;
  /** Alternate binaries to try (first found wins) */
  altCommands?: string[];
  args: string[];
  /** File extensions without dot */
  languages: string[];
  label: string;
  /** Short install instructions (platform-agnostic preferred) */
  install: string;
  /** Homebrew / package one-liner when available */
  brew?: string;
  npmGlobal?: string;
};

export type LspServerStatus = {
  id: string;
  label: string;
  command: string;
  args: string[];
  languages: string[];
  available: boolean;
  /** Absolute path when resolved */
  resolvedPath: string | null;
  /** Primary install command for the *current* OS */
  install: string;
  /** Optional secondary tip (e.g. Homebrew on macOS only) */
  installTip?: string;
  /** @deprecated Prefer install / installTip — kept for older callers */
  brew?: string;
  npmGlobal?: string;
  /** Runtime platform used to pick install hints */
  platform: NodeJS.Platform;
};

/** Built-in catalog of language servers we know how to launch. */
export const LSP_CATALOG: LspCatalogEntry[] = [
  {
    id: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    languages: ["ts", "tsx", "js", "jsx", "mts", "cts"],
    label: "TypeScript / JavaScript",
    install: "npm i -g typescript-language-server typescript",
    npmGlobal: "typescript-language-server typescript",
    brew: "npm i -g typescript-language-server typescript",
  },
  {
    id: "pyright",
    command: "pyright-langserver",
    altCommands: ["basedpyright-langserver"],
    args: ["--stdio"],
    languages: ["py", "pyi"],
    label: "Python (Pyright)",
    install: "npm i -g pyright   # provides pyright-langserver",
    npmGlobal: "pyright",
  },
  {
    id: "pylsp",
    command: "pylsp",
    args: [],
    languages: ["py", "pyi"],
    label: "Python (pylsp)",
    install: "pip install 'python-lsp-server[all]'",
  },
  {
    id: "gopls",
    command: "gopls",
    args: ["serve"],
    languages: ["go"],
    label: "Go (gopls)",
    install: "go install golang.org/x/tools/gopls@latest",
    brew: "brew install gopls",
  },
  {
    id: "rust-analyzer",
    command: "rust-analyzer",
    args: [],
    languages: ["rs"],
    label: "Rust (rust-analyzer)",
    install: "rustup component add rust-analyzer",
    brew: "brew install rust-analyzer",
  },
  {
    id: "clangd",
    command: "clangd",
    args: [],
    languages: ["c", "h", "cc", "cpp", "cxx", "hpp", "hxx", "m", "mm"],
    label: "C / C++ (clangd)",
    install: "Install LLVM/clangd for your OS",
    brew: "brew install llvm  # clangd is usually in $(brew --prefix llvm)/bin",
  },
  {
    id: "lua-language-server",
    command: "lua-language-server",
    args: [],
    languages: ["lua"],
    label: "Lua",
    install: "Install lua-language-server (see https://luals.github.io)",
    brew: "brew install lua-language-server",
  },
];

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    // On Windows, existence is enough for .exe/.cmd; on Unix we don't require mode check
    // because some bins are scripts without +x in weird installs — still try spawn later.
    return true;
  } catch {
    return false;
  }
}

/** Resolve a command name to an absolute path using PATH + common local bins. */
export function whichCommand(cmd: string, extraDirs: string[] = []): string | null {
  const pathEnv = process.env.PATH ?? "";
  const parts = [
    ...extraDirs,
    ...pathEnv.split(delimiter).filter(Boolean),
  ];
  const exts =
    process.platform === "win32"
      ? [".exe", ".cmd", ".bat", ""]
      : [""];
  for (const dir of parts) {
    for (const ext of exts) {
      const p = resolve(dir, cmd + ext);
      if (isExecutableFile(p)) return p;
    }
  }
  return null;
}

function localBinDirs(cwd?: string | null): string[] {
  const dirs: string[] = [];
  if (cwd) {
    dirs.push(join(resolve(cwd), "node_modules", ".bin"));
  }
  // Pi Web itself / agent npm tools
  try {
    dirs.push(join(process.cwd(), "node_modules", ".bin"));
  } catch {
    // ignore
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    dirs.push(join(home, ".pi", "agent", "bin"));
    dirs.push(join(home, ".local", "bin"));
    // rustup default
    dirs.push(join(home, ".cargo", "bin"));
    dirs.push(join(home, "go", "bin"));
  }
  // Homebrew llvm clangd
  if (process.platform === "darwin") {
    for (const prefix of ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"]) {
      if (existsSync(prefix)) dirs.push(prefix);
    }
  }
  return dirs;
}

export function resolveCatalogCommand(
  entry: LspCatalogEntry,
  cwd?: string | null,
): { command: string; path: string | null } {
  const dirs = localBinDirs(cwd);
  const candidates = [entry.command, ...(entry.altCommands ?? [])];
  for (const name of candidates) {
    const p = whichCommand(name, dirs);
    if (p) return { command: name, path: p };
  }
  return { command: entry.command, path: null };
}

/** Pick install command for the running OS — never prefer macOS brew on Windows/Linux. */
export function resolveInstallHints(entry: LspCatalogEntry, platform: NodeJS.Platform = process.platform): {
  install: string;
  installTip?: string;
} {
  // Cross-platform package managers first (npm / pip / go / rustup).
  if (platform === "win32") {
    switch (entry.id) {
      case "clangd":
        return {
          install: "winget install LLVM.LLVM",
          installTip: "Or install from https://clangd.llvm.org/installation.html",
        };
      case "lua-language-server":
        return {
          install: "winget install LuaLS.LuaLanguageServer",
          installTip: "Or see https://luals.github.io/#install",
        };
      case "gopls":
        return { install: "go install golang.org/x/tools/gopls@latest" };
      case "rust-analyzer":
        return { install: "rustup component add rust-analyzer" };
      case "pylsp":
        return { install: "pip install \"python-lsp-server[all]\"" };
      default:
        return { install: entry.install };
    }
  }

  if (platform === "linux") {
    switch (entry.id) {
      case "clangd":
        return {
          install: "sudo apt install clangd",
          installTip: "Fedora: sudo dnf install clang-tools-extra · Arch: sudo pacman -S clang",
        };
      case "lua-language-server":
        return {
          install: entry.install,
          installTip: "Many distros: sudo apt/dnf/pacman install lua-language-server",
        };
      case "gopls":
        return { install: "go install golang.org/x/tools/gopls@latest" };
      case "rust-analyzer":
        return { install: "rustup component add rust-analyzer" };
      default:
        return { install: entry.install };
    }
  }

  // darwin (and others): portable install primary; brew only as optional tip
  const tip =
    entry.brew && entry.brew !== entry.install && entry.brew.includes("brew ")
      ? entry.brew
      : undefined;
  if (entry.id === "clangd") {
    return {
      install: "brew install llvm  # then add $(brew --prefix llvm)/bin to PATH",
      installTip: "Or download from https://clangd.llvm.org/installation.html",
    };
  }
  return { install: entry.install, installTip: tip };
}

export function getLspHealth(cwd?: string | null): {
  servers: LspServerStatus[];
  availableCount: number;
  total: number;
  builtinNote: string;
  platform: NodeJS.Platform;
} {
  const platform = process.platform;
  const servers: LspServerStatus[] = LSP_CATALOG.map((entry) => {
    const { command, path } = resolveCatalogCommand(entry, cwd);
    const hints = resolveInstallHints(entry, platform);
    return {
      id: entry.id,
      label: entry.label,
      command,
      args: entry.args,
      languages: entry.languages,
      available: Boolean(path),
      resolvedPath: path,
      install: hints.install,
      installTip: hints.installTip,
      // Keep brew only when it is actually the mac tip (not for Windows clients).
      brew: platform === "darwin" ? entry.brew : undefined,
      npmGlobal: entry.npmGlobal,
      platform,
    };
  });
  return {
    servers,
    availableCount: servers.filter((s) => s.available).length,
    total: servers.length,
    platform,
    builtinNote:
      "TypeScript/JavaScript also has a built-in language service fallback for references/rename when no external TS server is present.",
  };
}

/** Specs ready to launch (for lsp-client). */
export function getAvailableLspSpecs(cwd?: string | null): Array<{
  id: string;
  command: string;
  args: string[];
  languages: string[];
  resolvedPath: string;
}> {
  return getLspHealth(cwd).servers
    .filter((s): s is LspServerStatus & { resolvedPath: string } => Boolean(s.resolvedPath))
    .map((s) => ({
      id: s.id,
      command: s.command,
      args: s.args,
      languages: s.languages,
      resolvedPath: s.resolvedPath,
    }));
}

export function formatLspHealthReport(cwd?: string | null): string {
  const health = getLspHealth(cwd);
  const lines: string[] = [
    `LSP servers: ${health.availableCount}/${health.total} available`,
    health.builtinNote,
    "",
  ];
  for (const s of health.servers) {
    if (s.available) {
      lines.push(`✓ ${s.id} — ${s.label}`);
      lines.push(`    ${s.command}  →  ${s.resolvedPath}`);
      lines.push(`    languages: ${s.languages.join(", ")}`);
    } else {
      lines.push(`✗ ${s.id} — ${s.label} (not on PATH)`);
      lines.push(`    install: ${s.install}`);
      if (s.installTip) lines.push(`    tip: ${s.installTip}`);
    }
  }
  return lines.join("\n");
}
