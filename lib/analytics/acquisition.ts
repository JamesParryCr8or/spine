type AcquisitionInput = {
  netSales: number;
  newCustomerSales: number;
  marketingSpend: number;
  newCustomers: number;
};

export function calculateAcquisitionMetrics(input: AcquisitionInput) {
  const marketingSpend = Number.isFinite(input.marketingSpend) ? Math.max(input.marketingSpend, 0) : 0;
  const newCustomers = Number.isFinite(input.newCustomers) ? Math.max(input.newCustomers, 0) : 0;
  const netSales = Number.isFinite(input.netSales) ? Math.max(input.netSales, 0) : 0;
  const newCustomerSales = Number.isFinite(input.newCustomerSales) ? Math.max(input.newCustomerSales, 0) : 0;
  return {
    blendedCac: marketingSpend > 0 && newCustomers > 0 ? marketingSpend / newCustomers : null,
    blendedMer: marketingSpend > 0 ? netSales / marketingSpend : null,
    newCustomerRoas: marketingSpend > 0 ? newCustomerSales / marketingSpend : null,
  };
}
