const LIVE_ACTION_LOG_KEY = "glowsuite_action_log:live";
const DEMO_ACTION_LOG_KEY = "glowsuite_action_log:demo";
const LIVE_AUTOPILOT_KEY = "glowsuite_autopilot:live";
const DEMO_AUTOPILOT_KEY = "glowsuite_autopilot:demo";
const LIVE_AUTOPILOT_LASTRUN_KEY = "glowsuite_autopilot_lastrun:live";
const DEMO_AUTOPILOT_LASTRUN_KEY = "glowsuite_autopilot_lastrun:demo";
const DEMO_STATE_KEY = "glowsuite_demo_state:demo";

export function actionLogKey(demoMode: boolean) {
  return demoMode ? DEMO_ACTION_LOG_KEY : LIVE_ACTION_LOG_KEY;
}

export function autopilotStateKey(demoMode: boolean) {
  return demoMode ? DEMO_AUTOPILOT_KEY : LIVE_AUTOPILOT_KEY;
}

export function autopilotLastRunKey(demoMode: boolean) {
  return demoMode ? DEMO_AUTOPILOT_LASTRUN_KEY : LIVE_AUTOPILOT_LASTRUN_KEY;
}

export function demoStateKey() {
  return DEMO_STATE_KEY;
}

export function clearLegacyDemoLocalState() {
  try {
    localStorage.removeItem("glowsuite_action_log");
    localStorage.removeItem("glowsuite_demo_state");
    localStorage.removeItem("glowsuite_autopilot");
    localStorage.removeItem("glowsuite_autopilot_lastrun");
  } catch {}
}