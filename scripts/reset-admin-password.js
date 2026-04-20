/* eslint-disable */
// Usage: node scripts/reset-admin-password.js
// Resets password for a given user, and ensures status=approved, role=admin.

const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");
const path = require("path");
const fs = require("fs");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const TARGET_EMAIL = "nelsky@gmail.com";
const NEW_PASSWORD = "Qwerty!12";

(async () => {
  loadEnvLocal();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGO_DB_NAME || "test";
  if (!uri) {
    console.error("MONGODB_URI not set. Put it in .env.local or export it.");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const users = client.db(dbName).collection("users");

  const existing = await users.findOne({ email: TARGET_EMAIL });
  if (!existing) {
    console.error(`No user found with email ${TARGET_EMAIL}. Aborting.`);
    await client.close();
    process.exit(1);
  }

  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const result = await users.updateOne(
    { email: TARGET_EMAIL },
    {
      $set: {
        password: hash,
        status: "approved",
        role: "admin",
      },
    }
  );

  const after = await users.findOne(
    { email: TARGET_EMAIL },
    { projection: { email: 1, role: 1, status: 1, password: 1 } }
  );

  console.log("Matched:", result.matchedCount, "Modified:", result.modifiedCount);
  console.log("User now:", {
    email: after.email,
    role: after.role,
    status: after.status,
    passwordHashPrefix: after.password ? after.password.slice(0, 7) : null,
  });
  console.log(`\nYou can now log in with:\n  Email:    ${TARGET_EMAIL}\n  Password: ${NEW_PASSWORD}`);

  await client.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
