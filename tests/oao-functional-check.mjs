/**
 * Compatibility entry point for the OAO canvas acceptance check.
 * The canvas no longer uses the retired React Flow DOM contract; keep one
 * stable command for local runners while the focused smoke test owns the
 * current canvas selectors and behavior.
 */
await import("./canvas-oao-smoke.mjs");
