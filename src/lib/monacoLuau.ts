// src/lib/monacoLuau.ts
// Luau language support for Monaco Editor — Monarch grammar + basic diagnostics

export function registerLuauLanguage(monaco: typeof import("monaco-editor")) {
  // ── Monarch grammar ────────────────────────────────────────────────────
  monaco.languages.register({ id: "luau" });

  monaco.languages.setMonarchTokensProvider("luau", {
    defaultToken: "",
    tokenPostfix: ".luau",

    keywords: [
      "and", "break", "do", "else", "elseif", "end", "false", "for",
      "function", "if", "in", "local", "nil", "not", "or", "repeat",
      "return", "then", "true", "until", "while",
      // Luau-specific
      "continue", "export", "type", "typeof", "cast",
    ],

    builtins: [
      "assert", "error", "getfenv", "getmetatable", "ipairs", "loadstring",
      "newproxy", "next", "pairs", "pcall", "print", "rawequal", "rawget",
      "rawlen", "rawset", "select", "setfenv", "setmetatable", "tonumber",
      "tostring", "type", "unpack", "xpcall", "warn",
      // Luau additions
      "debug.info", "debug.profilebegin", "debug.profileend", "debug.resetmemorycategory",
      "debug.setmemorycategory", "debug.traceback", "math.abs", "math.acos",
      "math.asin", "math.atan", "math.atan2", "math.ceil", "math.clamp",
      "math.cos", "math.cosh", "math.deg", "math.exp", "math.floor",
      "math.fmod", "math.frexp", "math.ldexp", "math.log", "math.log10",
      "math.max", "math.min", "math.modf", "math.noise", "math.pow",
      "math.rad", "math.random", "math.randomseed", "math.round", "math.sign",
      "math.sin", "math.sinh", "math.sqrt", "math.tan", "math.tanh",
      "os.clock", "os.date", "os.difftime", "os.time", "string.byte",
      "string.char", "string.find", "string.format", "string.gmatch",
      "string.gsub", "string.len", "string.lower", "string.match",
      "string.pack", "string.packsize", "string.rep", "string.reverse",
      "string.split", "string.sub", "string.unpack", "string.upper",
      "table.create", "table.find", "table.foreach", "table.foreachi",
      "table.freeze", "table.getn", "table.insert", "table.isfrozen",
      "table.maxn", "table.move", "table.remove", "table.sort", "table.unpack",
      "task.cancel", "task.defer", "task.delay", "task.spawn", "task.wait",
      "coroutine.close", "coroutine.create", "coroutine.isyieldable",
      "coroutine.resume", "coroutine.running", "coroutine.status",
      "coroutine.wrap", "coroutine.yield",
    ],

    operators: [
      "+", "-", "*", "/", "%", "^", "#", "==", "~=", "<=", ">=", "<",
      ">", "=", "..", "+=", "-=", "*=", "/=", "%=", "^=", "..=",
    ],

    symbols: /[=><!~?:&|+\-*\/\^%#\.]+/,

    escapes:
      /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,2}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    brackets: [
      { open: "{", close: "}", token: "delimiter.bracket" },
      { open: "[", close: "]", token: "delimiter.array" },
      { open: "(", close: ")", token: "delimiter.parenthesis" },
    ],

    tokenizer: {
      root: [
        { include: "@whitespace" },
        { include: "@comments" },
        { include: "@strings" },
        { include: "@numbers" },
        { include: "@operators" },
        { include: "@identifiers" },
        { include: "@brackets" },
      ],

      whitespace: [[/[\t\n\r\s]+/, "white"]],

      comments: [
        [/--\[\[/, "comment", "@multiLineComment"],
        [/--.+/, "comment"],
      ],

      multiLineComment: [
        [/\]\]/, "comment", "@pop"],
        [/\[\[/, "comment", "@push"],
        [/./, "comment"],
      ],

      strings: [
        [/"/, "string", "@doubleQuotedString"],
        [/'/, "string", "@singleQuotedString"],
        [/\[\[/, "string", "@multiLineString"],
        [/`/, "string", "@templateString"],
      ],

      doubleQuotedString: [
        [/[^\\"]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/"/, "string", "@pop"],
      ],

      singleQuotedString: [
        [/[^\\']+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/'/, "string", "@pop"],
      ],

      multiLineString: [
        [/\]\]/, "string", "@pop"],
        [/\[\[/, "string", "@push"],
        [/./, "string"],
      ],

      templateString: [
        [/[^\\`{]+/, "string"],
        [/@escapes/, "string.escape"],
        [/\\./, "string.escape.invalid"],
        [/\{/, "string", "@templateExpression"],
        [/`/, "string", "@pop"],
      ],

      templateExpression: [
        [/\}/, "string", "@pop"],
        { include: "@root" },
      ],

      numbers: [
        [/0[xX][0-9a-fA-F]+(\.[0-9a-fA-F]+)?([pP][+-]?[0-9]+)?/, "number.hex"],
        [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number.float"],
        [/\d+/, "number"],
      ],

      operators: [
        [/@symbols/, {
          cases: {
            "@operators": "operator",
            "@default": "",
          },
        }],
      ],

      identifiers: [
        [/\btype\b/, { token: "keyword", next: "@typeDefinition" }],
        [/\b[A-Z][a-zA-Z0-9_]*\b/, "type.identifier"],
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@builtins": "predefined",
              "@default": "identifier",
            },
          },
        ],
      ],

      typeDefinition: [
        { include: "@whitespace" },
        [/\b[a-zA-Z_]\w*\b/, "type.identifier"],
        [/=/, "operator", "@pop"],
        [/\{/, "delimiter.bracket", "@pop"],
        [/<=/, "operator", "@pop"],
      ],

      brackets: [
        [/[{}()\[\]]/, "@brackets"],
      ],
    },
  });

  // ── Configuration ──────────────────────────────────────────────────────
  monaco.languages.setLanguageConfiguration("luau", {
    comments: {
      lineComment: "--",
      blockComment: ["--[[", "]]"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    folding: {
      markers: {
        start: /^\s*--\s*#?region\b/,
        end: /^\s*--\s*#?endregion\b/,
      },
    },
    indentationRules: {
      increaseIndentPattern: /^(\s*(else|elseif|for|function|if|repeat|while)\b.*|\s*\{\s*)$/,
      decreaseIndentPattern: /^\s*(elseif|else|end|until|\})\b.*$/,
    },
  });
}

// ── Basic diagnostics ──────────────────────────────────────────────────

const LUAU_GLOBALS = new Set([
  "assert", "error", "getfenv", "getmetatable", "ipairs", "loadstring",
  "newproxy", "next", "pairs", "pcall", "print", "rawequal", "rawget",
  "rawlen", "rawset", "select", "setfenv", "setmetatable", "tonumber",
  "tostring", "type", "unpack", "xpcall", "warn",
  "task", "coroutine", "debug", "math", "os", "string", "table", "buffer",
  "bit32", "utf8", "DateTime", "Vector3", "Vector2", "CFrame", "Color3",
  "BrickColor", "UDim", "UDim2", "Rect", "NumberRange", "NumberSequence",
  "NumberSequenceKeypoint", "ColorSequence", "ColorSequenceKeypoint",
  "PhysicalProperties", "Ray", "Random", "Enum", "game", "workspace",
  "script", "shared", "require", "wait", "delay", "spawn",
]);

const LUAU_KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for",
  "function", "if", "in", "local", "nil", "not", "or", "repeat",
  "return", "then", "true", "until", "while", "continue", "export",
  "type", "typeof",
]);

interface LintDiagnostic {
  severity: "Error" | "Warning" | "Information" | "Hint";
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function runLuauLinter(code: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = code.split("\n");
  const declaredLocals = new Set<string>();
  const declaredGlobals = new Set<string>();

  // Simple regex-based linter — catches common issues
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track local declarations
    const localMatch = line.match(/^\s*local\s+(\w+)/);
    if (localMatch) {
      declaredLocals.add(localMatch[1]);
    }

    // Track function declarations
    const funcMatch = line.match(/^\s*(?:local\s+)?function\s+(\w+)/);
    if (funcMatch) {
      declaredLocals.add(funcMatch[1]);
    }

    // Track global assignments (no local keyword)
    const globalAssign = line.match(/^\s*([a-zA-Z_]\w*)\s*=[^=]/);
    if (globalAssign && !LUAU_KEYWORDS.has(globalAssign[1]) && !line.match(/^\s*local\s/)) {
      declaredGlobals.add(globalAssign[1]);
    }

    // Detect undeclared globals (basic heuristic)
    const wordRegex = /\b([a-zA-Z_]\w*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = wordRegex.exec(line)) !== null) {
      const word = m[1];
      if (
        LUAU_KEYWORDS.has(word) ||
        LUAU_GLOBALS.has(word) ||
        declaredLocals.has(word) ||
        declaredGlobals.has(word) ||
        word.match(/^[A-Z]/) // types
      ) {
        continue;
      }
      // Skip if it's inside a string on this line (naive)
      const before = line.slice(0, m.index);
      const quoteCount = (before.match(/"/g) || []).length + (before.match(/'/g) || []).length;
      if (quoteCount % 2 !== 0) continue;

      // Skip comments
      const commentIdx = line.indexOf("--");
      if (commentIdx >= 0 && m.index > commentIdx) continue;

      diagnostics.push({
        severity: "Warning",
        message: `"${word}" may be an undefined global`,
        startLineNumber: lineNum,
        startColumn: m.index + 1,
        endLineNumber: lineNum,
        endColumn: m.index + word.length + 1,
      });
    }

    // Detect trailing whitespace
    if (line.match(/\s+$/)) {
      diagnostics.push({
        severity: "Hint",
        message: "Trailing whitespace",
        startLineNumber: lineNum,
        startColumn: line.length,
        endLineNumber: lineNum,
        endColumn: line.length + 1,
      });
    }
  }

  // Limit diagnostics to avoid overwhelming the UI
  return diagnostics.slice(0, 50);
}
