export function countLabel(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100,
    b = a % 10;
  return `${n} ${a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many}`;
}
