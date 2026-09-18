import type { ReportDatePreset, ReportType } from "./schema";

export type StarterReportTemplate = {
  name: string;
  description: string;
  reportType: ReportType;
  datePreset: ReportDatePreset;
};

export const starterReports: StarterReportTemplate[] = [
  {
    name: "Income statement",
    description: "Review sales, product costs, operating costs, and profit.",
    reportType: "pnl",
    datePreset: "latest_30_days",
  },
  {
    name: "Daily channel spend",
    description: "Compare campaign spend with Shopify sales and contribution profit.",
    reportType: "utm",
    datePreset: "latest_30_days",
  },
  {
    name: "Product profitability",
    description: "Find products with missing costs or low margins.",
    reportType: "products",
    datePreset: "latest_30_days",
  },
  {
    name: "New customer acquisition",
    description: "Track new-customer sales, order value, and acquisition efficiency.",
    reportType: "customers",
    datePreset: "latest_90_days",
  },
];
