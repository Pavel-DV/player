const logEntries = [];
const MAX_LOG_ENTRIES = 300;
const listeners = new Set();
const originalConsole = {};
let installed = false;
let renderPending = false;

function formatLogValue(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    const serializedValue = JSON.stringify(value);
    return serializedValue === undefined ? String(value) : serializedValue;
  } catch {
    return String(value);
  }
}

function emitLogEntry(entry) {
  logEntries.push(entry);

  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }

  if (renderPending) {
    return;
  }

  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    listeners.forEach(listener => listener(logEntries));
  });
}

export function clearDeveloperLog() {
  logEntries.length = 0;
  listeners.forEach(listener => listener(logEntries));
}

function installConsoleLogCapture() {
  if (installed) {
    return;
  }

  installed = true;
  const loggingToggle = document.getElementById('developerLoggingToggle');

  ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
    originalConsole[level] = console[level]?.bind(console);

    console[level] = (...args) => {
      if (level === 'error' || loggingToggle.checked) {
        emitLogEntry({
          level,
          message: args.map(formatLogValue).join(' '),
          time: new Date(),
        });
      }

      if (level === 'error') {
        originalConsole[level]?.(...args);
      }
    };
  });
}

function formatLogTime(time) {
  return time.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderDeveloperLog(logEl) {
  logEl.textContent = logEntries
    .map(entry => `[${formatLogTime(entry.time)}] ${entry.level}: ${entry.message}`)
    .join('\n');

  if (logEl.parentElement) {
    logEl.parentElement.scrollTop = logEl.parentElement.scrollHeight;
  }
}

export function bindDeveloperLog(logEl) {
  if (!logEl) {
    return;
  }

  renderDeveloperLog(logEl);

  const listener = () => renderDeveloperLog(logEl);
  listeners.add(listener);
}

installConsoleLogCapture();
