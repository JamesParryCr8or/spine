import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ds: {
          canvas: "var(--ds-canvas)",
          surface: "var(--ds-surface)",
          ink: "var(--ds-ink)",
          muted: "var(--ds-muted)",
          line: "var(--ds-line)",
          "line-strong": "var(--ds-line-strong)",
          accent: "var(--ds-accent)",
          "accent-strong": "var(--ds-accent-strong)",
          "accent-soft": "var(--ds-accent-soft)",
          positive: "var(--ds-positive)",
          "positive-soft": "var(--ds-positive-soft)",
          negative: "var(--ds-negative)",
          "negative-soft": "var(--ds-negative-soft)",
          warning: "var(--ds-warning)",
          "warning-soft": "var(--ds-warning-soft)",
        },
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      // Type scale: 12px labels, 13px secondary, 14px body. Nothing below 11px.
      fontSize: {
        "ds-label": ["12px", { lineHeight: "16px", letterSpacing: "0.04em", fontWeight: "700" }],
        "ds-small": ["13px", { lineHeight: "18px" }],
        "ds-body": ["14px", { lineHeight: "20px" }],
        "ds-title": ["18px", { lineHeight: "24px", fontWeight: "700" }],
        "ds-display": ["26px", { lineHeight: "32px", fontWeight: "700" }],
      },
      boxShadow: { ds: "var(--ds-shadow)" },
      borderRadius: {
        ds: "var(--ds-radius)",
        "ds-sm": "var(--ds-radius-sm)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
