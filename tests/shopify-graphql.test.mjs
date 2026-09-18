import assert from 'node:assert/strict';
import test from 'node:test';
import { shopifyGraph } from '../lib/shopify/graphql.ts';
import { costKey, monetary, resolveEffectiveCost } from '../lib/analytics/effective-cost.ts';
import { actualTransactionFees, estimatedTransactionFee, selectEffectivePaymentFeeRule } from '../lib/analytics/transaction-fees.ts';
import { allocatePeriodCost, operatingCostBucket } from '../lib/analytics/cost-allocation.ts';
import { selectEffectiveShippingCost, summarizeShippingCoverage } from '../lib/analytics/shipping-cost.ts';
import { calculateAcquisitionMetrics } from '../lib/analytics/acquisition.ts';
import { proportionalAllocations } from '../lib/analytics/proportional-allocation.ts';
import { allocateOrderRefund } from '../lib/analytics/refund-allocation.ts';
import { calculateProductProfit } from '../lib/analytics/product-profit.ts';
import { classifyCustomerOrders } from '../lib/analytics/customer-classification.ts';
import { reportingDateKey, reportingMonthKey, reportingRangeToUtc } from '../lib/analytics/reporting-range.ts';
import { convertCurrency, sumSingleCurrency } from '../lib/analytics/money.ts';
import { calculateProfitAndLoss } from '../lib/analytics/profit-and-loss.ts';
import { normalizeAttribution, normalizeUtmSource } from '../lib/analytics/utm-attribution.ts';
import { shopifySyncWindow, shopifyUpdatedAtQuery } from '../lib/shopify/sync-window.ts';
import { reportingPeriods } from '../lib/analytics/reporting-periods.ts';
import goldenStore from './fixtures/golden-store-pnl.json' with { type: 'json' };

const success = () => Response.json({ data: { orders: ['order-1'] } });
const throttle = () => Response.json({ errors: [{ extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 25 } } } });
function harness(responses) {
  const calls = [], waits = [];
  return {
    calls, waits,
    dependencies: {
      fetch: async (...args) => {
        calls.push(args);
        const result = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (result instanceof Error) throw result;
        return result();
      },
      sleep: async (ms) => { waits.push(ms); },
      random: () => 0,
      now: () => Date.parse('2026-09-17T12:00:00Z'),
    },
  };
}
const run = (h) => shopifyGraph('example.myshopify.com', 'secret-token', 'query { orders { id } }', { cursor: 'page-2' }, h.dependencies);

test('successful query preserves cursor and disables caching', async () => {
  const h = harness([success]);
  assert.deepEqual(await run(h), { orders: ['order-1'] });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
  assert.equal(h.calls[0][1].cache, 'no-store');
  assert.equal(JSON.parse(h.calls[0][1].body).variables.cursor, 'page-2');
});
test('HTTP 200 throttling waits for query cost to recover and retries the same page', async () => {
  const h = harness([throttle, success]);
  await run(h);
  assert.deepEqual(h.waits, [4000]);
  assert.equal(h.calls[0][1].body, h.calls[1][1].body);
});
for (const header of ['5', 'Thu, 17 Sep 2026 12:00:05 GMT']) {
  test(`honors Retry-After ${header}`, async () => {
    const h = harness([() => new Response('', { status: 429, headers: { 'Retry-After': header } }), success]);
    await run(h);
    assert.deepEqual(h.waits, [5000]);
  });
}
test('recovers from network, server and GraphQL internal errors', async () => {
  const h = harness([new Error('secret-token'), () => new Response('bad gateway', { status: 502 }), () => Response.json({ errors: [{ extensions: { code: 'INTERNAL_SERVER_ERROR' } }] }), success]);
  await run(h);
  assert.deepEqual(h.waits, [1000, 2000, 4000]);
});
test('persistent throttling stops after four attempts', async () => {
  const h = harness([throttle]);
  await assert.rejects(run(h), /limiting import requests/);
  assert.equal(h.calls.length, 4);
  assert.equal(h.waits.length, 3);
});
for (const status of [401, 403]) {
  test(`does not retry credentials or permissions (${status})`, async () => {
    const h = harness([() => Response.json({ errors: [{ message: 'secret-token' }] }, { status })]);
    await assert.rejects(run(h), /Shopify denied access/);
    assert.equal(h.calls.length, 1);
  });
}
test('permanent GraphQL errors reject partial data without retrying', async () => {
  const h = harness([() => Response.json({ data: { orders: [] }, errors: [{ message: 'secret-token', extensions: { code: 'ACCESS_DENIED' } }] })]);
  await assert.rejects(run(h), /Check the app scopes/);
  assert.equal(h.calls.length, 1);
});
test('long Retry-After stops without retrying too early', async () => {
  const h = harness([() => new Response('', { status: 429, headers: { 'Retry-After': '120' } })]);
  await assert.rejects(run(h), /limiting import requests/);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
});
test('exhausted network failures do not expose raw errors', async () => {
  const h = harness([new Error('secret-token')]);
  await assert.rejects(run(h), { message: 'Shopify is temporarily unavailable. Please try the import again shortly.' });
  assert.equal(h.calls.length, 4);
});
test('missing data fails without importing an empty result', async () => {
  const h = harness([() => Response.json(null)]);
  await assert.rejects(run(h), /could not complete/);
  assert.equal(h.calls.length, 1);
});

test('effective-dated costs use the latest applicable record and manual overrides', () => {
  const costs = [
    { variant_id: 'variant-1', sku: 'SKU-1', amount: '4.00', effective_from: '2026-01-01', effective_to: null, source: 'shopify' },
    { variant_id: 'variant-1', sku: 'SKU-1', amount: '4.50', effective_from: '2026-02-01', effective_to: null, source: 'csv' },
    { variant_id: 'variant-1', sku: 'SKU-1', amount: '5.00', effective_from: '2026-02-01', effective_to: null, source: 'manual' },
  ];
  assert.equal(resolveEffectiveCost(costs, '2026-01-31', null), 4);
  assert.equal(resolveEffectiveCost(costs, '2026-02-01', null), 5);
});

test('effective-dated costs respect end dates and retain the Shopify fallback', () => {
  const costs = [{ variant_id: null, sku: 'SKU-1', amount: '7.25', effective_from: '2026-01-01', effective_to: '2026-01-31', source: 'manual' }];
  assert.equal(resolveEffectiveCost(costs, '2026-01-31', 3.5), 7.25);
  assert.equal(resolveEffectiveCost(costs, '2026-02-01', 3.5), 3.5);
  assert.equal(resolveEffectiveCost([], '2026-02-01', null), null);
});

test('cost lookup keys normalize SKU values and monetary values reject invalid input', () => {
  assert.equal(costKey({ variant_id: 'variant-1', sku: ' SKU-1 ' }), 'variant:variant-1');
  assert.equal(costKey({ variant_id: null, sku: ' SKU-1 ' }), 'sku:sku-1');
  assert.equal(costKey({ variant_id: null, sku: null }), null);
  assert.equal(monetary('12.50'), 12.5);
  assert.equal(monetary('not-a-number'), 0);
});

test('actual transaction fees include fee tax for successful matching-currency payments only', () => {
  assert.equal(actualTransactionFees([
    { status: 'SUCCESS', currency: 'GBP', fee_amount: '2.50', fee_tax: '0.50' },
    { status: 'SUCCESS', currency: 'USD', fee_amount: '10', fee_tax: '2' },
    { status: 'FAILURE', currency: 'GBP', fee_amount: '7', fee_tax: '1' },
  ], 'GBP'), 3);
});

test('payment fee rules support percentage, fixed charge, tax, and minimum fee', () => {
  assert.equal(estimatedTransactionFee(100, { percentageRate: 2, fixedFee: 0.3, taxRate: 20, minimumFee: 0 }), 2.76);
  assert.equal(estimatedTransactionFee(5, { percentageRate: 1, fixedFee: 0, taxRate: 20, minimumFee: 0.5 }), 0.6);
  assert.equal(estimatedTransactionFee(0, { percentageRate: 2, fixedFee: 0.3, taxRate: 20, minimumFee: 0 }), 0);
});

test('gateway mapping selects the latest effective matching-currency fee rule', () => {
  const rules = [
    { gateway: 'shopify_payments', currency: 'GBP', effectiveFrom: '2026-01-01', effectiveTo: null, percentageRate: 2, fixedFee: 0.3, taxRate: 20, minimumFee: 0 },
    { gateway: 'Shopify_Payments', currency: 'GBP', effectiveFrom: '2026-06-01', effectiveTo: null, percentageRate: 1.8, fixedFee: 0.3, taxRate: 20, minimumFee: 0 },
  ];
  assert.equal(selectEffectivePaymentFeeRule(rules, 'SHOPIFY_PAYMENTS', 'GBP', '2026-09-18T12:00:00Z')?.percentageRate, 1.8);
  assert.equal(selectEffectivePaymentFeeRule(rules, 'shopify_payments', 'USD', '2026-09-18T12:00:00Z'), null);
});

test('shipping allocation supports flat-per-order and multi-item per-unit rules', () => {
  const shared = { cadence: 'monthly', activeDays: 30, revenue: 500, oneOffInRange: true };
  assert.equal(allocatePeriodCost({ ...shared, amount: 4.5, basis: 'orders', orderCount: 3, unitCount: 7 }), 13.5);
  assert.equal(allocatePeriodCost({ ...shared, amount: 1.25, basis: 'units', orderCount: 3, unitCount: 7 }), 8.75);
});

test('direct cost categories keep shipping, handling, and pick/pack out of operating expenses', () => {
  assert.equal(operatingCostBucket('fulfilment'), 'shipping');
  assert.equal(operatingCostBucket('handling'), 'handling');
  assert.equal(operatingCostBucket('pick_pack'), 'handling');
  assert.equal(operatingCostBucket('software'), 'operating');
});

test('variant shipping overrides use the latest rule active on the order date', () => {
  const rules = [
    { id: 'old', variant_id: 'variant-1', sku: 'SKU-1', amount: '3.00', allocation_basis: 'units', effective_from: '2026-01-01', effective_to: null },
    { id: 'new', variant_id: 'variant-1', sku: 'SKU-1', amount: '4.50', allocation_basis: 'units', effective_from: '2026-06-01', effective_to: null },
  ];
  assert.equal(selectEffectiveShippingCost(rules, '2026-05-31')?.id, 'old');
  assert.equal(selectEffectiveShippingCost(rules, '2026-09-18')?.id, 'new');
});

test('shipping coverage reports override, fallback, and missing usage', () => {
  assert.deepEqual(summarizeShippingCoverage(['override', 'fallback', 'fallback', 'missing']), {
    overrideLines: 1,
    fallbackLines: 2,
    missingLines: 1,
    fallbackRate: 2 / 3,
  });
});

test('blended acquisition metrics use spend, first-observed customers, and their sales', () => {
  assert.deepEqual(calculateAcquisitionMetrics({ netSales: 10000, newCustomerSales: 6000, marketingSpend: 1000, newCustomers: 20 }), {
    blendedCac: 50,
    blendedMer: 10,
    newCustomerRoas: 6,
  });
  assert.deepEqual(calculateAcquisitionMetrics({ netSales: 10000, newCustomerSales: 6000, marketingSpend: 0, newCustomers: 20 }), {
    blendedCac: null,
    blendedMer: null,
    newCustomerRoas: null,
  });
});

test('product-level shared costs allocate proportionally and preserve the total', () => {
  const allocations = proportionalAllocations(120, new Map([['a', 300], ['b', 100]]));
  assert.equal(allocations.get('a'), 90);
  assert.equal(allocations.get('b'), 30);
  assert.equal([...allocations.values()].reduce((sum, value) => sum + value, 0), 120);
});

test('partial order refunds preserve explicit line refunds and allocate the residual', () => {
  const allocations = allocateOrderRefund(60, [
    { key: 'line-a', netSales: 100, explicitRefund: 20 },
    { key: 'line-b', netSales: 100, explicitRefund: 0 },
  ]);
  assert.equal(allocations.get('line-a'), 20 + 40 * 80 / 180);
  assert.equal(allocations.get('line-b'), 40 * 100 / 180);
  assert.equal([...allocations.values()].reduce((sum, value) => sum + value, 0), 60);
});

test('line-level refunds are not double counted when they already equal the order refund', () => {
  const allocations = allocateOrderRefund(35, [
    { key: 'line-a', netSales: 100, explicitRefund: 35 },
    { key: 'line-b', netSales: 50, explicitRefund: 0 },
  ]);
  assert.equal(allocations.get('line-a'), 35);
  assert.equal(allocations.get('line-b'), 0);
});

test('product profit bridges gross sales through discounts and partial refunds', () => {
  assert.deepEqual(calculateProductProfit({ grossSales: 100, discounts: 10, refunds: 15, cogs: 30, shippingCosts: 5, handlingCosts: 2, transactionFees: 3, marketingAllocation: 10, costCoverageComplete: true }), {
    netRevenue: 75,
    grossProfit: 45,
    grossMargin: 0.6,
    contributionProfit: 25,
    contributionMargin: 1 / 3,
  });
});

test('monthly fixed costs are prorated across partial reporting periods', () => {
  const allocated = allocatePeriodCost({ amount: 304.375, cadence: 'monthly', basis: 'fixed', activeDays: 10, orderCount: 0, unitCount: 0, revenue: 0, oneOffInRange: false });
  assert.equal(allocated, 100);
});

test('new and repeat customers are based on their first valid order, with guests kept separate', () => {
  const classes = classifyCustomerOrders([
    { id: 'second', customerId: 'customer-1', processedAt: '2026-02-01T10:00:00Z' },
    { id: 'guest', customerId: null, processedAt: '2026-01-10T10:00:00Z' },
    { id: 'first', customerId: 'customer-1', processedAt: '2026-01-01T10:00:00Z' },
    { id: 'other', customerId: 'customer-2', processedAt: '2026-01-05T10:00:00Z' },
  ]);
  assert.deepEqual(Object.fromEntries(classes), { first: 'new', other: 'new', guest: 'guest', second: 'repeat' });
});

test('store-local reporting dates honor daylight-saving boundaries', () => {
  const spring = reportingRangeToUtc('2026-03-29', '2026-03-29', 'Europe/London');
  const autumn = reportingRangeToUtc('2026-10-25', '2026-10-25', 'Europe/London');
  assert.deepEqual(spring, { start: '2026-03-29T00:00:00.000Z', endExclusive: '2026-03-29T23:00:00.000Z' });
  assert.deepEqual(autumn, { start: '2026-10-24T23:00:00.000Z', endExclusive: '2026-10-26T00:00:00.000Z' });
});

test('reporting date and month keys use the store timezone at UTC boundaries', () => {
  assert.equal(reportingDateKey('2026-01-01T00:30:00.000Z', 'America/Los_Angeles'), '2025-12-31');
  assert.equal(reportingMonthKey('2026-01-01T00:30:00.000Z', 'America/Los_Angeles'), '2025-12');
  assert.equal(reportingDateKey('2025-12-31T16:00:00.000Z', 'Asia/Tokyo'), '2026-01-01');
});


test('currency conversion rounds once in the target currency and rejects mixed totals', () => {
  assert.equal(convertCurrency(10.005, 1, 'GBP'), 10.01);
  assert.equal(convertCurrency(100, 0.00675, 'JPY'), 1);
  assert.equal(sumSingleCurrency([{ amount: 10.004, currency: 'GBP' }, { amount: 2.006, currency: 'gbp' }], 'GBP'), 12.01);
  assert.throws(() => sumSingleCurrency([{ amount: 10, currency: 'USD' }], 'GBP'), /conversion is required/);
});

test('golden store fixture produces the manually reconciled P&L', () => {
  const actual = calculateProfitAndLoss(goldenStore.input);
  for (const [key, expected] of Object.entries(goldenStore.expected)) assert.equal(actual[key], expected, key);
});

test('UTM normalization handles aliases, case, whitespace, and missing values', () => {
  assert.equal(normalizeUtmSource('  FB  '), 'facebook');
  assert.deepEqual(normalizeAttribution({ source: null, utmSource: ' GOOGLE ', utmMedium: ' Organic ', utmCampaign: ' Brand  Search ', utmContent: null, utmTerm: null, referrerUrl: 'https://google.com/' }), {
    channel: 'Organic', source: 'google', medium: 'organic', campaign: 'brand search', content: '—', term: '—',
  });
});

test('missing attribution is grouped as direct, referral, or unknown without inventing UTM values', () => {
  assert.equal(normalizeAttribution(null).channel, 'Unknown');
  assert.equal(normalizeAttribution({ source: null, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrerUrl: null }).channel, 'Direct');
  const referral = normalizeAttribution({ source: null, utmSource: null, utmMedium: null, utmCampaign: null, utmContent: null, utmTerm: null, referrerUrl: 'https://Example.com/article' });
  assert.equal(referral.channel, 'Referral');
  assert.equal(referral.source, 'example.com');
});

test('Shopify incremental sync overlaps the last completion and fixes its upper boundary', () => {
  const window = shopifySyncWindow({ existingRun: null, latestCompletedAt: '2026-09-18T12:00:00.000Z', now: new Date('2026-09-20T12:00:00.000Z') });
  assert.deepEqual(window, { mode: 'incremental', start: '2026-09-11T12:00:00.000Z', end: '2026-09-20T12:00:00.000Z' });
  assert.equal(shopifyUpdatedAtQuery(window.start, window.end), 'updated_at:>=2026-09-11T12:00:00.000Z updated_at:<2026-09-20T12:00:00.000Z');
});

test('resumed Shopify sync preserves its original window', () => {
  const window = shopifySyncWindow({ existingRun: { sync_mode: 'incremental', window_start: '2026-09-01T00:00:00.000Z', window_end: '2026-09-08T00:00:00.000Z' }, latestCompletedAt: '2026-09-17T00:00:00.000Z', now: new Date('2026-09-20T00:00:00.000Z') });
  assert.deepEqual(window, { mode: 'incremental', start: '2026-09-01T00:00:00.000Z', end: '2026-09-08T00:00:00.000Z' });
});


test('reporting periods split inclusive ranges across calendar boundaries', () => {
  assert.deepEqual(reportingPeriods('2026-01-30', '2026-03-02', 'monthly'), [
    { start: '2026-01-30', end: '2026-01-31', label: 'Jan 2026' },
    { start: '2026-02-01', end: '2026-02-28', label: 'Feb 2026' },
    { start: '2026-03-01', end: '2026-03-02', label: 'Mar 2026' },
  ]);
  assert.deepEqual(reportingPeriods('2026-12-30', '2027-01-02', 'annual'), [
    { start: '2026-12-30', end: '2026-12-31', label: '2026' },
    { start: '2027-01-01', end: '2027-01-02', label: '2027' },
  ]);
});

test('reporting periods cap wide daily ranges to the latest visible columns', () => {
  const periods = reportingPeriods('2026-01-01', '2026-02-01', 'daily', 3);
  assert.deepEqual(periods.map((period) => period.start), ['2026-01-30', '2026-01-31', '2026-02-01']);
});
