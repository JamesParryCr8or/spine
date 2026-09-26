import "server-only";
import { oauthConfig, readCredential, type RevenueWorkspace } from "./server";
import { costLabels, revenueHeaders } from "./schema";

export async function sheetsRequest(w: RevenueWorkspace, path: string, body?: unknown) {
  const secret = await readCredential(w, "google_sheets"), config = oauthConfig("google_sheets");
  if (!secret.refresh_token || !config.configured) throw new Error("Reconnect Google Sheets to grant offline access");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: secret.refresh_token, client_id: config.clientId!, client_secret: config.clientSecret! }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.access_token) throw new Error("Google access expired. Reconnect Google Sheets.");
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Google could not open this spreadsheet. Check the sharing permissions, spreadsheet ID and tab name.");
  return response.json();
}

export function templateBody(currency: string) {
  const text = (value: string) => ({ userEnteredValue: { stringValue: value } });
  const number = (value: number) => ({ userEnteredValue: { numberValue: value } });
  const formula = (value: string) => ({ userEnteredValue: { formulaValue: value } });
  const header = { backgroundColor: { red: .12, green: .15, blue: .25 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } };
  const rows = [
    [text("SPINE · EXTERNAL SALES & COSTS")],
    [text("Year"), { ...number(new Date().getUTCFullYear()), dataValidation: { condition: { type: "ONE_OF_LIST", values: Array.from({ length: 11 }, (_, i) => ({ userEnteredValue: String(new Date().getUTCFullYear() - 5 + i) })) }, showCustomUi: true, strict: true } }],
    [text("Month"), { ...number(new Date().getUTCMonth()+1), dataValidation: { condition: { type: "ONE_OF_LIST", values: Array.from({ length: 12 }, (_, i) => ({ userEnteredValue: String(i+1) })) }, showCustomUi: true, strict: true } }],
    [text("Currency"), text(currency)],
    [text("Period start"), { ...formula("=DATE(B2,B3,1)"), userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd mmm yyyy" } } }],
    [text("Next month"), { ...formula("=EDATE(B5,1)"), userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd mmm yyyy" } } }],
    [],
    ...["sale", "refund", "cost"].map(kind => [text(kind === "sale" ? "External sales" : kind === "refund" ? "Refunds" : "External costs"), formula(`=SUMIFS(Entries!E2:E5001,Entries!C2:C5001,"${kind}",Entries!B2:B5001,">="&B5,Entries!B2:B5001,"<"&B6,Entries!F2:F5001,B4)`)]),
    [{ ...text("Net collected less external costs"), userEnteredFormat: header }, { ...formula("=B8-B9-B10"), userEnteredFormat: { ...header, numberFormat: { type: "NUMBER", pattern: "#,##0.00;(#,##0.00);–" } } }],
    [],
    [text("Enter cash / bank sales and external costs in Entries. Stripe payments are imported separately in Spine.")],
    [text("Choose a year and month here to review the sheet. Spine imports every populated entry.")],
    [text("Use a permanent external_id per entry; reuse it to correct an entry. Deleting a row does not delete an imported entry.")],
    [text("Use positive amounts for sales, refunds and costs. Set type to control the sign. Custom labels are welcome.")],
    [text("Dates: YYYY-MM-DD. Optional opportunity_id links an entry to a GoHighLevel opportunity.")],
    [text("To undo an import, use its Roll back action in Spine. Never change an ID after importing.")],
  ].map(values => ({ values }));
  return { properties: { title: "Spine — external sales and costs", locale: "en_GB" }, sheets: [
    { properties: { sheetId: 0, title: "Summary", gridProperties: { rowCount: 30, columnCount: 8, hideGridlines: true } }, data: [{ rowData: rows, columnMetadata: [{ pixelSize: 390 }, { pixelSize: 180 }] }] },
    { properties: { sheetId: 1, title: "Entries", gridProperties: { rowCount: 5001, columnCount: 7, frozenRowCount: 1 } }, basicFilter: { range: { sheetId: 1, startRowIndex: 0, endRowIndex: 5001, startColumnIndex: 0, endColumnIndex: 7 } }, data: [{ rowData: [{ values: revenueHeaders.map(h => ({ ...text(h), userEnteredFormat: header })) }, ...Array.from({ length: 5000 }, () => ({ values: [
      { userEnteredFormat: { numberFormat: { type: "TEXT" } } },
      { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
      { dataValidation: { condition: { type: "ONE_OF_LIST", values: ["sale", "refund", "cost"].map(userEnteredValue => ({ userEnteredValue })) }, strict: true, showCustomUi: true } },
      { dataValidation: { condition: { type: "ONE_OF_LIST", values: costLabels.map(userEnteredValue => ({ userEnteredValue })) }, strict: false, showCustomUi: true } },
      { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0.00" } } },
      {}, {},
    ] }))], columnMetadata: Array.from({ length: 7 }, () => ({ pixelSize: 170 })) }] },
  ] };
}
