/**
 * mega-bridge-ambient.d.ts — ambient declaration for the OPTIONAL peer dep
 * pi-mega-compact's bridge subpath.
 *
 * Why: the bridge loader dynamic-imports `pi-mega-compact/dist/src/bridge.js`.
 * mega ships the compiled .js WITHOUT a sibling .d.ts for that subpath, so tsc
 * (noImplicitAny) raises TS7016. This ambient module gives the specifier a
 * minimal type so tsc compiles whether or not the package is installed in
 * node_modules. The runtime cast in mega-bridge-loader.ts (→
 * CreateMegaBridgeModule → MegaBridgeContract) is the real type boundary; the
 * conformance test (conformance/bridge-conformance.mjs) verifies mega's actual
 * module satisfies MegaBridgeContract field-for-field.
 *
 * Declaring ONLY the bridge subpath (not the whole package) keeps the surface
 * narrow — nothing else in ithacus imports from pi-mega-compact.
 */
declare module "pi-mega-compact/dist/src/bridge.js" {
  export function createMegaBridge(opts: {
    stateDir: string;
  }): unknown;
}
