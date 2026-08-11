// smoke-src.mjs — runner for the split src/ smoke suite.
import * as s0 from "./smoke-src/00-basics.mjs";
import * as s1 from "./smoke-src/01-async.mjs";
import * as s2 from "./smoke-src/02-presence.mjs";
import * as s3 from "./smoke-src/03-cost.mjs";
import * as s4 from "./smoke-src/04-model-profiles.mjs";
import * as s5 from "./smoke-src/05-validator.mjs";
import * as s6 from "./smoke-src/06-hashline.mjs";
import * as s7 from "./smoke-src/07-checkpoint.mjs";
import * as s8 from "./smoke-src/08-skill-discovery.mjs";
import * as s9 from "./smoke-src/09-advisor.mjs";
import * as s10 from "./smoke-src/10-commits.mjs";
import * as s11 from "./smoke-src/11-schemes.mjs";
import * as s12 from "./smoke-src/12-definitions.mjs";
import * as s13 from "./smoke-src/13-metrics.mjs";
import * as s14 from "./smoke-src/14-trim-preserveheadtail.mjs";
import * as s15 from "./smoke-src/15-browser.mjs";
import * as s16 from "./smoke-src/16-tui-collab.mjs";
import * as s17 from "./smoke-src/17-dap-ast-goal-loops.mjs";
import * as s18 from "./smoke-src/18-dwf-scheduler.mjs";
import * as s19 from "./smoke-src/19-section.mjs";
import * as s20 from "./smoke-src/20-workflow-steps-workflow-yaml.mjs";
import * as s21 from "./smoke-src/21-negotiation-handoff.mjs";
import * as s22 from "./smoke-src/22-swarm-synthesis-hive.mjs";
import * as s23 from "./smoke-src/23-swarm-store-persistence.mjs";
import * as s24 from "./smoke-src/24-plan-synthesis-dispatch.mjs";
import * as s25 from "./smoke-src/25-mailbox.mjs";
import * as s26 from "./smoke-src/26-tool-visibility.mjs";
import * as s27 from "./smoke-src/27-event-bus.mjs";

import { failures, buildDir, tmpRepo } from "./smoke-src/_harness.mjs";
import { rmSync } from "node:fs";

const ctx = {};
try {
  await s0.run(ctx);
  await s1.run(ctx);
  await s2.run(ctx);
  await s3.run(ctx);
  await s4.run(ctx);
  await s5.run(ctx);
  await s6.run(ctx);
  await s7.run(ctx);
  await s8.run(ctx);
  await s9.run(ctx);
  await s10.run(ctx);
  await s11.run(ctx);
  await s12.run(ctx);
  await s13.run(ctx);
  await s14.run(ctx);
  await s15.run(ctx);
  await s16.run(ctx);
  await s17.run(ctx);
  await s18.run(ctx);
  await s19.run(ctx);
  await s20.run(ctx);
  await s21.run(ctx);
  await s22.run(ctx);
  await s23.run(ctx);
  await s24.run(ctx);
  await s25.run(ctx);
  await s26.run(ctx);
  await s27.run(ctx);
} finally {
  try { ctx.store?.close(); } catch {}
}

rmSync(buildDir, { recursive: true, force: true });
rmSync(tmpRepo, { recursive: true, force: true });

console.log("\n" + (failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"));
process.exit(failures === 0 ? 0 : 1);
