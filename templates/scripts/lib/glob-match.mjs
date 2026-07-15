export function normalizePath(p) {
  return p.replace(/\\/g, "/");
}

export function matchGlob(pattern, filePath) {
  const normalized = normalizePath(filePath);
  const g = normalizePath(pattern);
  if (g.startsWith("**/")) {
    const suffix = g.slice(3);
    return normalized.endsWith(suffix) || normalized.includes(`/${suffix}`);
  }
  const re = new RegExp(
    `^${normalizePath(pattern)
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*")}$`,
  );
  return re.test(normalized);
}

export function pathMatchesAllowed(filePath, allowedPaths) {
  return allowedPaths.some((pattern) => matchGlob(pattern, filePath));
}
