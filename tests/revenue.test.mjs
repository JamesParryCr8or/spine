import test from "node:test";
import assert from "node:assert/strict";
import { moneyMinor, parseRevenueCsv, validateRevenueRows, revenueSummary, validDate } from "../lib/revenue/schema.ts";
import { stripeEntries } from "../lib/revenue/stripe.ts";
import { signState, verifyState } from "../lib/revenue/oauth.ts";
const header="external_id,date,type,label,amount,currency,opportunity_id";
test("CSV parses escaped multiline fields, BOM and CRLF",()=>{
 const rows=parseRevenueCsv('\uFEFF'+header+'\r\ncash-1,2026-09-26,sale,"Cash, \"\"retail\"\"\nreceipt",12.34,GBP,op-1\r\n');
 const entries=validateRevenueRows(rows);assert.equal(entries[0].amount_minor,1234);assert.equal(entries[0].label,'Cash, "retail"\nreceipt');assert.equal(entries[0].entry_key,"manual:cash-1");
});
test("amounts respect currency minor units and reject malformed or negative inputs",()=>{
 assert.equal(moneyMinor("123.45","GBP"),12345);assert.equal(moneyMinor("123","JPY"),123);assert.equal(moneyMinor("1.234","KWD"),1234);
 for(const value of ["-1","NaN","1,000","£2","1.234","999999999999999999"])assert.throws(()=>moneyMinor(value,"GBP"));
 assert.throws(()=>moneyMinor("1","ABC"));assert.equal(validDate("2026-02-30"),false);
});
test("stable IDs, row validation and Stripe duplication guard",()=>{
 const row="cash-1,2026-09-26,sale,Cash sale,10,GBP,";
 assert.throws(()=>validateRevenueRows(parseRevenueCsv(header+'\n'+row+'\n'+row)),/Duplicate/);
 assert.throws(()=>validateRevenueRows(parseRevenueCsv(header+'\nch_123,2026-09-26,sale,Cash,1,GBP,')),/Stripe/);
 assert.throws(()=>parseRevenueCsv('"not closed'),/unclosed/);
 assert.throws(()=>validateRevenueRows(parseRevenueCsv(header+'\nx,2026-02-30,cost,Rent,10,GBP,')),/Date/);
});
test("totals separate refunds, costs and currencies and tolerate custom property-like labels",()=>{
 const entries=validateRevenueRows(parseRevenueCsv(header+'\na,2026-09-26,sale,Cash,100,GBP,\nb,2026-09-26,refund,Refund,20,GBP,\nc,2026-09-26,cost,__proto__,5,GBP,\nd,2026-09-26,sale,Other,50,USD,'));
 const result=revenueSummary(entries,"GBP");assert.equal(result.netRevenue,80);assert.equal(result.netAfterCosts,75);assert.equal(result.excluded,1);assert.deepEqual(result.labels,[{label:"__proto__",value:5}]);
});
test("Stripe maps successful captured payments and refunds on their own local dates",()=>{
 const record={id:"ch_one",created:Date.parse("2026-09-25T23:30:00Z")/1000,currency:"gbp",amount:10000,amount_captured:8000,paid:true,captured:true,status:"succeeded",livemode:true};
 const sale=stripeEntries([record,{...record,id:"ch_failed",status:"failed"},{...record,id:"ch_test",livemode:false}],"acct_1","sale","Europe/London");
 assert.equal(sale.length,1);assert.equal(sale[0].amount_minor,8000);assert.equal(sale[0].entry_date,"2026-09-26");assert.equal(sale[0].entry_key,"stripe:acct_1:ch_one");
 const refund=stripeEntries([{...record,id:"re_one",amount:2000}],"acct_1","refund","UTC");assert.equal(refund[0].amount_minor,2000);assert.equal(refund[0].kind,"refund");
 assert.equal(stripeEntries([{...record,currency:"isk",amount_captured:12000}],"acct_1","sale","UTC")[0].amount_minor,120);
});
test("OAuth state is signed, short-lived and nonce-bound",()=>{
 const state={nonce:"nonce",userId:"user",storeId:"store",organizationId:"org",expires:600000};const signed=signState(state,"secret");
 assert.deepEqual(verifyState(signed,"secret","nonce",1),state);assert.equal(verifyState(signed,"other","nonce",1),null);assert.equal(verifyState(signed,"secret","other",1),null);assert.equal(verifyState(signed,"secret","nonce",600001),null);assert.equal(verifyState(signed+"tamper","secret","nonce",1),null);
});
