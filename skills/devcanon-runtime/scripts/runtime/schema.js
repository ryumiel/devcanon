export function validateRuntimeSchema(schema, input) {
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
