import type { ZodError } from "zod";

/** `/a/b/0: message; /c: message` (root issues as `(root)`), the shape the Ajv-era validators printed. */
export function formatSchemaIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.length === 0 ? "(root)" : `/${issue.path.map(String).join("/")}`;
      return `${at}: ${issue.message}`;
    })
    .join("; ");
}
