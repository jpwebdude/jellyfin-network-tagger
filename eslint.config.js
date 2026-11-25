import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "docs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        history: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        Blob: "readonly",
        setInterval: "readonly",
        console: "readonly",
      },
    },
  }
);
