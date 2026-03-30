import { config } from '../config/config.js';

export function applyLogFilter() {
  const suppressed = new Set(config.logging.suppressPrefixes);
  const quiet = config.logging.quiet;

  if (!quiet || suppressed.size === 0) {
    return;
  }

  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);

  const shouldSuppress = (args) => {
    if (!args || args.length === 0) return false;

    const first = String(args[0]);
    const match = first.match(/^\[([^\]]+)\]/);
    if (!match) return false;

    const prefix = match[1];
    if (suppressed.has(prefix)) return true;

    for (const entry of suppressed) {
      if (prefix.startsWith(entry)) {
        return true;
      }
    }

    return false;
  };

  console.log = (...args) => {
    if (!shouldSuppress(args)) {
      originalLog(...args);
    }
  };

  console.info = (...args) => {
    if (!shouldSuppress(args)) {
      originalInfo(...args);
    }
  };
}
