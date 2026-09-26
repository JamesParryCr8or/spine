export const revenueHeaders = ["external_id", "date", "type", "label", "amount", "currency", "opportunity_id"];
export const costLabels = ["Cash sale", "Bank transfer", "Refund", "Staff", "Rent", "Software", "Travel", "Equipment", "Other"];
export type RevenueEntry = { entry_key: string; external_id: string; entry_date: string; kind: "sale" | "refund" | "cost"; label: string; amount_minor: number; currency: string; opportunity_id: string | null };
export function currencyDecimals(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) throw new Error("Use a valid three-letter currency code");
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function moneyMinor(value: string, currency: string) {
  const decimals = currencyDecimals(currency);
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Amount must be a positive number without currency symbols or separators");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Too many decimal places for ${currency}`);
  const amount = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(amount) || amount > 9_000_000_000_000) throw new Error("Amount is too large");
  return amount;
}
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}
export function parseRevenueCsv(text: string) {
  if (text.length > 2_000_000) throw new Error("CSV exceeds 2 MB");
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i=0;i<input.length;i++) {
    const c=input[i];
    if(c==='"') {
      if(quoted && input[i+1]==='"') {cell+='"';i++;}
      else if(quoted) {quoted=false;closed=true;}
      else if(cell || closed) throw new Error("CSV has a quote inside an unquoted field");
      else quoted=true;
    }
    else if(c===','&&!quoted) {row.push(cell);cell="";closed=false;}
    else if((c==='\n'||c==='\r')&&!quoted) { if(c==='\r'&&input[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim())) rows.push(row);row=[];cell="";closed=false; }
    else { if(closed)throw new Error("Unexpected characters after a quoted CSV field");cell+=c; }
  }
  if(quoted)throw new Error("CSV has an unclosed quoted field");
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  return rows;
}
export function validateRevenueRows(rows: unknown[][]): RevenueEntry[] {
  if (!rows.length || rows.length>5001) throw new Error("Use a header and no more than 5,000 rows");
  const headers=rows[0].map(v=>String(v).trim().toLowerCase());
  if(new Set(headers).size!==headers.length || revenueHeaders.some(h=>!headers.includes(h)))throw new Error(`Required columns: ${revenueHeaders.join(", ")}`);
  const ids=new Set<string>();
  return rows.slice(1).filter(r=>r.some(v=>String(v??"").trim())).map((r,index)=>{
    const v=(key:string)=>String(r[headers.indexOf(key)]??"").trim();
    try {
      const id=v("external_id"), kind=v("type").toLowerCase(), label=v("label"), date=v("date"), currency=v("currency").toUpperCase();
      if(!/^[\w.-]{1,120}$/.test(id)||id.startsWith("ch_")||id.startsWith("re_"))throw new Error("Use a stable external ID for this external sale/cost, not a Stripe payment ID");
      if(ids.has(id))throw new Error(`Duplicate external ID ${id}`);ids.add(id);
      if(!validDate(date))throw new Error("Date must be a valid YYYY-MM-DD value");
      if(kind!=="sale"&&kind!=="refund"&&kind!=="cost")throw new Error("Type must be sale, refund or cost");
      if(!label||label.length>80)throw new Error("Label must contain 1–80 characters");
      if(v("opportunity_id").length>120)throw new Error("Opportunity ID is too long");
      return {entry_key:`manual:${id}`,external_id:id,entry_date:date,kind,label,amount_minor:moneyMinor(v("amount"),currency),currency,opportunity_id:v("opportunity_id")||null};
    }catch(error){throw new Error(`Row ${index+2}: ${error instanceof Error?error.message:"Invalid row"}`);}
  });
}
export function revenueSummary(entries: Array<RevenueEntry & { source?: string }>, currency: string) {
  let sales=0,refunds=0,costs=0,excluded=0;const labels:Record<string,number>=Object.create(null);const sources:Record<string,number>=Object.create(null);
  for(const e of entries){if(e.currency!==currency){excluded++;continue;}const amount=Number(e.amount_minor);
    if(e.kind==="sale")sales+=amount;else if(e.kind==="refund")refunds+=amount;else costs+=amount;
    if(e.kind==="cost")labels[e.label]=(labels[e.label]??0)+amount;
    else sources[e.source??"external"]=(sources[e.source??"external"]??0)+(e.kind==="refund"?-amount:amount);
  }
  if (![sales,refunds,costs,sales-refunds-costs,...Object.values(labels),...Object.values(sources)].every(Number.isSafeInteger)) throw new Error("Revenue total exceeds the supported range; select a shorter period");
  const divisor=10**currencyDecimals(currency);
  return {sales:sales/divisor,refunds:refunds/divisor,costs:costs/divisor,netRevenue:(sales-refunds)/divisor,netAfterCosts:(sales-refunds-costs)/divisor,excluded,labels:Object.entries(labels).map(([label,value])=>({label,value:value/divisor})),sources:Object.entries(sources).map(([label,value])=>({label,value:value/divisor}))};
}
