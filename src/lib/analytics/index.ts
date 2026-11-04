/**
 * Analytics domain public surface. Depends only on the domain types and the
 * standard library: no database, no UI, no AI provider.
 */
export * from "./types";
export * from "./time";
export * from "./stats";
export * from "./filters";
export { buildHistories, stateAt, type CompletionSample, type TaskHistory, type StateAt } from "./timeline";
export { buildAnalyticsReport } from "./report";
export { METRIC_DEFINITIONS, GLOBAL_LIMITATIONS, type MetricDefinition } from "./definitions";
