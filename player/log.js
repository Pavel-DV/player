import { getPlayerDom } from './dom.js';

const dom = getPlayerDom();
let logStartTime;

function formatLogTime() {
  return ((performance.now() - logStartTime) / 1000).toFixed(3);
}

export function summarizeError(error) {
  if (!error) {
    return null;
  }

  return {
    code: error.code ?? null,
    message: error.message ?? String(error),
    name: error.name ?? 'Error',
  };
}

export function bindDeveloperLog() {
  dom.clearDeveloperLogBtn.onclick = () => {
    dom.developerLogEl.value = '';
  };

  dom.developerLoggingToggleEl.onchange = () => {
    if (dom.developerLoggingToggleEl.checked) {
      logStartTime = performance.now();
      log(`Log started: ${new Date().toLocaleString()}`);
    } else {
      log(`Log stopped: ${new Date().toLocaleString()}`);
    }
  };
}

export function log(event, details = {}) {
  if (!dom.developerLoggingToggleEl.checked) {
    return;
  }

  const message = Object.keys(details).length > 0
    ? `${event} ${JSON.stringify(details)}`
    : event;

  console.log(message);
  const line = `[${formatLogTime()}] ${message}`;
  dom.developerLogEl.value += dom.developerLogEl.value ? `\n\n${line}` : line;
  dom.developerLogEl.scrollTop = dom.developerLogEl.scrollHeight;
}
