/** Programmatic entry point. The CLI is `src/cli.mjs`. */

export { main, runInit, runGuard, runPlan, resolveManifestVersions, EXIT_OK, EXIT_DRIFT, EXIT_USAGE } from './cli.mjs';
export { parseManifest, loadManifest, manifestUrl, lookupTool } from './manifest.mjs';
export {
  listManifestCommits,
  findCommitForImageVersion,
  imageVersionFromMessage,
  compareImageVersions,
  manifestAtSha,
  attribute,
  attributeChanges,
  commitWindow,
} from './history.mjs';
export { detect, analyseWorkflow, extractLabels, extractLabelSites, extractRunScripts, commandsInScript } from './detect.mjs';
export { probeTool, probeTools, isProbeable, PROBES } from './probe.mjs';
export { diffTool, diffToolMaps, shouldFail, maxSeverity, severityBetween, compareVersions } from './diff.mjs';
export { readLock, writeLock, emptyLock, toVersionMap, SCHEMA_VERSION, DEFAULT_LOCK_FILE } from './lock.mjs';
export {
  planReport,
  stepSummaryMarkdown,
  annotations,
  deadlineLines,
  daysUntil,
  retirementFindings,
  retirementAnnotations,
  retirementSummaryMarkdown,
} from './report.mjs';
export {
  LABEL_PATHS,
  DEADLINES,
  IMAGE_OS_TO_LABEL,
  knownLabels,
  deadlineFor,
  isFloating,
  nextBrownout,
  retirementStatus,
} from './labels.mjs';
export { COMMAND_ALIASES, MANIFEST_CANDIDATES, canonicalTool, knownTools } from './tools.mjs';
export { DriftError, NotFoundError } from './http.mjs';
