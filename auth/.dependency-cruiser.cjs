// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Public surface = package-root entry points (index, routes, leaf faces).
// Implementation is under lib/. Cross-package imports must hit package-root
// files, never lib/.
//
// Cycle detection walks lib/ graphs. Package-root entry points are opaque
// (doNotFollow) so a fat index barrel does not paint every consumer with
// every re-export's dependencies. Real cycles inside a package's lib/ still
// fail. Cross-package cycles are broken with leaf faces + init-at-boot.

const PACKAGES_ROOT = "src/packages";
const R = PACKAGES_ROOT;
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;
/** Any file directly under a package root (index, routes, faces). */
const PACKAGE_ENTRY = `^${R}/[^/]+/[^/]+\\.ts$`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-composition",
      comment:
        "Composition roots (app/boot/index) may import package entry points only, never lib/ internals.",
      severity: "error",
      from: { path: "^src/(app|boot|index)\\.ts$" },
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package may reach OTHER packages only through their entry points, never their lib/ internals.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`,
      },
    },
    {
      name: "no-circular-in-lib",
      comment:
        "No dependency cycles in package implementation (lib/). Type-only and dynamic import edges are allowed. Entry-point barrels are not followed.",
      severity: "error",
      from: { path: `^${R}/[^/]+/lib/` },
      to: {
        circular: true,
        dependencyTypesNot: ["type-only", "dynamic-import"],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: `node_modules|${PACKAGE_ENTRY}`,
    },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
