// Puts the words back that an English acoustic model was never going to get.
//
// The recogniser's vocabulary is fixed at training time: "Claudex", "pm2" and "tsx" are
// not in it, so it emits the nearest English it knows ("cloud x", "pm two", "t s x").
// sherpa can bias decoding towards extra phrases, but only for models that ship the
// bpe.vocab its hotword encoder needs to turn text into token ids - neither of ours does,
// and hand-built token sequences encode to ids the decoder never emits, so the bias never
// fires. Rewriting the text afterwards is the honest version of the same idea: it costs
// microseconds and it is easy to see why it did what it did.
//
// Deliberately NOT fuzzy. A phonetic matcher would also "fix" words you actually said.
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOCAB_FILE = process.env.ASR_VOCAB || path.join(__dirname, "asr-vocab.txt");

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Spoken forms a canonical term implies on its own, so the file only has to list the
 * surprising ones. "pm2" gets "pm two"/"pm 2"; an acronym like "VPS" gets "v p s".
 */
function autoAliases(term) {
  const out = new Set();
  const runs = term.match(/[a-z]+|[A-Z][a-z]+|[A-Z]+(?![a-z])|\d+/g) || [];
  if (runs.length > 1 && runs.some((r) => /^\d+$/.test(r))) {
    const digits = (r) => (/^\d+$/.test(r) ? [...r].map((d) => DIGITS[+d]).join(" ") : r);
    // "pm2" is said "pm two" by some and "p m two" by others - a short letter run in a
    // term like this is nearly always spelled out.
    const letters = (r) => (!/^\d+$/.test(r) && r.length <= 3 ? [...r].join(" ") : r);
    out.add(runs.map(digits).join(" "));
    out.add(runs.join(" "));
    out.add(runs.map((r) => digits(letters(r))).join(" "));
  }
  // Short all-caps terms, and short vowel-less ones like "tsx" or "npm", are dictated
  // letter by letter - the recogniser hears "t s x" and has no reason to join it up.
  if (/^[A-Za-z]{2,5}$/.test(term) && (term === term.toUpperCase() || !/[aeiou]/i.test(term)))
    out.add([...term].join(" ").toLowerCase());
  return [...out];
}

function parse(text) {
  const rules = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const canonical = (eq < 0 ? line : line.slice(0, eq)).trim();
    if (!canonical) continue;
    const listed = eq < 0 ? [] : line.slice(eq + 1).split(",").map((s) => s.trim()).filter(Boolean);
    for (const alias of new Set([...listed, ...autoAliases(canonical)])) {
      if (alias.toLowerCase() === canonical.toLowerCase()) {
        // Same word, different case - still worth a rule so "vps" becomes "VPS".
        if (alias === canonical) continue;
      }
      rules.push({ canonical, alias });
    }
  }
  // Longest alias first: "p m two" must win before "pm two" can match part of it.
  rules.sort((a, b) => b.alias.length - a.alias.length);
  return rules;
}

function compile(rules) {
  return rules.map(({ canonical, alias }) => ({
    canonical,
    // \b won't anchor an alias ending in a digit followed by a letter, and letter-spelled
    // aliases ("v p s") need the spaces to be flexible about how the recogniser spaced them.
    re: new RegExp(`\\b${esc(alias).replace(/\\?\s+/g, "[\\s.]*")}\\b`, "gi"),
  }));
}

let compiled = [];
try {
  compiled = compile(parse(fs.readFileSync(VOCAB_FILE, "utf8")));
} catch (e) {
  if (e.code !== "ENOENT") console.warn("[asr] vocab file unreadable:", e.message);
}

export const vocabSize = () => compiled.length;

/** Rewrite known-misheard phrases in a recognised string. */
export function applyVocab(text) {
  if (!text || !compiled.length) return text;
  let out = text;
  for (const { canonical, re } of compiled) out = out.replace(re, canonical);
  return out;
}
