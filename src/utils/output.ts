import pc from "picocolors";

export type LogLevel = "quiet" | "normal" | "verbose" | "debug";

export interface Logger {
  error(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  verbose(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
  json(data: unknown): void;
}

const LEVELS: Record<LogLevel, number> = {
  quiet: 0,
  normal: 1,
  verbose: 2,
  debug: 3,
};

export function createLogger(level: LogLevel, jsonMode: boolean): Logger {
  const threshold = LEVELS[level];

  return {
    error: (msg, ...args) => {
      if (threshold >= 0) console.error(pc.red(msg), ...args);
    },
    warn: (msg, ...args) => {
      if (threshold >= 1) console.error(pc.yellow(msg), ...args);
    },
    info: (msg, ...args) => {
      if (threshold >= 1 && !jsonMode) console.log(msg, ...args);
    },
    verbose: (msg, ...args) => {
      if (threshold >= 2) console.error(pc.dim(msg), ...args);
    },
    debug: (msg, ...args) => {
      if (threshold >= 3) console.error(pc.gray(`[debug] ${msg}`), ...args);
    },
    json: (data) => {
      if (jsonMode) console.log(JSON.stringify(data, null, 2));
    },
  };
}

let _logger: Logger = createLogger("normal", false);

export function setLogger(logger: Logger): void {
  _logger = logger;
}

export function getLogger(): Logger {
  return _logger;
}
