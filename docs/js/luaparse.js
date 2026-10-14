// Parser plików SavedVariables (fragment Lua: przypisania zmiennych globalnych z tabelami/literałami).
// Tablica Lua z kluczami 1..n bez dziur -> tablica JS, w przeciwnym razie obiekt (klucze jako teksty).

class LuaSyntaxError extends Error {}

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const err = (msg) => { throw new LuaSyntaxError(`${msg} (pozycja ${i})`); };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "-" && src[i + 1] === "-") {
      const m = /^--\[(=*)\[/.exec(src.slice(i, i + 40));
      if (m) {
        const end = src.indexOf("]" + m[1] + "]", i + m[0].length);
        i = end < 0 ? n : end + m[1].length + 2;
      } else {
        while (i < n && src[i] !== "\n") i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      let out = "";
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") {
          i++;
          const e = src[i];
          if (e === "n") out += "\n";
          else if (e === "t") out += "\t";
          else if (e === "r") out += "\r";
          else if (e === "\n") out += "\n";
          else if (/[0-9]/.test(e)) {
            const m = /^[0-9]{1,3}/.exec(src.slice(i, i + 3));
            out += String.fromCharCode(parseInt(m[0], 10));
            i += m[0].length - 1;
          } else out += e;
        } else out += src[i];
        i++;
      }
      if (i >= n) err("niezamknięty tekst");
      i++;
      toks.push({ t: "str", v: out });
      continue;
    }
    if (c === "[") {
      const m = /^\[(=*)\[/.exec(src.slice(i, i + 40));
      if (m) {
        const close = "]" + m[1] + "]";
        const start = i + m[0].length;
        const end = src.indexOf(close, start);
        if (end < 0) err("niezamknięty długi tekst");
        let body = src.slice(start, end);
        if (body[0] === "\n") body = body.slice(1);
        toks.push({ t: "str", v: body });
        i = end + close.length;
        continue;
      }
      toks.push({ t: "[" }); i++; continue;
    }
    if ("{}]=,;".includes(c)) { toks.push({ t: c }); i++; continue; }
    const num = /^-?(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(src.slice(i, i + 64));
    if (num) { toks.push({ t: "num", v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
    if (id) { toks.push({ t: "id", v: id[0] }); i += id[0].length; continue; }
    err(`nieoczekiwany znak "${c}"`);
  }
  return toks;
}

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const fail = (msg) => { throw new LuaSyntaxError(msg); };

  function value() {
    const tk = next();
    if (!tk) fail("nieoczekiwany koniec pliku");
    if (tk.t === "str" || tk.t === "num") return tk.v;
    if (tk.t === "id") {
      if (tk.v === "true") return true;
      if (tk.v === "false") return false;
      if (tk.v === "nil") return null;
      fail(`nieznany identyfikator "${tk.v}"`);
    }
    if (tk.t === "{") return table();
    return fail(`nieoczekiwany token "${tk.t}"`);
  }

  function table() {
    const map = new Map();
    let auto = 1;
    while (peek() && peek().t !== "}") {
      let key;
      if (peek().t === "[") {
        next(); key = value();
        if (next()?.t !== "]") fail("oczekiwano ]");
        if (next()?.t !== "=") fail("oczekiwano =");
      } else if (peek().t === "id" && toks[p + 1]?.t === "=") {
        key = next().v; next();
      } else {
        key = auto++;
      }
      map.set(key, value());
      if (peek() && (peek().t === "," || peek().t === ";")) next();
    }
    if (next()?.t !== "}") fail("niezamknięta tabela");
    const keys = [...map.keys()];
    const isArray = keys.length > 0 && keys.every((k, idx) => k === idx + 1);
    if (isArray) return keys.map((k) => map.get(k));
    const obj = {};
    for (const [k, v] of map) if (v !== null) obj[String(k)] = v;
    return obj;
  }

  const result = {};
  while (peek()) {
    const name = next();
    if (name.t !== "id" || next()?.t !== "=") fail("oczekiwano przypisania zmiennej");
    result[name.v] = value();
  }
  return result;
}

export function parseSavedVariables(text) {
  return parse(tokenize(text));
}
export { LuaSyntaxError };
