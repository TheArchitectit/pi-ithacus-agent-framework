// Sprint 5.24 — RemoteCapabilities resolution matrix (DESIGN_TWO_TIER_POLICY §4).
// Tests the config-layer half of the capability gate: env > project config >
// defaults-all-off; malformed caps dropped; unknown keys ignored.
import { check, cfg } from './_harness.mjs';

const SAVED = { REMOTE: process.env.ITHACUS_REMOTE, CAPS: process.env.ITHACUS_REMOTE_CAPS };
function withEnv(env, fn) {
  delete process.env.ITHACUS_REMOTE; delete process.env.ITHACUS_REMOTE_CAPS;
  if (env.ITHACUS_REMOTE != null) process.env.ITHACUS_REMOTE = env.ITHACUS_REMOTE;
  if (env.ITHACUS_REMOTE_CAPS != null) process.env.ITHACUS_REMOTE_CAPS = env.ITHACUS_REMOTE_CAPS;
  try { return fn(); }
  finally {
    if (SAVED.REMOTE != null) process.env.ITHACUS_REMOTE = SAVED.REMOTE; else delete process.env.ITHACUS_REMOTE;
    if (SAVED.CAPS != null) process.env.ITHACUS_REMOTE_CAPS = SAVED.CAPS; else delete process.env.ITHACUS_REMOTE_CAPS;
  }
}

// 1. Defaults: everything OFF
{
  const c = withEnv({}, () => cfg.loadConfig());
  check('default remoteEnabled is false', c.remote.remoteEnabled === false);
  check('default capabilities all false',
    c.remote.capabilities.a2a === false &&
    c.remote.capabilities.external_memory === false &&
    c.remote.capabilities.mesh === false);
}

// 2. Project config enables master + caps
{
  const c = withEnv({}, () => cfg.loadConfig({ remoteEnabled: true, capabilities: { a2a: true } }));
  check('project config enables master', c.remote.remoteEnabled === true);
  check('project config enables cap', c.remote.capabilities.a2a === true);
  check('other caps stay false', c.remote.capabilities.mesh === false);
}

// 3. Env beats project config (both directions)
{
  const c = withEnv({ ITHACUS_REMOTE: 'true' }, () => cfg.loadConfig({ remoteEnabled: false }));
  check('env ITHACUS_REMOTE=true overrides project false', c.remote.remoteEnabled === true);
}
{
  const c = withEnv({ ITHACUS_REMOTE: 'false' }, () => cfg.loadConfig({ remoteEnabled: true }));
  check('env ITHACUS_REMOTE=false overrides project true', c.remote.remoteEnabled === false);
}
{
  const c = withEnv({ ITHACUS_REMOTE: 'true', ITHACUS_REMOTE_CAPS: 'a2a,mesh' },
    () => cfg.loadConfig({ capabilities: { external_memory: true } }));
  check('env caps replace project caps',
    c.remote.capabilities.a2a === true && c.remote.capabilities.mesh === true &&
    c.remote.capabilities.external_memory === false);
}

// 4. Master switch dominates (gate semantics, config layer)
{
  // master-off × cap-on → inert regardless of cap flag
  const c = withEnv({ ITHACUS_REMOTE: 'false', ITHACUS_REMOTE_CAPS: 'a2a' }, () => cfg.loadConfig());
  check('master-off with cap set stays inert',
    c.remote.remoteEnabled === false);
}
{
  // master-on × cap-off → inert
  const c = withEnv({ ITHACUS_REMOTE: 'true', ITHACUS_REMOTE_CAPS: 'mesh' }, () => cfg.loadConfig());
  check('master-on cap-off stays inert for other cap',
    c.remote.capabilities.a2a === false && c.remote.capabilities.mesh === true);
}

// 5. Malformed / unknown input — spec says reject (throw), never silent-accept
{
  let threw = false;
  try {
    withEnv({ ITHACUS_REMOTE_CAPS: 'a2a,evil;drop' }, () => cfg.loadConfig());
  } catch { threw = true; }
  check('unknown capability id in env caps rejected', threw);
}
{
  const c = withEnv({ ITHACUS_REMOTE: 'yes-please', ITHACUS_REMOTE_CAPS: 'a2a' }, () => cfg.loadConfig());
  check('non-boolean env remote treated as falsy', c.remote.remoteEnabled === false);
  check('valid cap still parsed', c.remote.capabilities.a2a === true);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig({ remoteEnabled: 'true' })); } catch { threw = true; }
  check('non-boolean project remoteEnabled rejected', threw);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig({ capabilities: { a2a: true, bogus: true } })); } catch { threw = true; }
  check('unknown cap key in project config rejected', threw);
}
{
  let threw = false;
  try { withEnv({}, () => cfg.loadConfig('not-an-object')); } catch { threw = true; }
  check('non-object project remote rejected', threw);
}
