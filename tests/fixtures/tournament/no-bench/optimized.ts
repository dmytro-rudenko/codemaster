export function sumList(values: number[]): number {
  let total = 0;
  for (let index = 0; index < values.length; index++) total += values[index];
  return total;
}
