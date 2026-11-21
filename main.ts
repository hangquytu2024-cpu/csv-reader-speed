// The harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json (a JSON array of {id, input}),
// answers each one alone with solve.js, and writes /output/answers.json: a JSON array of the answers, one per case and
// in the cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output.
//
// solve.js's run(input) returns an answer as an object, like csv-reader's readCsv. Here each answer is written straight
// to JSON bytes by runInto instead, so no answer is built as objects and stringified.
//
// The input is read as latin1, one character per byte: the cases file is JSON that JSON.stringify wrote, so its text is
// UTF-8 with no \u escapes unless a text held a control character or a lone surrogate. Without a \u escape the bytes of
// each parsed text are exactly the UTF-8 of the real text, and Buffer.from(text, 'latin1') hands them to runInto at once.
// With one, the file is read the ordinary way, and a text with a lone surrogate goes through run and JSON.stringify.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it (the rules allow an
// entry to tune V8's flags, as the house baseline does).
setFlagsFromString('--no-incremental-marking');

interface Writer {
  buf: Buffer;
  o: number;
}
const { run, runInto, createWriter, putString } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
  runInto: (w: Writer, b: Buffer, header: boolean) => void;
  createWriter: (size?: number) => Writer;
  putString: (w: Writer, s: string) => void;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

type Cases = { id: string; input: { text: unknown; header: unknown } }[];
const file = readFileSync(join(INPUT_DIR, 'cases.json'));
const escaped = file.includes('\\u');
const cases = JSON.parse(escaped ? file.toString('utf8') : file.latin1Slice(0, file.length)) as Cases;

const w = createWriter(1 << 25);
putString(w, '[');
for (let i = 0; i < cases.length; i++) {
  if (i > 0) putString(w, ',');
  const input = cases[i]!.input;
  const text = String(input.text);
  if (!escaped) runInto(w, Buffer.from(text, 'latin1'), input.header === true);
  else if (text.isWellFormed()) runInto(w, Buffer.from(text, 'utf8'), input.header === true);
  else putString(w, JSON.stringify(run(input)));
}
putString(w, ']');
writeFileSync(join(OUTPUT_DIR, 'answers.json'), w.buf.subarray(0, w.o));
