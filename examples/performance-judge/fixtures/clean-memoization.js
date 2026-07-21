const cache = new Map();

export function expensive(n) {
  let sum = 0;
  for (let i = 0; i < n * 1000; i++) sum += i;
  return sum;
}

export function handler(n) {
  if (cache.has(n)) return cache.get(n);
  const v = expensive(n);
  cache.set(n, v);
  return v;
}
