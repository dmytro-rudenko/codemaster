export function walkOrders(orders: number[]) {
  let total = 0;
  if (orders.length > 0) {
    while (total < 10) {
      for (const order of orders) {
        if (order > 1) {
          total += order;
        }
      }
      total += 1;
    }
  }
  return total;
}
