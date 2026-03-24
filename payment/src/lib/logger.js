function normalizeError(error) {
  if (!error) {
    return {};
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'object') {
    return {
      error: JSON.stringify(error),
    };
  }

  return {
    error: String(error),
  };
}

function extractSourceFromStack(stack) {
  if (!stack) {
    return null;
  }

  const lines = String(stack).split('\n').slice(1);
  for (const line of lines) {
    if (line.includes('node_modules') || line.includes('/lib/logger.js')) {
      continue;
    }

    const withFunctionMatch = line.match(/at\s+(.*?)\s+\((.*):(\d+):(\d+)\)/);
    if (withFunctionMatch && withFunctionMatch[2].includes('/src/')) {
      return {
        file: withFunctionMatch[2],
        function: withFunctionMatch[1],
        line: Number(withFunctionMatch[3]),
      };
    }

    const withoutFunctionMatch = line.match(/at\s+(.*):(\d+):(\d+)/);
    if (withoutFunctionMatch && withoutFunctionMatch[1].includes('/src/')) {
      return {
        file: withoutFunctionMatch[1],
        function: null,
        line: Number(withoutFunctionMatch[2]),
      };
    }
  }

  return null;
}

function createLogger(service) {
  function write(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      event: meta.event || 'application_log',
      message,
      category: meta.category ?? null,
      reason: meta.reason ?? null,
      statusCode: meta.statusCode ?? null,
      context: meta.context || {},
    };

    const errorFields = normalizeError(meta.error);
    if (errorFields.error) {
      entry.error = errorFields.error;
    }
    if (errorFields.stack) {
      entry.stack = errorFields.stack;
      if (level === 'error') {
        const source = extractSourceFromStack(errorFields.stack);
        if (source) {
          entry.source = source;
        }
      }
    }

    const method =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    method(JSON.stringify(entry));
  }

  return {
    info(message, meta) {
      write('info', message, meta);
    },
    warn(message, meta) {
      write('warn', message, meta);
    },
    error(message, meta) {
      write('error', message, meta);
    },
  };
}

module.exports = { createLogger };
