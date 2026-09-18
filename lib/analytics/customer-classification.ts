export type CustomerOrder = {
  id: string;
  customerId: string | null;
  processedAt: string | null;
};

export type CustomerOrderClass = "new" | "repeat" | "guest";

/** Classifies the first valid order for each identified customer as new. */
export function classifyCustomerOrders(orders: CustomerOrder[]) {
  const result = new Map<string, CustomerOrderClass>();
  const seenCustomers = new Set<string>();
  const sorted = [...orders].sort((left, right) => {
    const dateOrder = (left.processedAt ?? "").localeCompare(right.processedAt ?? "");
    return dateOrder || left.id.localeCompare(right.id);
  });

  for (const order of sorted) {
    if (!order.customerId) {
      result.set(order.id, "guest");
      continue;
    }
    const classification = seenCustomers.has(order.customerId) ? "repeat" : "new";
    result.set(order.id, classification);
    seenCustomers.add(order.customerId);
  }
  return result;
}
