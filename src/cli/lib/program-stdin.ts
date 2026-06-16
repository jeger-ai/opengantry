/** Shared stdin drain for Commander commands that accept piped intent text. */
export function readStdinIfEmpty(text: string): Promise<string> {
  if (text.trim()) return Promise.resolve(text);
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}
