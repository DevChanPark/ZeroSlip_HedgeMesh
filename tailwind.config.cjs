/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/web/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111416",
        panel: "#1b2024",
        "panel-strong": "#222930",
        line: "#323b43",
        mint: "#64d6c1",
        cobalt: "#77a8ff",
        amber: "#f0c15c",
        coral: "#ef6f6c"
      }
    }
  },
  plugins: []
};
