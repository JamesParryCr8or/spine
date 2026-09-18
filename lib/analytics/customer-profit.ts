export function calculateProfitPerNewCustomer(netProfit: number | null, newCustomerOrders: number) {
  if (netProfit === null || !Number.isFinite(netProfit) || !Number.isInteger(newCustomerOrders) || newCustomerOrders <= 0) return null;
  return netProfit / newCustomerOrders;
}
