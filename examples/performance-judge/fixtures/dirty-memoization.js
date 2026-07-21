export function expensive(n) {
  let sum = 0;
  for (let i = 0; i < n * 1000; i++) sum += i;
  return sum;
}

export function handler(n) {
  return expensive(n);
}
