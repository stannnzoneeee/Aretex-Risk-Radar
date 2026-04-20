/* eslint-disable */
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

(async () => {
  loadEnvLocal();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGO_DB_NAME || "test";
  const client = new MongoClient(uri);
  await client.connect();

  console.log("Connected to DB:", dbName);
  console.log("Cluster host:", new URL(uri.replace("mongodb+srv://", "https://")).host);

  const users = client.db(dbName).collection("users");
  const email = "nelsky@gmail.com";
  const candidate = "Qwerty!12";

  const u = await users.findOne({ email });
  if (!u) {
    console.error("User not found.");
    process.exit(1);
  }

  console.log("\nDB record:");
  console.log({
    _id: u._id.toString(),
    email: u.email,
    role: u.role,
    status: u.status,
    hasPassword: !!u.password,
    passwordHashPrefix: u.password ? u.password.slice(0, 10) : null,
    profileComplete: u.profileComplete,
  });

  if (u.password) {
    const ok = await bcrypt.compare(candidate, u.password);
    console.log(`\nbcrypt.compare("${candidate}", DB hash) => ${ok}`);
  }

  // Also list ALL users matching the email with whitespace variants
  const emailVariants = await users
    .find({ email: { $regex: /nelsky/i } })
    .project({ email: 1, role: 1, status: 1 })
    .toArray();
  console.log("\nAll users matching /nelsky/i:", emailVariants);

  await client.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
