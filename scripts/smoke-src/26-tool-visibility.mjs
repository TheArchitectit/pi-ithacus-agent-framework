// ---- tool-visibility tiers (task #22, module 26) --------------------------
import { failures, check, toolVisibility } from "./_harness.mjs";
export async function run(ctx) {
const { ToolVisibility, resolveCallerContext, isVisible, filterToolNames, TIER_LABEL } = toolVisibility;

// hierarchy: PUBLIC < INTERNAL < ADMIN numerically (0/1/2)
check("tv.PUBLIC=0", ToolVisibility.PUBLIC === 0);
check("tv.INTERNAL=1", ToolVisibility.INTERNAL === 1);
check("tv.ADMIN=2", ToolVisibility.ADMIN === 2);
check("tv.hierarchy ADMIN>INTERNAL", ToolVisibility.ADMIN > ToolVisibility.INTERNAL);
check("tv.hierarchy INTERNAL>PUBLIC", ToolVisibility.INTERNAL > ToolVisibility.PUBLIC);

// resolveCallerContext: admin flag wins (explicit, not env — can't be spoofed)
const adminCtx = resolveCallerContext({}, { admin: true });
check("tv.admin tier", adminCtx.tier === ToolVisibility.ADMIN);
check("tv.admin caller", adminCtx.caller === "admin");

// child: ITHACUS_AGENT_ID present -> PUBLIC
const childCtx = resolveCallerContext({ ITHACUS_AGENT_ID: "explore" });
check("tv.child tier PUBLIC", childCtx.tier === ToolVisibility.PUBLIC);
check("tv.child caller", childCtx.caller === "child");

// interactive: no env, no admin -> INTERNAL
const interCtx = resolveCallerContext({});
check("tv.interactive tier INTERNAL", interCtx.tier === ToolVisibility.INTERNAL);
check("tv.interactive caller", interCtx.caller === "interactive");

// admin flag wins even if ITHACUS_AGENT_ID present (child can't spoof admin)
const spoof = resolveCallerContext({ ITHACUS_AGENT_ID: "explore" }, { admin: true });
check("tv.admin wins over child env", spoof.tier === ToolVisibility.ADMIN && spoof.caller === "admin");

// isVisible: tool visible iff toolTier <= ctx.tier
check("tv.PUBLIC visible to child", isVisible(ToolVisibility.PUBLIC, childCtx) === true);
check("tv.INTERNAL NOT visible to child", isVisible(ToolVisibility.INTERNAL, childCtx) === false);
check("tv.ADMIN NOT visible to interactive", isVisible(ToolVisibility.ADMIN, interCtx) === false);
check("tv.INTERNAL visible to interactive", isVisible(ToolVisibility.INTERNAL, interCtx) === true);
check("tv.INTERNAL visible to admin", isVisible(ToolVisibility.INTERNAL, adminCtx) === true);
check("tv.PUBLIC visible to admin", isVisible(ToolVisibility.PUBLIC, adminCtx) === true);
check("tv.ADMIN visible to admin", isVisible(ToolVisibility.ADMIN, adminCtx) === true);

// filterToolNames
const registry = { "ithacus-mailbox": ToolVisibility.PUBLIC, "ithacus-dispatch": ToolVisibility.INTERNAL };
check("tv.child sees only PUBLIC", JSON.stringify(filterToolNames(registry, childCtx).sort()) === JSON.stringify(["ithacus-mailbox"]));
check("tv.interactive sees both", JSON.stringify(filterToolNames(registry, interCtx).sort()) === JSON.stringify(["ithacus-dispatch", "ithacus-mailbox"]));
check("tv.admin sees both", JSON.stringify(filterToolNames(registry, adminCtx).sort()) === JSON.stringify(["ithacus-dispatch", "ithacus-mailbox"]));

// TIER_LABEL round-trips
check("tv.label public", TIER_LABEL[ToolVisibility.PUBLIC] === "public");
check("tv.label internal", TIER_LABEL[ToolVisibility.INTERNAL] === "internal");
check("tv.label admin", TIER_LABEL[ToolVisibility.ADMIN] === "admin");
}
