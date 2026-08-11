// ---- Agent Permission Modes (Sprint 5.15, module 29) ---------------------
// Pure-resolver unit gate for src/permissions.ts + src/extension-trust.ts +
// src/redact.ts (DESIGN_PERMISSION_MODES.md + PLAN_SPRINT_5_15 §6.1).
// Fixture tokens are BUILT (not pasted) so the secret-scan patterns never see
// a contiguous credential-shaped literal in the source tree.
import { check, permissions as perms, extensionTrust, redact } from "./_harness.mjs";
export async function run(ctx) {
console.error("§29-ENTER perms=" + (perms ? "ok" : "UNDEF"));
void ctx;

// ---- permissions.ts -------------------------------------------------------
check("perms.BASE read_only set (decision: mailbox in base)",
  JSON.stringify(perms.BASE_TOOLS.read_only) === JSON.stringify(["read", "grep", "find", "ls", "ithacus-mailbox"]));
check("perms.BASE workspace_write ⊇ read_only+edit/write, no bash",
  [...perms.BASE_TOOLS.read_only, "edit", "write"].every((t) => perms.BASE_TOOLS.workspace_write.includes(t)) &&
  !perms.BASE_TOOLS.workspace_write.includes("bash"));
check("perms.BASE full_access = bounded KNOWN_TOOLS universe (decision #4)",
  JSON.stringify(perms.BASE_TOOLS.full_access) === JSON.stringify(perms.KNOWN_TOOLS) &&
  perms.BASE_TOOLS.full_access.includes("bash"));
check("perms.normalize fail-safe (empty/garbage/undefined → read_only, valid passes)",
  perms.normalizePermissionMode("") === "read_only" && perms.normalizePermissionMode("garbage") === "read_only" &&
  perms.normalizePermissionMode(undefined) === "read_only" && perms.normalizePermissionMode("full_access") === "full_access");

// Resolution order (design §2.2): deny → mode base → allow; deny always wins.
const rAllow = perms.resolvePermissions({ declared: { mode: "read_only", allow: ["bash"] } });
check("perms.resolve read_only + allow bash → bash allowed", rAllow.toolAllow.includes("bash") && rAllow.mode === "read_only");
const rDeny = perms.resolvePermissions({ declared: { mode: "workspace_write", deny: ["edit"] } });
check("perms.resolve workspace_write deny edit → edit excluded",
  !rDeny.toolAllow.includes("edit") && rDeny.toolDeny.includes("edit"));
const rBoth = perms.resolvePermissions({ declared: { mode: "read_only", allow: ["bash"], deny: ["bash"] } });
check("perms.resolve deny beats allow", !rBoth.toolAllow.includes("bash") && rBoth.toolDeny.includes("bash"));

// Legacy + strict fail-safe (plan legacy decision).
const rLegacy = perms.resolvePermissions({ legacyTools: ["read", "bash"], strict: false });
check("perms.resolve legacy tools pass-through when not strict",
  JSON.stringify(rLegacy.toolAllow) === JSON.stringify(["read", "bash"]));
const rStrict = perms.resolvePermissions({ legacyTools: ["read", "bash"], strict: true });
check("perms.resolve strict → read_only base despite legacy tools",
  rStrict.mode === "read_only" && !rStrict.toolAllow.includes("bash"));
const rNothing = perms.resolvePermissions({});
check("perms.resolve no declaration + no tools → read_only fail-safe",
  rNothing.mode === "read_only" && !rNothing.toolAllow.includes("bash"));
const rDefault = perms.resolvePermissions({ defaultMode: "workspace_write" });
check("perms.resolve custom defaultMode honored when nothing declared",
  rDefault.mode === "workspace_write" && rDefault.toolAllow.includes("write"));

// Frontmatter parsing — both shapes (ithacus-agents.ts string / definitions.ts string[]).
const fmStr = perms.parsePermissionFrontmatter({ permission: "read_only", allow: "bash,edit" });
check("perms.parseFm Record<string,string> shape",
  fmStr !== null && fmStr.mode === "read_only" &&
  JSON.stringify(fmStr.allow) === JSON.stringify(["bash", "edit"]) && fmStr.deny === undefined);
const fmArr = perms.parsePermissionFrontmatter({ permission: ["workspace_write"], deny: ["bash"] });
check("perms.parseFm Record<string,string[]> shape",
  fmArr !== null && fmArr.mode === "workspace_write" && JSON.stringify(fmArr.deny) === JSON.stringify(["bash"]));
check("perms.parseFm no permission key → null", perms.parsePermissionFrontmatter({ tools: "read,ls" }) === null);
check("perms.parseFm unknown mode string normalizes to read_only",
  perms.parsePermissionFrontmatter({ permission: "garbage" })?.mode === "read_only");

// Merge: per-dispatch override on top of a declaration (highest precedence).
const merged = perms.mergePermissions({ mode: "read_only" }, { mode: "workspace_write", allow: ["edit"] });
check("perms.merge override replaces mode + unions allow",
  merged !== null && merged.mode === "workspace_write" && (merged.allow ?? []).includes("edit"));
const mergedDeny = perms.mergePermissions({ mode: "workspace_write", deny: ["bash"] }, { deny: ["write"] });
check("perms.merge unions deny lists", (mergedDeny?.deny ?? []).includes("bash") && (mergedDeny?.deny ?? []).includes("write"));
const overDeny = perms.resolvePermissions({
  declared: { mode: "read_only", deny: ["bash"] },
  override: { allow: ["bash"] },
});
check("perms.resolve declared deny wins over override allow", !overDeny.toolAllow.includes("bash"));

// ---- extension-trust.ts ---------------------------------------------------
check("trust tiers from source (bundled/builtin→trusted, user→standard, project/undefined→untrusted)",
  extensionTrust.trustFromSource("bundled") === "trusted" && extensionTrust.trustFromSource("builtin") === "trusted" &&
  extensionTrust.trustFromSource("user") === "standard" && extensionTrust.trustFromSource("project") === "untrusted" &&
  extensionTrust.trustFromSource(undefined) === "untrusted" && extensionTrust.trustFromSource("mystery") === "untrusted");
check("trust ceiling clamps full_access: project→read_only, user→workspace_write, trusted→kept",
  extensionTrust.applyTrustCeiling("full_access", "untrusted") === "read_only" &&
  extensionTrust.applyTrustCeiling("full_access", "standard") === "workspace_write" &&
  extensionTrust.applyTrustCeiling("full_access", "trusted") === "full_access");
check("trust ordering read_only < workspace_write < full_access",
  extensionTrust.minPermissionMode("read_only", "workspace_write") === "read_only" &&
  extensionTrust.minPermissionMode("workspace_write", "full_access") === "workspace_write" &&
  extensionTrust.minPermissionMode("full_access", "read_only") === "read_only");
check("trust ceiling leaves low modes alone",
  extensionTrust.applyTrustCeiling("read_only", "untrusted") === "read_only");
check("trust describeSourceScope vocab (decision #vocab)",
  extensionTrust.describeSourceScope("untrusted") === "restrictive" &&
  extensionTrust.describeSourceScope("standard") === "balanced" && extensionTrust.describeSourceScope("trusted") === "balanced");

// ---- redact.ts -------------------------------------------------------------
const red1 = redact.redactSecrets("token=sk_live_abc123DEF");
check("redact secrets: token= assignment masked",
  !red1.includes("sk_live_abc123DEF") && red1.includes(redact.REDACT_MASK));
const gh = "Bearer ghp_" + "x".repeat(12);
const red2 = redact.redactSecrets("Authorization: " + gh);
check("redact secrets: Bearer token masked; plain prose passes through",
  !red2.includes(gh) && redact.redactSecrets("hello from the smoke suite") === "hello from the smoke suite");
const pem = "-----BEGIN PRIVATE KEY-----\nMiIBVwIBADANBg\n-----END PRIVATE KEY-----";
check("redact secrets: PRIVATE KEY block masked", !redact.redactSecrets(pem).includes("MiIBVwIBADANBg"));
// AWS-shaped token built via concatenation (never a contiguous literal here).
const awsTok = "AK" + "IA" + "I0S89D0FOOKIE1XAMPLE"; // AKIA + 20 → matches the bounded pattern
const awsArg = "cat /tmp/x && export AWS_KEY=" + awsTok + " && echo " + "y".repeat(40);
const redTa = redact.redactToolArgs(awsArg, 60);
check("redact toolArgs: truncated AND free of the secret",
  redTa.length <= 60 && !redTa.includes(awsTok));
const redAudit = redact.redactForAudit({ agent: "explore", resolvedTools: ["read"], mode: "read_only" });
check("redact forAudit keeps the equal-shape object",
  redAudit.agent === "explore" && JSON.stringify(redAudit.resolvedTools) === JSON.stringify(["read"]) &&
  redAudit.mode === "read_only");
}
