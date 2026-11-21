// A faster drop-in for csv-reader 1.0.0: run({text, header}) returns the same {columns, rows, errors}.
//
// The reference reads one character at a time and builds each field by appending to a string. This reads the text by
// character codes and cuts each field out with slice, so a plain field costs one scan and one substring. The broken-row
// policy is the reference's, rule for rule, and the rare paths (a stray CR, a quote that never closes, junk after a
// closing quote) go through one slow helper that follows the reference's readUnquoted exactly.

/** What slowUnquoted hands back: where reading stopped, the line there, how the field ended, its value, how much it kept. */
const R = { pos: 0, line: 1, ended: 0, value: '', added: 0 };

// ended: 0 the field ended at a comma (the record goes on), 1 at a line break or the end of the text (the record ends).

/**
 * Reads unquoted characters from i up to the next comma or line break, onto `value` (what the field already holds).
 * A CR not followed by LF is dropped and recorded as stray_cr. `added` counts the characters kept after the start.
 */
function slowUnquoted(text, n, i, value, added, line, errors, recordLine, recordRow) {
  let seg = i;
  for (;;) {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44 || c === 10 || c === 13) break;
      i++;
    }
    if (i >= n) {
      added += i - seg;
      value += text.slice(seg, i);
      R.pos = n;
      R.ended = 1;
      break;
    }
    const c = text.charCodeAt(i);
    if (c === 44) {
      added += i - seg;
      value += text.slice(seg, i);
      R.pos = i + 1;
      R.ended = 0;
      break;
    }
    if (c === 10 || text.charCodeAt(i + 1) === 10) {
      added += i - seg;
      value += text.slice(seg, i);
      R.pos = c === 10 ? i + 1 : i + 2;
      line += 1;
      R.ended = 1;
      break;
    }
    // A lone CR: dropped, and a stray_cr is recorded.
    added += i - seg;
    value += text.slice(seg, i);
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    i += 1;
    seg = i;
  }
  R.line = line;
  R.value = value;
  R.added = added;
}

/** The reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended = 0;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos;
        let i = open + 1;
        let esc = false;
        let cr = false;
        let lf = false;
        for (;;) {
          if (i >= n) break;
          const c = text.charCodeAt(i);
          if (c > 34) {
            i += 1;
            continue;
          }
          if (c === 34) {
            if (text.charCodeAt(i + 1) === 34) {
              esc = true;
              i += 2;
              continue;
            }
            break;
          }
          if (c === 13) cr = true;
          else if (c === 10) lf = true;
          i += 1;
        }
        if (i >= n) {
          // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          slowUnquoted(text, n, open + 1, '"', 0, line, errors, recordLine, recordRow);
          pos = R.pos;
          line = R.line;
          ended = R.ended;
          value = R.value;
        } else {
          value = text.slice(open + 1, i);
          if (esc) value = value.replace(/""/g, '"');
          if (cr || lf) {
            // Each LF, CRLF and lone CR inside the quotes is one line, and CRLF and a lone CR are read as LF.
            for (let k = open + 1; k < i; k++) {
              const c = text.charCodeAt(k);
              if (c === 10) line += 1;
              else if (c === 13) {
                line += 1;
                if (text.charCodeAt(k + 1) === 10) k += 1;
              }
            }
            if (cr) value = value.replace(/\r\n?/g, '\n');
          }
          pos = i + 1;
          if (pos >= n) {
            ended = 1;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = 1;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = 1;
            } else {
              // What follows the closing quote is appended as it stands, up to the next comma or line break.
              slowUnquoted(text, n, pos, value, 0, line, errors, recordLine, recordRow);
              if (R.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              pos = R.pos;
              line = R.line;
              ended = R.ended;
              value = R.value;
            }
          }
        }
      } else {
        quoted = false;
        let i = pos;
        let c = 0;
        for (; i < n; i++) {
          c = text.charCodeAt(i);
          if (c > 44) continue;
          if (c === 44 || c === 10 || c === 13) break;
        }
        if (i >= n) {
          value = text.slice(pos, i);
          pos = n;
          ended = 1;
        } else if (c === 44) {
          value = text.slice(pos, i);
          pos = i + 1;
          ended = 0;
        } else if (c === 10) {
          value = text.slice(pos, i);
          pos = i + 1;
          line += 1;
          ended = 1;
        } else if (text.charCodeAt(i + 1) === 10) {
          value = text.slice(pos, i);
          pos = i + 2;
          line += 1;
          ended = 1;
        } else {
          slowUnquoted(text, n, i, text.slice(pos, i), 0, line, errors, recordLine, recordRow);
          pos = R.pos;
          line = R.line;
          ended = R.ended;
          value = R.value;
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// ---------------------------------------------------------------------------------------------------------------------
// The same reading, written straight to JSON bytes. main.ts uses it so that no answer is built as objects and then
// stringified. It reads the text as UTF-8 bytes (every delimiter is ASCII, so no multi-byte character is split) and writes
// {"rows":[...],"columns":...,"errors":[...]} into a growing buffer. A text with a lone surrogate (which UTF-8 cannot
// carry) goes through run() and JSON.stringify instead.
// ---------------------------------------------------------------------------------------------------------------------

/** A growing output buffer: bytes [0, o) are written. */
export function createWriter(size = 1 << 24) {
  return { buf: Buffer.allocUnsafe(size), o: 0 };
}

function grow(w, need) {
  let size = w.buf.length * 2;
  while (size < w.o + need) size *= 2;
  const next = Buffer.allocUnsafe(size);
  w.buf.copy(next, 0, 0, w.o);
  w.buf = next;
}

/** Appends a JS string as UTF-8. */
export function putString(w, s) {
  const need = s.length * 3 + 8;
  if (w.o + need > w.buf.length) grow(w, need);
  w.o += w.buf.write(s, w.o, 'utf8');
}

const HEX = '0123456789abcdef';

/** Writes one byte c (< 32, a quote or a backslash) as a JSON escape; returns the new offset. */
function escapeByte(out, o, c) {
  out[o++] = 92;
  if (c === 34 || c === 92) out[o++] = c;
  else if (c === 10) out[o++] = 110;
  else {
    out[o++] = 117;
    out[o++] = 48;
    out[o++] = 48;
    out[o++] = HEX.charCodeAt(c >> 4);
    out[o++] = HEX.charCodeAt(c & 15);
  }
  return o;
}

/** slowUnquoted over bytes: the same reading, the value decoded from the byte ranges it keeps. */
function slowBytes(b, n, i, value, added, line, errors, recordLine, recordRow) {
  let seg = i;
  for (;;) {
    while (i < n) {
      const c = b[i];
      if (c === 44 || c === 10 || c === 13) break;
      i++;
    }
    if (i >= n) {
      added += i - seg;
      value += b.utf8Slice(seg, i);
      R.pos = n;
      R.ended = 1;
      break;
    }
    const c = b[i];
    if (c === 44) {
      added += i - seg;
      value += b.utf8Slice(seg, i);
      R.pos = i + 1;
      R.ended = 0;
      break;
    }
    if (c === 10 || b[i + 1] === 10) {
      added += i - seg;
      value += b.utf8Slice(seg, i);
      R.pos = c === 10 ? i + 1 : i + 2;
      line += 1;
      R.ended = 1;
      break;
    }
    added += i - seg;
    value += b.utf8Slice(seg, i);
    errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    i += 1;
    seg = i;
  }
  R.line = line;
  R.value = value;
  R.added = added;
}

const OPEN = Buffer.from('{"rows":[');

/**
 * Appends the JSON answer for a text to the writer: the same value run() returns.
 * `b` is the text as UTF-8 (a Buffer); the text must be well formed (no lone surrogate).
 */
export function runInto(w, b, header) {
  const n = b.length;
  const errors = [];
  let columns = null;
  let width = -1;
  let pos = n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  let line = 1;
  let rowsOut = 0;
  if (w.o + 16 > w.buf.length) grow(w, 16);
  let out = w.buf;
  let o = w.o;
  o += OPEN.copy(out, o);

  for (;;) {
    while (pos < n) {
      const c = b[pos];
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && b[pos + 1] === 10) {
        pos += 2;
        line += 1;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const isHeader = header && columns === null;
    const recordRow = isHeader ? null : rowsOut;
    const recStart = o;
    let hdr = null; // the header record's fields, as strings
    let extra = null; // a long row's cut fields
    if (isHeader) hdr = [];
    else {
      if (o + 8 > out.length) { w.o = o; grow(w, 8); out = w.buf; }
      if (rowsOut > 0) out[o++] = 44;
      out[o++] = 91;
    }
    let count = 0;
    let quoted = false;
    let firstLen = -1;
    let ended = 0;
    do {
      // The field is written as bytes (the common case) or built as a string (the header, a field cut from a long row,
      // a field with junk after its quote, a stray CR or an unclosed quote in it).
      const emit = !isHeader && (width < 0 || count < width);
      let sval = null;
      let a = 0;
      let z = 0;
      let isQuoted = false;
      if (pos < n && b[pos] === 34) {
        isQuoted = true;
        const open = pos;
        let i = open + 1;
        for (;;) {
          if (i >= n) break;
          const c = b[i];
          if (c > 34) { i += 1; continue; }
          if (c === 34) {
            if (b[i + 1] === 34) { i += 2; continue; }
            break;
          }
          i += 1;
        }
        if (i >= n) {
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          slowBytes(b, n, open + 1, '"', 0, line, errors, recordLine, recordRow);
          pos = R.pos; line = R.line; ended = R.ended; sval = R.value;
        } else {
          const after = i + 1 < n ? b[i + 1] : -1;
          const plain = after === -1 || after === 44 || after === 10 || (after === 13 && b[i + 2] === 10);
          if (plain && emit) {
            // write the content: "" is one quote, CRLF and a lone CR are one LF, each of them one line
            const len = i - open - 1;
            const need = len * 6 + 4;
            if (o + need > out.length) { w.o = o; grow(w, need); out = w.buf; }
            if (count > 0) out[o++] = 44;
            out[o++] = 34;
            for (let k = open + 1; k < i; k++) {
              const c = b[k];
              if (c >= 32 && c !== 34 && c !== 92) { out[o++] = c; continue; }
              if (c === 34) { o = escapeByte(out, o, 34); k += 1; }
              else if (c === 13) { out[o++] = 92; out[o++] = 110; line += 1; if (b[k + 1] === 10) k += 1; }
              else if (c === 10) { out[o++] = 92; out[o++] = 110; line += 1; }
              else o = escapeByte(out, o, c);
            }
            out[o++] = 34;
            if (count === 0) firstLen = len;
            pos = i + 1;
            if (after === -1) ended = 1;
            else if (after === 44) { pos += 1; ended = 0; }
            else if (after === 10) { pos += 1; line += 1; ended = 1; }
            else { pos += 2; line += 1; ended = 1; }
            count += 1;
            quoted = true;
            continue;
          }
          // built as a string: the unescaped content, then any junk
          let s = b.utf8Slice(open + 1, i);
          let hasEsc = false;
          let hasCr = false;
          let hasNl = false;
          for (let k = open + 1; k < i; k++) {
            const c = b[k];
            if (c === 34) { hasEsc = true; k += 1; } else if (c === 13) hasCr = true; else if (c === 10) hasNl = true;
          }
          if (hasEsc) s = s.replace(/""/g, '"');
          if (hasCr || hasNl) {
            for (let k = open + 1; k < i; k++) {
              const c = b[k];
              if (c === 10) line += 1;
              else if (c === 13) { line += 1; if (b[k + 1] === 10) k += 1; }
            }
            if (hasCr) s = s.replace(/\r\n?/g, '\n');
          }
          pos = i + 1;
          if (after === -1) { ended = 1; sval = s; }
          else if (after === 44) { pos += 1; ended = 0; sval = s; }
          else if (after === 10) { pos += 1; line += 1; ended = 1; sval = s; }
          else if (after === 13 && b[i + 2] === 10) { pos += 2; line += 1; ended = 1; sval = s; }
          else {
            slowBytes(b, n, pos, s, 0, line, errors, recordLine, recordRow);
            if (R.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            pos = R.pos; line = R.line; ended = R.ended; sval = R.value;
          }
        }
      } else {
        let i = pos;
        let c = 0;
        for (; i < n; i++) {
          c = b[i];
          if (c > 44) continue;
          if (c === 44 || c === 10 || c === 13) break;
        }
        if (i >= n) { a = pos; z = i; pos = n; ended = 1; }
        else if (c === 44) { a = pos; z = i; pos = i + 1; ended = 0; }
        else if (c === 10) { a = pos; z = i; pos = i + 1; line += 1; ended = 1; }
        else if (b[i + 1] === 10) { a = pos; z = i; pos = i + 2; line += 1; ended = 1; }
        else {
          slowBytes(b, n, i, b.utf8Slice(pos, i), 0, line, errors, recordLine, recordRow);
          pos = R.pos; line = R.line; ended = R.ended; sval = R.value;
        }
      }
      quoted = isQuoted;
      if (sval !== null) {
        if (count === 0) firstLen = sval.length;
        if (isHeader) hdr.push(sval);
        else if (emit) {
          const js = JSON.stringify(sval);
          const need = js.length * 3 + 4;
          if (o + need > out.length) { w.o = o; grow(w, need); out = w.buf; }
          if (count > 0) out[o++] = 44;
          o += out.write(js, o, 'utf8');
        } else (extra ??= []).push(sval);
      } else if (isHeader) {
        if (count === 0) firstLen = z - a;
        hdr.push(b.utf8Slice(a, z));
      } else if (emit) {
        if (count === 0) firstLen = z - a;
        const need = (z - a) * 6 + 8;
        if (o + need > out.length) { w.o = o; grow(w, need); out = w.buf; }
        if (count > 0) out[o++] = 44;
        out[o++] = 34;
        for (let k = a; k < z; k++) {
          const c = b[k];
          if (c >= 32 && c !== 34 && c !== 92) out[o++] = c;
          else o = escapeByte(out, o, c);
        }
        out[o++] = 34;
      } else {
        (extra ??= []).push(b.utf8Slice(a, z));
      }
      count += 1;
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (count === 1 && firstLen === 0 && !quoted) {
      o = recStart;
      continue;
    }

    if (width < 0) width = count;
    if (isHeader) {
      columns = hdr;
      continue;
    }
    if (count < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: count });
      const pad = width - count;
      const need = pad * 3 + 4;
      if (o + need > out.length) { w.o = o; grow(w, need); out = w.buf; }
      for (let k = 0; k < pad; k++) {
        if (count + k > 0) out[o++] = 44;
        out[o++] = 34;
        out[o++] = 34;
      }
    } else if (count > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra });
    }
    if (o + 2 > out.length) { w.o = o; grow(w, 2); out = w.buf; }
    out[o++] = 93;
    rowsOut += 1;
  }

  w.o = o;
  putString(w, `],"columns":${header ? JSON.stringify(columns ?? []) : 'null'},"errors":${JSON.stringify(errors)}}`);
}
