/**
 * scan:secrets - scans git-tracked and staged files for real secret patterns.
 *
 * Run before every push: `npm run scan:secrets`. Exits 1 if anything is found.
 * Findings print the file, line and pattern name only, never the matched value.
 *
 * Patterns (CLAUDE.md section 8):
 *   - Google API keys: "AIza" followed by 35 key characters
 *   - "api-key=" followed by a UUID-like value (Helius RPC URLs)
 *   - JSON arrays of 64 numbers (Solana keypair files)
 *   - "-----BEGIN" (PEM private keys)
 * Placeholders such as REPLACE_ME do not match these patterns.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

export interface SecretPattern {
  name: string;
  regex: RegExp;
}

// The patterns are assembled from parts so this file does not match itself.
const BEGIN_MARKER = "-----" + "BEGIN";

export const SECRET_PATTERNS: SecretPattern[] = [
  { name: "google-api-key", regex: new RegExp("AI" + "za[0-9A-Za-z_-]{35}") },
  {
    name: "rpc-api-key-uuid",
    regex: new RegExp(
      "api-key=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    ),
  },
  {
    name: "keypair-byte-array",
    regex: /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/,
  },
  // A real PEM header: the marker, a space, an upper-case label, then five
  // dashes. The bare marker quoted in CLAUDE.md's rule text is not a finding.
  { name: "pem-block", regex: new RegExp(BEGIN_MARKER + " [A-Z0-9 ]+-----") },
];

export interface Finding {
  file: string;
  line: number;
  pattern: string;
}

/** Scans one file's text. Returns findings without the matched values. */
export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(lineText)) {
        findings.push({ file, line: index + 1, pattern: pattern.name });
      }
    }
  });
  // A keypair array can be pretty-printed across many lines; check the whole
  // text with whitespace collapsed as well.
  const keypair = SECRET_PATTERNS.find((p) => p.name === "keypair-byte-array");
  if (
    keypair &&
    !findings.some((f) => f.pattern === keypair.name) &&
    keypair.regex.test(text.replace(/\s+/g, ""))
  ) {
    findings.push({ file, line: 0, pattern: keypair.name });
  }
  return findings;
}

const MAX_FILE_BYTES = 2_000_000;
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|ico|webp|woff2?|ttf|otf|pdf|zip)$/i;

function listFiles(): string[] {
  const run = (args: string[]) =>
    execFileSync("git", args, { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  // Tracked files plus anything staged (includes newly added files).
  const tracked = run(["ls-files", "-z"]);
  const staged = run(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
  return [...new Set([...tracked, ...staged])];
}

function main(): void {
  let files: string[];
  try {
    files = listFiles();
  } catch {
    console.error("scan:secrets: could not list files with git. Is this a git repository?");
    process.exit(2);
  }
  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of files) {
    if (BINARY_EXTENSIONS.test(file)) continue;
    try {
      if (statSync(file).size > MAX_FILE_BYTES) continue;
      findings.push(...scanText(file, readFileSync(file, "utf8")));
      scanned++;
    } catch {
      // Deleted in the working tree but still tracked; nothing to scan.
    }
  }
  if (findings.length > 0) {
    console.error(`scan:secrets: ${findings.length} possible secret(s) found:`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line || "(multi-line)"}  [${f.pattern}]`);
    }
    console.error("Do not push. Remove the value, and rotate the key if it was ever pushed.");
    process.exit(1);
  }
  console.log(`scan:secrets: clean (${scanned} files scanned).`);
}

// Run only when executed directly, not when imported by tests.
if (process.argv[1] && /scan-secrets\.ts$/.test(process.argv[1])) {
  main();
}
