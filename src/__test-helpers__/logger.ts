import type { Logger } from "../utils/output.js";
import { getLogger, setLogger } from "../utils/output.js";

export interface TestLoggerResult {
  logger: Logger;
  errors: string[];
  warnings: string[];
  infos: string[];
  verboses: string[];
  debugs: string[];
  jsons: unknown[];
}

export function createTestLogger(): TestLoggerResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const verboses: string[] = [];
  const debugs: string[] = [];
  const jsons: unknown[] = [];

  const logger: Logger = {
    error: (msg: string) => errors.push(msg),
    warn: (msg: string) => warnings.push(msg),
    info: (msg: string) => infos.push(msg),
    verbose: (msg: string) => verboses.push(msg),
    debug: (msg: string) => debugs.push(msg),
    json: (data: unknown) => jsons.push(data),
  };

  return { logger, errors, warnings, infos, verboses, debugs, jsons };
}

export function installTestLogger(): {
  testLogger: TestLoggerResult;
  restore: () => void;
} {
  const originalLogger = getLogger();
  const testLogger = createTestLogger();
  setLogger(testLogger.logger);
  return {
    testLogger,
    restore: () => setLogger(originalLogger),
  };
}
