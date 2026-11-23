/** Model IDs are emitted into prose bindings and Markdown table cells. */
export function isModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u.test(value)
  );
}
