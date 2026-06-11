import type { z } from "zod";

export interface RuntimeSchemaResult<T> {
  ok: true;
  value: T;
}

export interface RuntimeSchemaFailure {
  ok: false;
  issues: Array<{ path: string; message: string }>;
}

export function validateRuntimeSchema<T>(
  schema: z.ZodType<T>,
  input: unknown,
): RuntimeSchemaResult<T> | RuntimeSchemaFailure {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
