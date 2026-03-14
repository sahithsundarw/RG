import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    /* ── Light: "Soft Minimalist" ─────────────────────────────── */
    --backdrop: #BEB8FF;
    --bg: #FFFFFF;
    --bg-alt: #F9F8FF;
    --surface: #FFFFFF;
    --surface-hover: #F5F3FF;
    --border: #E9E7F3;
    --border-strong: #D1CAEE;
    --text-primary: #0F172A;
    --text-secondary: #374151;
    --text-muted: #6B7280;
    /* Digital Lavender / Violet as primary interactive accent */
    --accent: #7C3AED;
    --accent-hover: #6D28D9;
    --accent-soft: #EDE9FE;
    --accent-text: #FFFFFF;
    /* Indigo for positive/health states in light mode */
    --success: #4F46E5;
    --success-soft: #EEF2FF;
    --success-border: #C7D2FE;
    --warning: #D97706;
    --warning-soft: #FFFBEB;
    --warning-border: #FCD34D;
    --danger: #DC2626;
    --danger-soft: #FEF2F2;
    --danger-border: #FCA5A5;
    --info: #7C3AED;
    /* Floating "soft-focus" shadows — large blur, very low opacity */
    --shadow-sm: 0px 4px 24px rgba(124,58,237,0.07), 0px 1px 4px rgba(0,0,0,0.04);
    --shadow-md: 0px 8px 40px rgba(124,58,237,0.09), 0px 2px 8px rgba(0,0,0,0.04);
    --shadow-lg: 0px 24px 64px rgba(124,58,237,0.12), 0px 4px 16px rgba(0,0,0,0.06);
    /* High-radius rounding for friendly, organic feel */
    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
    --radius-xl: 20px;
  }

  [data-theme='dark'] {
    /* ── Dark: "Tactical Command Center" ─────────────────────── */
    --backdrop: #57486E;
    --bg: #2D2435;
    --bg-alt: #231A2C;
    /* Elevation through color: bg < surface < surface-hover */
    --surface: #3A2D4A;
    --surface-hover: #483858;
    --border: #4D3A62;
    --border-strong: #5E4A74;
    --text-primary: #F1F5F9;
    --text-secondary: #C4B5D4;
    --text-muted: #9E8EB5;
    /* Electric Purple as primary interactive accent */
    --accent: #8B5CF6;
    --accent-hover: #7C3AED;
    --accent-soft: rgba(139,92,246,0.12);
    --accent-text: #FFFFFF;
    /* Emerald for health/success, amber for warnings */
    --success: #10B981;
    --success-soft: rgba(16,185,129,0.08);
    --success-border: rgba(16,185,129,0.25);
    --warning: #F59E0B;
    --warning-soft: rgba(245,158,11,0.08);
    --warning-border: rgba(245,158,11,0.25);
    --danger: #EF4444;
    --danger-soft: rgba(239,68,68,0.08);
    --danger-border: rgba(239,68,68,0.25);
    --info: #818CF8;
    /* Borders over shadows — flat + structured */
    --shadow-sm: none;
    --shadow-md: none;
    --shadow-lg: 0 20px 60px rgba(0,0,0,0.7);
    /* Moderate rounding — sharper, more precise technical look */
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
    --radius-xl: 10px;
  }

  html { color-scheme: light; }
  [data-theme='dark'] { color-scheme: dark; }

  body {
    background: var(--backdrop);
    color: var(--text-primary);
    font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-size: 14px;
    line-height: 1.5;
    transition: background 0.2s ease, color 0.2s ease;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
  @keyframes checkIn { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  @keyframes shimmer {
    0% { background-position: -600px 0; }
    100% { background-position: 600px 0; }
  }

  .skeleton {
    background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
    background-size: 600px 100%;
    animation: shimmer 1.5s ease infinite;
    border-radius: var(--radius-sm);
  }

  * { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
  *::-webkit-scrollbar { width: 4px; height: 4px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  *::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
  ::selection { background: var(--accent-soft); }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
