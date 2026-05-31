export interface McpErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export function mcpError(
  code: string,
  message: string,
  retryable: boolean,
): { status: "error"; error: McpErrorBody } {
  return { status: "error", error: { code, message, retryable } };
}
