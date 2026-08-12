// ---- UiFlags (Sprint 5.27 §3.5, module 32) --------------------------------
// Tests the default-ON local UI feature flags in src/config.ts (the opt-out
// surface the web Setup panel writes to). Resolution matrix mirrors module 30
// (RemoteCapabilities): env (ITHACUS_UI=flag:bool,...) > project config "ui"
// key > defaults ALL ON. Unlike Tier R remote capabilities (default OFF),
// every local UI flag defaults ON and users opt OUT.
//
// Mirrors module 30/31's structure — checks run at module top-level (so they
// execute at `import * as s32` in smoke-src.mjs) with NO `run` export. The
// runner calls `await s32.run(ctx)` which is a no-op for a missing export.
import { check, cfg } from "./_harness.mjs";

const DEFAULTS = cfg.UI_FLAG_DEFAULTS;
const IDS = cfg.UI_FLAG_IDS;

const SAVED_UI = process.env.ITHACUS_UI;
function withEnv(env, fn) {
  if (env.ITHACUS_UI != null) process.env.ITHACUS_UI = env.ITHACUS_UI;
  else delete process.env.ITHACUS_UI;
  try { return fn(); }
  finally {
    if (SAVED_UI != null) process.env.ITHACUS_UI = SAVED_UI;
    else delete process.env.ITHACUS_UI;
  }
}

// 1. Flag vocabulary: exactly the five specified ids, all default ON
check("s32 ui flag ids exactly spec",
  JSON.stringify([...IDS]) === JSON.stringify(["liveCard", "webUi", "widget", "menuOverlay", "notifications"]));
check("s32 all defaults true",
  DEFAULTS.liveCard === true && DEFAULTS.webUi === true && DEFAULTS.widget === true &&
  DEFAULTS.menuOverlay === true && DEFAULTS.notifications === true);

// 2. Defaults: no env, no project config → all ON
{
  const c = withEnv({}, () => cfg.loadConfig());
  check("s32 default ui all on",
    c.ui.liveCard === true && c.ui.webUi === true && c.ui.widget === true &&
    c.ui.menuOverlay === true && c.ui.notifications === true);
}

// 3. Project config opt-out (`ui` key) — flipped key off, others stay on
{
  const c = withEnv({}, () => cfg.loadConfig(undefined, { liveCard: false, webUi: false }));
  check("s32 project config opts out liveCard+webUi",
    c.ui.liveCard === false && c.ui.webUi === false);
  check("s32 project config leaves others on",
    c.ui.widget === true && c.ui.menuOverlay === true && c.ui.notifications === true);
}

// 4. Env opt-out (ITHACUS_UI=flag:false,...)
{
  const c = withEnv({ ITHACUS_UI: "webUi:false,notifications:false" }, () => cfg.loadConfig());
  check("s32 env opts out webUi+notifications",
    c.ui.webUi === false && c.ui.notifications === false);
  check("s32 env leaves others on",
    c.ui.liveCard === true && c.ui.widget === true && c.ui.menuOverlay === true);
}

// 5. Env beats project config (both directions)
{
  const c = withEnv({ ITHACUS_UI: "liveCard:false" }, () => cfg.loadConfig(undefined, { liveCard: true }));
  check("s32 env ITHACUS_UI overrides project true", c.ui.liveCard === false);
}
{
  const c = withEnv({ ITHACUS_UI: "liveCard:true" }, () => cfg.loadConfig(undefined, { liveCard: false }));
  check("s32 env re-enables project-off flag", c.ui.liveCard === true);
}

// 6. Partial project config keeps other defaults (merge, not replace)
{
  const c = withEnv({}, () => cfg.loadConfig(undefined, { webUi: false }));
  check("s32 partial project keeps others default-on",
    c.ui.webUi === false && c.ui.liveCard === true && c.ui.menuOverlay === true);
}

// 7. Malformed / unknown rejected (throw), never silently accepted
{
  let threw = false;
  try { withEnv({ ITHACUS_UI: "bogus:false" }, () => cfg.loadConfig()); } catch { threw = true; }
  check("s32 unknown ui flag in env rejected", threw);
}
{
  let threw = false;
  try { withEnv({ ITHACUS_UI: "liveCard:yes" }, () => cfg.loadConfig()); } catch { threw = true; }
  check("s32 non-boolean env value rejected", threw);
}
{
  let threw = false;
  try { withEnv({ ITHACUS_UI: "liveCard" }, () => cfg.loadConfig()); } catch { threw = true; }
  check("s32 malformed env entry (missing colon) rejected", threw);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig(undefined, { liveCard: "true" })); } catch { threw = true; }
  check("s32 non-boolean project ui flag rejected", threw);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig(undefined, { bogus: true })); } catch { threw = true; }
  check("s32 unknown ui key in project config rejected", threw);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig(undefined, "not-an-object")); } catch { threw = true; }
  check("s32 non-object project ui rejected", threw);
}

// 8. parseUiFlags is pure + exposed (same as parseRemoteCapabilities)
{
  const p = cfg.parseUiFlags(null);
  check("s32 parseUiFlags(null) = all-on defaults",
    p.liveCard === true && p.webUi === true && p.widget === true &&
    p.menuOverlay === true && p.notifications === true);
}
{
  const p = cfg.parseUiFlags({ widget: false });
  check("s32 parseUiFlags partial merge keeps others on",
    p.widget === false && p.liveCard === true && p.menuOverlay === true);
}

// Sprint 5.22: module 32 runs at import time (top-level) — provide a no-op
// run so smoke-src.mjs await s32.run(ctx) does not throw and silently skip s33
// (the silent ALL-PASSED-after-s32 bug).
export async function run() {}
