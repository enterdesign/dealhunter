// Minimalny dekoder CBOR (RFC 8949) dla danych zapisanych przez Auctionator.
// Wejście: napis binarny (każdy znak = jeden bajt, kody 0-255) albo Uint8Array.
// Bajtowe i tekstowe napisy zwracamy jako napisy (bajt -> znak), bo Auctionator używa ich jako kluczy ASCII.

export function decodeCbor(input) {
  const bytes = typeof input === "string" ? Uint8Array.from(input, (c) => c.charCodeAt(0) & 255) : input;
  let pos = 0;

  const need = (n) => { if (pos + n > bytes.length) throw new Error("CBOR: nieoczekiwany koniec danych"); };
  const uint = (n) => {
    need(n);
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + bytes[pos++];
    return v;
  };
  const argument = (ai) => {
    if (ai < 24) return ai;
    if (ai === 24) return uint(1);
    if (ai === 25) return uint(2);
    if (ai === 26) return uint(4);
    if (ai === 27) return uint(8);
    throw new Error(`CBOR: nieobsługiwana długość (${ai})`);
  };
  const text = (n) => {
    need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[pos + i]);
    pos += n;
    return s;
  };

  function value(depth = 0) {
    if (depth > 64) throw new Error("CBOR: zbyt głębokie zagnieżdżenie");
    need(1);
    const b = bytes[pos++];
    const major = b >> 5, ai = b & 31;
    switch (major) {
      case 0: return argument(ai);
      case 1: return -1 - argument(ai);
      case 2: case 3: return text(argument(ai));
      case 4: {
        const n = argument(ai);
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(value(depth + 1));
        return arr;
      }
      case 5: {
        const n = argument(ai);
        const obj = {};
        for (let i = 0; i < n; i++) {
          const k = value(depth + 1);
          obj[String(k)] = value(depth + 1);
        }
        return obj;
      }
      case 6: argument(ai); return value(depth + 1); // tag: pomijamy
      default: { // 7: proste wartości i liczby zmiennoprzecinkowe
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22 || ai === 23) return null;
        if (ai === 25) { // half
          const h = uint(2), s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
          return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
        }
        if (ai === 26 || ai === 27) {
          const n = ai === 26 ? 4 : 8;
          need(n);
          const dv = new DataView(bytes.buffer, bytes.byteOffset + pos, n);
          pos += n;
          return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0);
        }
        throw new Error(`CBOR: nieobsługiwana prosta wartość (${ai})`);
      }
    }
  }

  const result = value();
  if (pos !== bytes.length) throw new Error(`CBOR: ${bytes.length - pos} nadmiarowych bajtów`);
  return result;
}
