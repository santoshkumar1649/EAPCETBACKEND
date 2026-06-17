/**
 * In-memory progress tracker for the bulk "fetch results" job.
 * Single-process, no DB/queue — matches the app's existing stateless style
 * (see keepAliveService.js for the same closure-state pattern).
 */
let state = {
  status: "idle", // idle | running | completed | failed
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  currentStudent: null,
  percentage: 0,
  startedAt: null,
  finishedAt: null,
  lastError: null,
};

export const resetProgress = (total) => {
  state = {
    status: "running",
    total,
    processed: 0,
    success: 0,
    failed: 0,
    currentStudent: null,
    percentage: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
  };
};

export const updateProgress = (partial) => {
  state = { ...state, ...partial };
  state.percentage = state.total > 0 ? Math.round((state.processed / state.total) * 100) : 0;
};

export const getProgress = () => ({ ...state });

export const isRunning = () => state.status === "running";

export default { resetProgress, updateProgress, getProgress, isRunning };
