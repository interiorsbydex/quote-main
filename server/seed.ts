import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { users } from "../shared/schema";
import bcrypt from "bcrypt";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

async function seed() {
  console.log("Seeding database with default users...");

  const hashedAdminPassword = await bcrypt.hash("admin123", 10);
  const hashedArchitectPassword = await bcrypt.hash("architect123", 10);

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

  console.log("✓ Default users created:");
  console.log("  Admin: username=admin, password=admin123");
  console.log("  Architect: username=architect, password=architect123");
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
