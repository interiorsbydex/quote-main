import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../shared/schema";
import bcrypt from "bcrypt";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed username/password accounts in production");
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const architectPassword = process.env.SEED_ARCHITECT_PASSWORD;
  if (!adminPassword || !architectPassword) {
    throw new Error("SEED_ADMIN_PASSWORD and SEED_ARCHITECT_PASSWORD are required");
  }

  console.log("Seeding database with default users...");

  const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);
  const hashedArchitectPassword = await bcrypt.hash(architectPassword, 10);

  await db.insert(users).values([
    {
      username: "admin",
      password: hashedAdminPassword,
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      role: "admin",
    },
    {
      username: "architect",
      password: hashedArchitectPassword,
      email: "architect@example.com",
      firstName: "Architect",
      lastName: "User",
      role: "architect",
    },
  ]).onConflictDoNothing();

  console.log("✓ Seed users created without logging credentials");
}

seed()
  .then(() => {
    console.log("Seed completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error seeding database:", error);
    process.exit(1);
  });
