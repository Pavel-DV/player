const logEntries = [];
const listeners = new Set();
const originalConsole = {};
let installed = false;

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
  listeners.forEach(listener => listener(logEntries));
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

  ['log', 'info', 'warn', 'error', 'debug'].forEach(level => {
    originalConsole[level] = console[level]?.bind(console);

    console[level] = (...args) => {
      emitLogEntry({
        level,
        message: args.map(formatLogValue).join(' '),
        time: new Date(),
      });

      originalConsole[level]?.(...args);
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
