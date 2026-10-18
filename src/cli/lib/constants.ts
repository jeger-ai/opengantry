// Facade (ADR-0052 step 2): the constants live in packages/core; the version is generated here.
export * from "#core/constants.js";
export { CLI_VERSION, NPM_PACKAGE_NAME } from "./version.gen.js";
