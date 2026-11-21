# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/hangquytu2024-cpu/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/hangquytu2024-cpu/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0. It reads a CSV text once, left to right, by the same broken-row policy (stray CRs, unterminated quotes, junk after a closing quote, short and long rows) and returns the same `{columns, rows, errors}`, about 4 to 5 times less CPU time than the reference on the practice set.

- `solve.js` exports `run(input)`, which returns the answer as an object exactly as csv-reader does. It scans character codes and cuts each field out with `slice`, and sends the rare cases (a stray CR, an unclosed quote, junk after a quote) through one slow helper that follows the reference line by line. It also exports `runInto`, the same reading over UTF-8 bytes that writes the answer straight to JSON.
- `main.ts` reads the cases as latin1 (one character per byte, so the UTF-8 bytes of each text come out at once), answers each with `runInto` and writes `answers.json` as one buffer. With a `\u` escape in the input it falls back to an ordinary UTF-8 read, and a text with a lone surrogate goes through `run` and `JSON.stringify`.

Both paths were checked against the reference on the practice set and on random broken text (stray CRs, lone surrogates, control characters, unterminated quotes), with no difference found.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Needs Node 22.18 or newer and nothing else. `input/cases.json` is the practice set from the make.fun kit for the bounty.

---

<sub>Entered on [make.fun](https://make.fun/?ref=x2mfc4pb&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
