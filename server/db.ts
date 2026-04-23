import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });

export async function runMigrations() {
  const migrationClient = postgres(process.env.DATABASE_URL as string, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  const migrationsFolder = process.env.NODE_ENV === "production" ? "./dist/migrations" : "./migrations";
  try {
    console.log("[db] Running migrations...");
    await migrate(migrationDb, { migrationsFolder });
    console.log("[db] Migrations complete.");
  } finally {
    await migrationClient.end();
  }
}
