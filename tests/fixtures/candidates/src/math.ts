export function scoreValues(values: number[]) {
  let score = 0;
  for (const value of values) {
    if (value > 10 && value < 100) {
      score += 2;
    } else if (value > 0 || value === -1) {
      score += 1;
    }
  }
  return score;
}
