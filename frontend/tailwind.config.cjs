const colors = require("tailwindcss/colors");

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: colors.indigo,
        surface: {
          DEFAULT: "#101327",
          light: "#161b36",
          border: "#1e2348",
        },
      },
      boxShadow: {
        subtle: "0 10px 30px -12px rgba(15, 23, 42, 0.35)",
      },
    },
  },
  plugins: [],
};
