import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A recurring poll never ships as a Server Action (DECISIONS #029, #062).
 *
 * Next runs every server action through one queue in the browser, one
 * after another -- so a timer that asks an action every N seconds puts
 * the user's own Save or Send behind it, every N seconds, on every open
 * tab. That was the app-wide "keeps freezing", twice. Polls ask thin
 * route handlers under src/app/api/ instead; actions are for the clicks
 * people make.
 *
 * This test reads the client components and fails on any setInterval
 * whose callback (or a function it calls directly) invokes something
 * imported from `@/lib/actions/`. A new poll written as an action fails
 * here before it ships.
 */

const ROOTS = ["app", "components"].map((d) => join(import.meta.dirname, "..", d));
const srcRoot = join(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Value identifiers imported from any `@/lib/actions/*` module. */
export function importedActions(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/[^"]+"/g)) {
    for (const part of m[1].split(",")) {
      const item = part.trim();
      if (!item || item.startsWith("type ")) continue;
      names.push(item.split(/\s+as\s+/).pop()!.trim());
    }
  }
  return names;
}

/** The source between the brace at `open` and its match, inclusive. */
function balanced(src: string, open: number, openCh: string, closeCh: string): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Body of a function declared in the file as `function name(` or `const name = `. */
function localBody(src: string, name: string): string | null {
  const decl = new RegExp(String.raw`(?:function\s+${name}\s*\(|(?:const|let)\s+${name}\s*=)`).exec(src);
  if (!decl) return null;
  const brace = src.indexOf("{", decl.index);
  return brace < 0 ? null : balanced(src, brace, "{", "}");
}

/** Every setInterval callback in the file, as source text -- the
 * callback's own body plus the bodies of the local functions it calls. */
export function intervalCallbacks(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/setInterval\s*\(/g)) {
    const args = balanced(src, m.index + m[0].length - 1, "(", ")");
    const first = args.slice(1, -1).trim();
    const ident = /^([A-Za-z_$][\w$]*)\s*,/.exec(first);
    let body = ident ? localBody(src, ident[1]) ?? "" : first;
    // One level of indirection: `setInterval(poll)` where poll calls load().
    for (const call of body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      const inner = localBody(src, call[1]);
      if (inner && inner !== body) body += "\n" + inner;
    }
    out.push(body);
  }
  return out;
}

export function actionPolls(src: string): string[] {
  const actions = importedActions(src);
  if (!actions.length) return [];
  const found = new Set<string>();
  for (const body of intervalCallbacks(src)) {
    for (const name of actions) {
      if (new RegExp(String.raw`\b${name}\s*\(`).test(body)) found.add(name);
    }
  }
  return [...found];
}

test("no client component polls a server action on a timer", () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes('"use client"') || !src.includes("setInterval")) continue;
      const polls = actionPolls(src);
      if (polls.length) offenders.push(`${relative(srcRoot, file)} -> ${polls.join(", ")}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a setInterval callback calls a Server Action; poll a route handler under src/app/api/ instead"
  );
});

test("the scanner sees an action called from a timer, directly or one call away", () => {
  const direct = `"use client";
import { getThing } from "@/lib/actions/thing";
function poll() { void getThing(); }
setInterval(poll, 1000);`;
  assert.deepEqual(actionPolls(direct), ["getThing"]);

  const indirect = `"use client";
import { getThing, type Thing } from "@/lib/actions/thing";
const load = async () => { const t = await getThing(); return t; };
useEffect(() => { const id = setInterval(() => { if (!document.hidden) void load(); }, 5000); }, []);`;
  assert.deepEqual(actionPolls(indirect), ["getThing"]);

  const route = `"use client";
import { sendThing } from "@/lib/actions/thing";
async function poll() { await fetch("/api/thing"); }
setInterval(poll, 1000);
function onClick() { void sendThing(); }`;
  assert.deepEqual(actionPolls(route), []);
});
