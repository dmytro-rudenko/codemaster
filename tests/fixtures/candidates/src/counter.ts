export class Counter {
  value = 0;
  bump(values: number[]) {
    for (const value of values) {
      if (value > 10 && value < 100) {
        this.value += 2;
      } else if (value > 0 || value === -1) {
        this.value += 1;
      }
    }
    return this.value;
  }
}
