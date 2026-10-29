import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

const envContent = readFileSync(resolve("apps/web/.env"), "utf8");
const lines = envContent.split("\n");

const vars = {};
let currentKey = null;
let currentValue = "";
let inQuotes = false;

for (const rawLine of lines) {
  const line = rawLine.trim();
  if (!inQuotes && (line.startsWith("#") || line === "")) continue;

  if (inQuotes) {
    currentValue += "\n" + rawLine;
    if (rawLine.endsWith('"')) {
      inQuotes = false;
      vars[currentKey] = currentValue.slice(1, -1);
      currentKey = null;
      currentValue = "";
    }
  } else {
    const eq = line.indexOf("=");
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1);
      if (val.startsWith('"') && !val.endsWith('"')) {
        inQuotes = true;
        currentKey = key;
        currentValue = val;
      } else {
        vars[key] = val.startsWith('"') && val.endsWith('"') ? val.slice(1, -1) : val;
      }
    }
  }
}

// Ensure APP_URL for production
vars["APP_URL"] = "https://sakar-app.vercel.app";

console.log(`Parsed ${Object.keys(vars).length} environment variables.`);

for (const [key, value] of Object.entries(vars)) {
  if (value === "" || value === undefined) {
    console.log(`Skipping empty variable: ${key}`);
    continue;
  }
  process.stdout.write(`Updating ${key}... `);
  try {
    execSync(`npx vercel env add ${key} production --project sakar --force`, {
      input: value,
      stdio: ["pipe", "ignore", "inherit"],
    });
    console.log("✓");
  } catch (err) {
    console.log(`✗ Error: ${err.message}`);
  }
}

console.log("\nAll Vercel environment variables synced!");
