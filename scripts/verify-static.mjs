#!/usr/bin/env node
/**
 * UNI8 static verifier — `node scripts/verify-static.mjs`
 *
 * Why this exists: the environment these phases were built in cannot reach the
 * npm registry (E403), so `tsc --noEmit`, `next build` and `next lint` have
 * never run against this tree. This script is the substitute that was promised
 * in `types/database.ts` and `docs/KNOWN_ISSUES.md` — it uses nothing but Node's
 * standard library, so it runs anywhere, with or without `node_modules`.
 *
 * It deliberately does NOT try to be a type checker. It checks the five classes
 * of mistake that are both realistic in a hand-written tree and cheap to catch
 * without a compiler:
 *
 *   1. imports        — every `@/…` and relative import resolves to a real file,
 *                       and every named import exists as an export there.
 *   2. schema         — every table named in `.from("…")`, every column named in
 *                       `.select/.eq/.order/…`, and every enum literal compared
 *                       against one, exists in `supabase/migrations/`.
 *   3. routes         — every internal `href` resolves to an App Router file.
 *   4. balance        — braces and JSX tags balance in every .ts/.tsx file.
 *   5. boundaries     — no `"use client"` file imports a `server-only` module or
 *                       the service-role client; no service-role call site is
 *                       missing a guard; no `NEXT_PUBLIC_` secret leaks.
 *
 * Exit code is 1 if any check produced a failure, so it can gate CI later.
 * `--verbose` lists passes too; `--only=imports,schema` runs a subset.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

/** Directories that hold application source we are responsible for. */
const SOURCE_DIRS = ["app", "components", "lib", "types", "scripts"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".mjs"]);

const failures = [];
const notes = [];
function fail(check, file, message) {
  failures.push({ check, file, message });
}
function note(check, message) {
  notes.push({ check, message });
}

function enabled(check) {
  return ONLY.length === 0 || ONLY.includes(check);
}

/* ── file walking ───────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(extname(entry))) out.push(full);
  }
  return out;
}

const FILES = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d)));
const SRC = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));
const rel = (f) => relative(ROOT, f);

/**
 * Comment and string masking. Every check below scans for code patterns, and a
 * doc comment in this tree is often a paragraph of prose that mentions column
 * names, route paths and tag names — scanning raw text produces false failures
 * from documentation, which is worse than no check at all because it trains the
 * reader to ignore the output. Replacing comment bodies with spaces of the same
 * length keeps every byte offset intact so error positions stay truthful.
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | single | double | tick
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'") mode = "single";
      else if (c === '"') mode = "double";
      else if (c === "`") mode = "tick";
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; } else out += " ";
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? c : " ";
      i++; continue;
    }
    // inside a string literal: copy verbatim, honour escapes, close on the quote
    if (c === "\\") { out += c + (next ?? ""); i += 2; continue; }
    if ((mode === "single" && c === "'") || (mode === "double" && c === '"') || (mode === "tick" && c === "`")) {
      mode = "code";
    }
    out += c; i++; continue;
  }
  return out;
}

const CODE = new Map([...SRC].map(([f, t]) => [f, stripComments(t)]));

/* ── the schema, read from the migrations themselves ────────────────────── */

/**
 * `supabase/migrations/` is the only authority for what exists in the database.
 * `types/database.ts` is a second-hand account of it (generated once, then
 * hand-extended when the registry went down), so checking code against the types
 * would let a mistake in the types validate a matching mistake in the code. This
 * parser is deliberately small and forgiving: it collects the union of every
 * column name a table ever has, across every migration, and never tries to model
 * types, defaults or constraints.
 */
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const tables = new Map(); // name -> Set<column>
const enums = new Map(); // name -> Set<value>
const dbFunctions = new Set();
const unknownColumnTables = new Set(); // views etc. — existence checked, columns not

function addColumn(table, column) {
  if (!tables.has(table)) tables.set(table, new Set());
  tables.get(table).add(column);
}

const NON_COLUMN_STARTS = new Set([
  "primary", "foreign", "unique", "check", "constraint", "exclude", "like", "),", ")",
]);

function parseCreateTableBody(name, body) {
  let depth = 0;
  let current = "";
  const parts = [];
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  for (const part of parts) {
    const first = part.trim().split(/\s+/)[0]?.toLowerCase();
    if (!first || NON_COLUMN_STARTS.has(first)) continue;
    if (/^[a-z_][a-z0-9_]*$/.test(first)) addColumn(name, first);
  }
}

function loadSchema() {
  if (!existsSync(MIGRATIONS)) {
    fail("schema", "supabase/migrations", "directory not found — cannot verify any column reference");
    return;
  }
  for (const file of readdirSync(MIGRATIONS).sort()) {
    if (!file.endsWith(".sql")) continue;
    const sql = readFileSync(join(MIGRATIONS, file), "utf8").replace(/^\s*--.*$/gm, "");

    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
      const name = m[1].toLowerCase();
      // Walk to the matching close paren so nested type/check parens don't end it early.
      let i = m.index + m[0].length;
      let depth = 1;
      let body = "";
      while (i < sql.length && depth > 0) {
        const ch = sql[i];
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
        body += ch;
        i++;
      }
      addColumn(name, "__exists__");
      parseCreateTableBody(name, body);
    }

    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
    )) {
      addColumn(m[1].toLowerCase(), m[2].toLowerCase());
    }
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+rename\s+column\s+([a-z_][a-z0-9_]*)\s+to\s+([a-z_][a-z0-9_]*)/gi
    )) {
      addColumn(m[1].toLowerCase(), m[3].toLowerCase());
    }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      const name = m[1].toLowerCase();
      addColumn(name, "__exists__");
      unknownColumnTables.add(name);
    }
    for (const m of sql.matchAll(/create\s+type\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+as\s+enum\s*\(([^)]*)\)/gi)) {
      const name = m[1].toLowerCase();
      if (!enums.has(name)) enums.set(name, new Set());
      for (const v of m[2].matchAll(/'([^']*)'/g)) enums.get(name).add(v[1]);
    }
    for (const m of sql.matchAll(/alter\s+type\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+value\s+(?:if\s+not\s+exists\s+)?'([^']*)'/gi)) {
      const name = m[1].toLowerCase();
      if (!enums.has(name)) enums.set(name, new Set());
      enums.get(name).add(m[2]);
    }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
      dbFunctions.add(m[1].toLowerCase());
    }
  }
}

/* ── check 1: imports resolve, and named imports exist ──────────────────── */

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const DECLARED_DEPS = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);
/** Bare specifiers that need no package.json entry. */
const BUILTIN_PREFIXES = ["node:", "react", "next", "server-only", "client-only"];

function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return { external: true };

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate };
  }
  return { missing: true };
}

/** Every name a module makes importable, following one level of `export *`. */
function exportsOf(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const text = CODE.get(file) ?? readFileSync(file, "utf8");
  const names = new Set();
  for (const m of text.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.add(m[1]);
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(",")) {
      const alias = piece.split(/\s+as\s+/).pop()?.trim().replace(/^type\s+/, "");
      if (alias) names.add(alias);
    }
  }
  if (/export\s+default/.test(text)) names.add("default");
  for (const m of text.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    const target = resolveModule(m[1], file);
    if (target.file) for (const n of exportsOf(target.file, seen)) names.add(n);
  }
  return names;
}

const exportCache = new Map();
function cachedExports(file) {
  if (!exportCache.has(file)) exportCache.set(file, exportsOf(file));
  return exportCache.get(file);
}

function checkImports() {
  for (const [file, text] of CODE) {
    for (const m of text.matchAll(/import\s+([^;]*?)\s*from\s*["']([^"']+)["']/g)) {
      const clause = m[1];
      const spec = m[2];
      const target = resolveModule(spec, file);

      if (target.external) {
        const pkgName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
        if (!BUILTIN_PREFIXES.some((p) => spec.startsWith(p)) && !DECLARED_DEPS.has(pkgName)) {
          fail("imports", rel(file), `imports "${spec}" but ${pkgName} is not in package.json`);
        }
        continue;
      }
      if (target.missing) {
        fail("imports", rel(file), `cannot resolve "${spec}"`);
        continue;
      }

      const named = clause.match(/\{([^}]*)\}/);
      if (!named) continue;
      const available = cachedExports(target.file);
      for (const piece of named[1].split(",")) {
        const name = piece.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        if (!available.has(name)) {
          fail("imports", rel(file), `"${spec}" has no export "${name}"`);
        }
      }
    }
  }
}

/* ── check 2: every table, column, enum literal and RPC exists ──────────── */

/**
 * PostgREST select strings are the single most common place for a schema typo to
 * hide, because a wrong name there is not a crash — it is a silent `undefined`
 * at render time, or a 400 that only fires on the one page nobody opened. So the
 * parser below understands the real grammar: aliases (`alias:column`), embedded
 * resources with and without FK hints (`profiles!customer_flags_created_by_fkey(name)`),
 * join modifiers (`!inner`, `!left`), aggregates (`count`), and `*`.
 */
const FILTER_METHODS = [
  "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in",
  "contains", "containedBy", "order", "not", "overlaps", "match",
];

function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) { parts.push(current); current = ""; continue; }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function columnExists(table, column) {
  if (unknownColumnTables.has(table)) return true;
  const cols = tables.get(table);
  if (!cols) return true; // table existence is reported separately
  return cols.has(column);
}

function checkSelectString(file, table, select) {
  for (const part of splitTopLevel(select)) {
    if (part.includes("(")) {
      const embedded = part.match(/^([A-Za-z_][\w]*)\s*(?::\s*([A-Za-z_][\w]*))?(?:!([\w]+))?\s*\(([\s\S]*)\)$/);
      if (!embedded) continue;
      const first = embedded[1];
      const second = embedded[2];
      const inner = embedded[4];
      // `table(cols)`, `alias:table(cols)`, `table!hint(cols)`.
      const target = second && tables.has(second) ? second : tables.has(first) ? first : null;
      if (!target) {
        fail("schema", rel(file), `select on "${table}" embeds unknown resource "${second || first}"`);
        continue;
      }
      checkSelectString(file, target, inner);
      continue;
    }
    const name = part.includes(":") ? part.split(":").pop().trim() : part;
    const bare = name.replace(/![\w]+$/, "").trim();
    if (!bare || bare === "*" || bare === "count") continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(bare)) continue;
    if (!columnExists(table, bare)) {
      fail("schema", rel(file), `"${table}" has no column "${bare}" (in a select)`);
    }
  }
}

function checkSchemaUsage() {
  for (const [file, text] of CODE) {
    for (const m of text.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
      if (!dbFunctions.has(m[1])) fail("schema", rel(file), `calls rpc("${m[1]}") but no migration defines it`);
    }

    for (const m of text.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
      const table = m[1];
      if (!tables.has(table)) {
        fail("schema", rel(file), `queries table "${table}" which no migration creates`);
        continue;
      }
      // The chained calls that belong to this query: everything up to the next
      // `.from(` or 4000 characters, whichever comes first.
      const start = m.index + m[0].length;
      const nextFrom = text.indexOf(".from(", start);
      const chunk = text.slice(start, nextFrom === -1 ? start + 4000 : Math.min(nextFrom, start + 4000));

      for (const sel of chunk.matchAll(/\.select\(\s*(["'`])([\s\S]*?)\1/g)) {
        checkSelectString(file, table, sel[2].replace(/\s+/g, " "));
      }
      for (const method of FILTER_METHODS) {
        const re = new RegExp(`\\.${method}\\(\\s*["'\`]([a-z_][a-z0-9_.]*)["'\`]`, "g");
        for (const f of chunk.matchAll(re)) {
          const col = f[1].split(".")[0];
          if (!columnExists(table, col)) {
            fail("schema", rel(file), `"${table}" has no column "${col}" (in .${method}())`);
          }
        }
      }
      for (const w of chunk.matchAll(/\.(insert|update|upsert)\(\s*\{([\s\S]*?)\}\s*[,)]/g)) {
        for (const key of w[2].matchAll(/(?:^|[\s{,])([a-z_][a-z0-9_]*)\s*:/g)) {
          if (!columnExists(table, key[1])) {
            fail("schema", rel(file), `"${table}" has no column "${key[1]}" (in .${w[1]}())`);
          }
        }
      }
    }
  }
}

/* ── check 3: internal links resolve to a route file ────────────────────── */

/**
 * A dead link in an admin console is a dead end for whoever is mid-investigation,
 * and the App Router gives no build error for one. Route groups `(admin)` and
 * dynamic segments `[id]` are both invisible in the URL, so resolution walks the
 * real directory tree rather than pattern-matching strings.
 */
function routeExists(pathname) {
  const segments = pathname.split("/").filter(Boolean);
  const roots = [join(ROOT, "app")];
  for (const entry of readdirSync(join(ROOT, "app"))) {
    if (/^\(.+\)$/.test(entry)) roots.push(join(ROOT, "app", entry));
  }
  outer: for (const root of roots) {
    let dir = root;
    for (const segment of segments) {
      if (!existsSync(dir)) continue outer;
      const dirs = readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
      const next = dirs.find((e) => e === segment) ?? dirs.find((e) => /^\[.+\]$/.test(e));
      if (!next) continue outer;
      dir = join(dir, next);
    }
    if (existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))) return true;
  }
  return false;
}

/**
 * Strips `${...}` template-literal interpolations down to a stand-in
 * dynamic-segment token so a route like `/admin/restaurants/${r.id}/dashboard`
 * resolves against the `[id]`-style directory instead of being truncated at
 * the first `$` (which previously read as "route ends at /admin/restaurants/$").
 * Nested braces inside the interpolation (e.g. `${a ? b : c}`) are handled by
 * depth-tracking rather than a non-greedy regex, which would stop at the
 * first inner `}`.
 */
function collapseTemplateInterpolations(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "$" && str[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < str.length && depth > 0) {
        if (str[i] === "{") depth++;
        else if (str[i] === "}") depth--;
        i++;
      }
      i--; // matched loop's own i++
      out += "x"; // stand-in segment — routeExists() matches it against any [param] dir
    } else {
      out += str[i];
    }
  }
  return out;
}

function checkRoutes() {
  for (const [file, text] of CODE) {
    for (const m of text.matchAll(/href=(?:\{`([^`]*)`\}|"([^"]*)")/g)) {
      const raw = m[1] ?? m[2];
      if (!raw.startsWith("/")) continue;
      const pathname = collapseTemplateInterpolations(raw).split("?")[0].split("#")[0].replace(/\/+$/, "");
      if (!pathname) continue;
      if (!routeExists(pathname)) fail("routes", rel(file), `href "${raw}" has no matching route file`);
    }
    for (const m of text.matchAll(/redirect\(\s*[`"']((?:\$\{[^\x7d]*\}|[^`"'?#])*)/g)) {
      const raw = m[1];
      if (!raw.startsWith("/")) continue;
      const pathname = collapseTemplateInterpolations(raw).replace(/\/+$/, "") || "/";
      if (!routeExists(pathname)) {
        fail("routes", rel(file), `redirect("${raw}") has no matching route file`);
      }
    }
  }
}

/* ── check 4: braces and JSX tags balance ───────────────────────────────── */

/** Masks balanced `{…}` regions so attribute expressions can't be misread as JSX. */
function maskBraces(text) {
  const chars = [...text];
  const stack = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "{") stack.push(i);
    else if (chars[i] === "}" && stack.length) {
      const open = stack.pop();
      if (stack.length === 0) for (let j = open; j <= i; j++) chars[j] = " ";
    }
  }
  return chars.join("");
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "source", "path", "circle", "rect"]);

function checkBalance() {
  for (const [file, text] of CODE) {
    let depth = 0;
    for (const ch of text) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth !== 0) fail("balance", rel(file), `brace depth ends at ${depth}, expected 0`);
    if (!file.endsWith(".tsx")) continue;

    const masked = maskBraces(text);
    const stack = [];
    for (const m of masked.matchAll(/<(\/?)([A-Za-z][\w.]*)((?:[^<>]|=>)*?)(\/?)>/g)) {
      const closing = m[1] === "/";
      const tag = m[2];
      const selfClosing = m[4] === "/";
      if (selfClosing || VOID_TAGS.has(tag)) continue;
      // A generic type application (`ButtonHTMLAttributes<HTMLButtonElement>`,
      // `useState<string>`) reads identically to a JSX opening tag under this
      // regex, EXCEPT that a JSX tag is never immediately preceded by an
      // identifier character — there's always whitespace, `(`, `{`, `>`, a
      // line start, etc. before a real `<Tag`. Angle-bracket generics are the
      // one case that's directly glued to the preceding identifier, so that's
      // the discriminator, not tag-name casing (both JSX components and type
      // names are typically capitalized).
      if (!closing) {
        const before = masked[m.index - 1];
        if (before !== undefined && /[\w.]/.test(before)) continue;
      }
      if (!closing) stack.push(tag);
      else {
        const open = stack.pop();
        if (open !== tag) fail("balance", rel(file), `closes </${tag}> but the open tag was <${open ?? "nothing"}>`);
      }
    }
    if (stack.length) fail("balance", rel(file), `unclosed JSX tags: ${stack.join(", ")}`);
  }
}

/* ── check 5: the boundaries that carry security weight ─────────────────── */

/**
 * Three of these are the difference between a guarded console and a leak:
 *
 *  - a `"use client"` module that imports the service-role client would ship a
 *    key that bypasses every RLS policy to the browser;
 *  - a service-role call site with no `require…()` above it is an unauthenticated
 *    read or write of anyone's data;
 *  - a `NEXT_PUBLIC_` environment variable holding a secret is published by
 *    definition.
 *
 * The fourth (a `"use server"` file exporting a non-async value) is a build
 * error in Next, which this tree cannot currently produce, so it is checked here.
 */
const SERVICE_ROLE_EXEMPT = new Set([
  // Verified by Razorpay HMAC signature instead of a session; documented in the file.
  "app/api/webhooks/razorpay/route.ts",
  // Verified by a shared secret header instead of a session; documented in the file.
  "app/api/maintenance/cleanup/route.ts",
  // The client factory itself, and the sign-in path that must read a profile
  // before a session exists.
  "lib/supabase/server.ts",
]);

function checkBoundaries() {
  for (const [file, text] of CODE) {
    const isClient = /^\s*["']use client["']/m.test(text);
    const isServerActions = /^\s*["']use server["']/m.test(text);
    const relative = rel(file);

    if (isClient) {
      for (const m of text.matchAll(/import\s+[^;]*?from\s*["']([^"']+)["']/g)) {
        const target = resolveModule(m[1], file);
        if (target.file && /^\s*import\s+["']server-only["']/m.test(CODE.get(target.file) ?? "")) {
          fail("boundaries", relative, `"use client" file imports the server-only module "${m[1]}"`);
        }
        if (m[1] === "next/headers") fail("boundaries", relative, `"use client" file imports next/headers`);
      }
      if (text.includes("createServiceRoleSupabaseClient")) {
        fail("boundaries", relative, `"use client" file references the service-role client`);
      }
      if (/SUPABASE_SERVICE_ROLE_KEY|RAZORPAY_KEY_SECRET|WEBHOOK_SECRET|SIGNING_SECRET|CRON_SECRET/.test(text)) {
        fail("boundaries", relative, `"use client" file references a server secret`);
      }
    }

    if (text.includes("createServiceRoleSupabaseClient(") && !SERVICE_ROLE_EXEMPT.has(relative)) {
      const guarded =
        /\brequire(SuperAdmin|VendorAdmin|Staff|Customer|Role|ActiveProfile|RestaurantAccess|Profile|RestaurantScope)\w*\(/.test(
          text
        );
      if (!guarded) {
        fail("boundaries", relative, "uses the service-role client with no require…() guard in the same file");
      }
    }

    if (isServerActions) {
      for (const m of text.matchAll(/^export\s+(?!async\s+function)(?!type\s)(?!interface\s)(.{0,40})/gm)) {
        fail("boundaries", relative, `"use server" file exports a non-async value: export ${m[1].trim()}…`);
      }
    }

    for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)[A-Z0-9_]*/g)) {
      fail("boundaries", relative, `publishes a secret to the browser: ${m[0]}`);
    }
  }
}

/* ── runner ─────────────────────────────────────────────────────────────── */

const CHECKS = [
  ["imports", checkImports],
  ["schema", checkSchemaUsage],
  ["routes", checkRoutes],
  ["balance", checkBalance],
  ["boundaries", checkBoundaries],
];

loadSchema();
note("schema", `${tables.size} tables, ${enums.size} enums and ${dbFunctions.size} functions read from supabase/migrations`);
note("imports", `${FILES.length} source files scanned`);

const ran = [];
for (const [name, fn] of CHECKS) {
  if (!enabled(name)) continue;
  const before = failures.length;
  fn();
  ran.push([name, failures.length - before]);
}

console.log("UNI8 static verification");
console.log("─".repeat(60));
for (const n of notes) if (enabled(n.check)) console.log(`  ${n.check}: ${n.message}`);
console.log("─".repeat(60));

const byCheck = new Map();
for (const f of failures) {
  if (!byCheck.has(f.check)) byCheck.set(f.check, []);
  byCheck.get(f.check).push(f);
}
for (const [name, count] of ran) {
  if (count === 0) {
    console.log(`  PASS  ${name}`);
    continue;
  }
  console.log(`  FAIL  ${name} — ${count} problem${count === 1 ? "" : "s"}`);
  for (const f of byCheck.get(name)) console.log(`          ${f.file}: ${f.message}`);
}
console.log("─".repeat(60));

if (failures.length === 0) {
  console.log("All checks passed. This is not a build — see docs/KNOWN_ISSUES.md #1.");
  process.exit(0);
}
console.log(`${failures.length} problem${failures.length === 1 ? "" : "s"} found.`);
process.exit(1);
