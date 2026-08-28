export function computeDataCompleteness(input = {}) {
  const runs = Array.isArray(input.runs) ? input.runs : [];
  const feedbackComplete = runs.filter((run) => run.feedbackComplete && run.meaningfulRpe).length;
  const tcxRequired = runs.filter((run) => run.tcxRequired);
  const tcxComplete = tcxRequired.filter((run) => run.tcxComplete).length;
  const calibrationDays = String(input.calibrationDays || '0/28');
  return {
    calibration: {
      state: input.dailyState === 'ready' ? 'ready' : 'calibrating',
      progress: input.dailyState === 'ready' ? 'GOTOWE' : calibrationDays,
    },
    feedback: {
      complete: feedbackComplete,
      total: runs.length,
      missing: Math.max(0, runs.length - feedbackComplete),
    },
    tcx: {
      complete: tcxComplete,
      total: tcxRequired.length,
      missing: Math.max(0, tcxRequired.length - tcxComplete),
    },
    source: input.sourceOk === true ? 'complete' : 'attention',
  };
}
