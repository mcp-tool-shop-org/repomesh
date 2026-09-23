// Daily anchor-xrpl: compute-root --since-last prints {"eventCount":0,"root":null}
// and does not write partition-root.json. An idle epoch must skip the post path
// and finish green. A non-empty partition still runs post-anchor.mjs, which
// fails on its own if that file is missing.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(HERE, "..", "..", "..", ".github", "workflows", "anchor-xrpl.yml");

const PREDICATE = "(j.eventCount===0||j.root==null)";
const IDLE_GATE = "success() && steps.compute.outputs.idle != 'true'";

function parseSteps(yaml) {
  const lines = yaml.split(/\r?\n/);
  const steps = [];
  let current = null;
  let inRun = false;

  const push = () => {
    if (current) steps.push(current);
  };

  for (const line of lines) {
    if (inRun && (line.startsWith("          ") || line.trim() === "")) {
      const body = line.trim() === "" ? "" : line.slice(10);
      current.run += (current.run.length > 0 ? "\n" : "") + body;
      continue;
    }
    inRun = false;

    const named = line.match(/^      - name: (.*)$/);
    const uses = line.match(/^      - uses: (\S+)/);
    if (named || uses) {
      push();
      current = {
        name: (named ? named[1] : uses[1]).trim(),
        id: null,
        if: null,
        run: "",
      };
      continue;
    }
    if (!current) continue;

    const id = line.match(/^        id: (\S+)\s*$/);
    if (id) {
      current.id = id[1];
      continue;
    }
    const gate = line.match(/^        if: (.*)$/);
    if (gate) {
      current.if = gate[1].trim();
      continue;
    }
    if (/^        run: \|\s*$/.test(line)) {
      inRun = true;
      continue;
    }
    const inline = line.match(/^        run: (.*)$/);
    if (inline) current.run = inline[1];
  }
  push();
  return steps;
}

function stepRuns(step, ctx) {
  if (!step.if) return ctx.success;
  const parts = step.if.split(/\s*&&\s*/);
  const status = new Set(["success()", "failure()", "always()", "cancelled()"]);
  const checks = parts.some((part) => status.has(part)) ? parts : ["success()", ...parts];
  return checks.every((part) => {
    if (part === "success()") return ctx.success;
    if (part === "failure()") return ctx.failure;
    if (part === "always()") return true;
    if (part === "cancelled()") return ctx.cancelled === true;
    if (part === "steps.compute.outputs.idle != 'true'") return ctx.idle !== "true";
    if (part === "steps.check.outputs.anchor != '0'") return ctx.anchor !== "0";
    throw new Error(`unrecognized if clause in "${step.name}": ${part}`);
  });
}

function idleBranch(script) {
  const lines = script.split("\n");
  const start = lines.findIndex((line) => line.includes('if [ "$IDLE" = "true" ]'));
  assert.ok(start >= 0, "compute step branches when the epoch is idle");
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "fi") end += 1;
  assert.ok(end < lines.length, "idle branch closes");
  return lines.slice(start, end + 1).join("\n");
}

const yaml = fs.readFileSync(WORKFLOW, "utf8");
const steps = parseSteps(yaml);
const compute = steps.find((step) => step.name === "Compute partition root");
const post = steps.find((step) => step.name === "Post anchor to XRPL");
const emit = steps.find((step) => step.name === "Emit anchor event");
const append = steps.find((step) => step.name === "Append anchor event to ledger via PR");
const alert = steps.find((step) => step.name === "Alert on failure");

const isIdle = new Function("j", `"use strict"; return ${PREDICATE};`);

function ctxFor(partition, extra = {}) {
  return {
    success: true,
    failure: false,
    idle: isIdle(partition) ? "true" : "false",
    anchor: extra.anchor ?? "1",
  };
}

describe("anchor-xrpl idle epoch", () => {
  it("eventCount 0 or root null skips post-anchor.mjs", () => {
    assert.ok(compute, "Compute partition root step");
    assert.equal(compute.id, "compute");
    assert.ok(compute.run.includes(PREDICATE), "stdout JSON decides idle");
    assert.match(compute.run, /echo "idle=\$\{IDLE\}" >> "\$GITHUB_OUTPUT"/);
    assert.equal(post.if, IDLE_GATE);
    assert.equal(emit.if, IDLE_GATE);
    assert.equal(append.if, `${IDLE_GATE} && steps.check.outputs.anchor != '0'`);
    assert.match(post.run, /post-anchor\.mjs/);
    assert.match(post.run, /docker run/);

    const idlePartitions = [
      { partitionId: "since:2026-06-22T00:00:00.000Z", eventCount: 0, root: null },
      { eventCount: 0, root: "ab".repeat(32) },
      { eventCount: 4, root: null },
    ];
    for (const partition of idlePartitions) {
      assert.equal(isIdle(partition), true);
      const ctx = ctxFor(partition, { anchor: "1" });
      assert.equal(stepRuns(post, ctx), false, JSON.stringify(partition));
      assert.equal(stepRuns(emit, ctx), false, JSON.stringify(partition));
      assert.equal(stepRuns(append, ctx), false, JSON.stringify(partition));
    }

    const branch = idleBranch(compute.run);
    assert.match(branch, /idle epoch, same tree, nothing to post/);
  });

  it("invokes post-anchor.mjs when the partition is non-empty", () => {
    const partition = {
      partitionId: "since:2026-06-22T00:00:00.000Z",
      eventCount: 2,
      root: "cd".repeat(32),
    };
    assert.equal(isIdle(partition), false);
    const ctx = ctxFor(partition, { anchor: "1" });
    assert.equal(stepRuns(post, ctx), true);
    assert.match(post.run, /docker run/);
    assert.match(post.run, /anchor\/xrpl\/scripts\/post-anchor\.mjs/);
    assert.equal(stepRuns(emit, ctx), true);
    assert.equal(stepRuns(append, ctx), true);
    assert.equal(stepRuns(append, ctxFor(partition, { anchor: "0" })), false);
  });

  it("idle path does not exit 1", () => {
    const ctx = ctxFor({ eventCount: 0, root: null }, { anchor: "1" });
    assert.equal(stepRuns(post, ctx), false);
    const branch = idleBranch(compute.run);
    assert.doesNotMatch(branch, /\bexit\s+1\b/);
    for (const step of steps) {
      if (!stepRuns(step, ctx)) continue;
      assert.doesNotMatch(step.run, /\bexit\s+1\b/, `${step.name} runs on an idle epoch`);
    }
    assert.equal(alert.if, "failure()");
    assert.equal(stepRuns(alert, ctx), false);
    assert.equal(stepRuns(alert, { success: false, failure: true, idle: "", anchor: "" }), true);
  });
});
