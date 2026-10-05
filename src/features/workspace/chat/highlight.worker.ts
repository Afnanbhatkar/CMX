/**
 * CodeMind X V2 — Phase 8.5 highlight worker.
 *
 * A small, dependency-free tokenizer used for LONG code blocks (where
 * main-thread highlighting would compete with streaming). It returns typed
 * token runs per line; the renderer maps them to colored spans as React
 * nodes (never innerHTML — model output is untrusted).
 *
 * Honesty (CAPABILITIES.md): this is a lightweight regex tokenizer for the
 * common languages, NOT a full grammar parser. Unsupported languages fall
 * back to plain text — nothing is faked.
 */

export interface HighlightToken {
  /** t: c=comment, s=string, n=number, k=keyword, f=function-call, p=punct, x=plain */
  t: "c" | "s" | "n" | "k" | "f" | "p" | "x";
  v: string;
}

export interface HighlightRequest {
  id: number;
  code: string;
  language: string;
}

export interface HighlightResponse {
  id: number;
  /** Token runs per line; null = unsupported language → plain render. */
  lines: HighlightToken[][] | null;
}

const KEYWORDS: Record<string, Set<string>> = {
  js: new Set(["const","let","var","function","return","if","else","for","while","do","switch","case","break","continue","new","class","extends","super","this","import","export","from","default","async","await","try","catch","finally","throw","typeof","instanceof","in","of","delete","void","yield","static","get","set","null","undefined","true","false","interface","type","enum","implements","private","public","protected","readonly","abstract","declare","namespace","as","satisfies","keyof","infer","never","unknown","any","string","number","boolean","void"]),
  python: new Set(["def","class","return","if","elif","else","for","while","import","from","as","with","try","except","finally","raise","yield","lambda","global","nonlocal","pass","break","continue","and","or","not","in","is","None","True","False","async","await","self","print"]),
  shell: new Set(["if","then","else","elif","fi","for","in","do","done","while","case","esac","function","return","export","local","echo","cd","sudo","npm","npx","bun","git","curl","mkdir","rm","cp","mv","set"]),
  sql: new Set(["select","from","where","and","or","not","null","insert","into","values","update","set","delete","create","table","primary","key","foreign","references","join","left","right","inner","outer","on","group","by","order","limit","offset","as","distinct","having","index","alter","add","constraint","default"]),
  go: new Set(["package","import","func","return","if","else","for","range","switch","case","default","break","continue","go","defer","chan","select","type","struct","interface","map","var","const","nil","true","false","string","int","error"]),
  rust: new Set(["fn","let","mut","const","if","else","match","for","in","while","loop","return","struct","enum","impl","trait","pub","use","mod","crate","self","super","where","async","await","move","Some","None","Ok","Err","true","false"]),
  css: new Set(["important"]),
};

function keywordSetFor(language: string): Set<string> | null {
  const lang = language.toLowerCase();
  if (["ts","tsx","js","jsx","typescript","javascript","mjs","cjs","json"].includes(lang)) return KEYWORDS.js;
  if (["py","python"].includes(lang)) return KEYWORDS.python;
  if (["sh","bash","shell","zsh"].includes(lang)) return KEYWORDS.shell;
  if (lang === "sql") return KEYWORDS.sql;
  if (lang === "go") return KEYWORDS.go;
  if (["rs","rust"].includes(lang)) return KEYWORDS.rust;
  if (["css","scss"].includes(lang)) return KEYWORDS.css;
  return null;
}

/** Line-comment prefix for the language (null = none). */
function lineCommentFor(language: string): string | null {
  const lang = language.toLowerCase();
  if (["py","python","sh","bash","shell","zsh","yaml","yml","toml","rb","ruby"].includes(lang)) return "#";
  if (lang === "sql") return "--";
  if (["ts","tsx","js","jsx","typescript","javascript","mjs","cjs","java","kt","swift","go","rs","rust","c","cpp","cs","php","json"].includes(lang)) return "//";
  return null;
}

const supportsBlockComments = (language: string): boolean =>
  ["ts","tsx","js","jsx","typescript","javascript","mjs","cjs","java","kt","swift","go","rs","rust","c","cpp","cs","php","css","scss","graphql"].includes(language.toLowerCase());

const STRING_RE = /(['"`])(?:\\.|(?!\1)[\s\S])*?\1|`(?:\\.|[^`\\])*`/y;

/** Tokenize one line given the carry state (inside block comment). */
function tokenizeLine(
  line: string,
  language: string,
  keywords: Set<string> | null,
  state: { inBlockComment: boolean },
): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const push = (t: HighlightToken["t"], v: string) => {
    if (!v) return;
    const last = tokens[tokens.length - 1];
    if (last && last.t === t) last.v += v;
    else tokens.push({ t, v });
  };
  const lineComment = lineCommentFor(language);
  let rest = line;

  if (state.inBlockComment) {
    const end = rest.indexOf("*/");
    if (end === -1) {
      push("c", rest);
      return tokens;
    }
    push("c", rest.slice(0, end + 2));
    rest = rest.slice(end + 2);
    state.inBlockComment = false;
  }

  let i = 0;
  while (i < rest.length) {
    const chunk = rest.slice(i);

    if (supportsBlockComments(language) && chunk.startsWith("/*")) {
      const end = chunk.indexOf("*/", 2);
      if (end === -1) {
        push("c", chunk);
        state.inBlockComment = true;
        i = rest.length;
        break;
      }
      push("c", chunk.slice(0, end + 2));
      i += end + 2;
      continue;
    }
    if (lineComment && chunk.startsWith(lineComment)) {
      push("c", chunk);
      break;
    }
    STRING_RE.lastIndex = 0;
    const strMatch = STRING_RE.exec(chunk);
    if (strMatch && strMatch.index === 0) {
      push("s", strMatch[0]);
      i += strMatch[0].length;
      continue;
    }
    const strAhead = /(['"`])/.exec(chunk);
    const numMatch = /^\d[\d_.]*(?:[eE][+-]?\d+)?[a-z%]*/.exec(chunk);
    const wordMatch = /^[A-Za-z_$][\w$]*/.exec(chunk);
    const punctMatch = /^[^\w\s'"`]+/.exec(chunk);

    if (numMatch && (!strAhead || strAhead.index !== 0)) {
      push("n", numMatch[0]);
      i += numMatch[0].length;
      continue;
    }
    if (wordMatch) {
      const word = wordMatch[0];
      const after = chunk.slice(word.length);
      if (keywords?.has(word)) push("k", word);
      else if (/^\s*\(/.test(after)) push("f", word);
      else push("x", word);
      i += word.length;
      continue;
    }
    if (punctMatch && punctMatch[0].length > 0) {
      push("p", punctMatch[0]);
      i += punctMatch[0].length;
      continue;
    }
    // whitespace / anything else
    const ws = /^\s+/.exec(chunk);
    if (ws) {
      push("x", ws[0]);
      i += ws[0].length;
      continue;
    }
    push("x", chunk[0]);
    i += 1;
  }
  return tokens;
}

function tokenize(code: string, language: string): HighlightToken[][] | null {
  const keywords = keywordSetFor(language);
  if (!keywords) return null; // unsupported → plain render (honest fallback)
  const state = { inBlockComment: false };
  return code.split("\n").map((line) => tokenizeLine(line, language, keywords, state));
}

const self_ = self as unknown as Worker;
self_.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id, code, language } = event.data;
  let lines: HighlightToken[][] | null = null;
  try {
    lines = tokenize(code, language);
  } catch {
    lines = null;
  }
  const response: HighlightResponse = { id, lines };
  self_.postMessage(response);
};
