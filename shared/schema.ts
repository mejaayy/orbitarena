import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const playerBalances = pgTable("player_balances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: varchar("wallet_address").notNull().unique(),
  availableCents: integer("available_cents").notNull().default(0),
  lockedCents: integer("locked_cents").notNull().default(0),
  lifetimeDepositedCents: integer("lifetime_deposited_cents").notNull().default(0),
  lifetimeWithdrawnCents: integer("lifetime_withdrawn_cents").notNull().default(0),
  lifetimePrizeCents: integer("lifetime_prize_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPlayerBalanceSchema = createInsertSchema(playerBalances).pick({
  walletAddress: true,
});

export type InsertPlayerBalance = z.infer<typeof insertPlayerBalanceSchema>;
export type PlayerBalance = typeof playerBalances.$inferSelect;

export const transactionTypeEnum = ['DEPOSIT', 'WITHDRAWAL', 'MATCH_LOCK', 'MATCH_UNLOCK', 'PRIZE_PAYOUT', 'REFUND'] as const;
export type TransactionType = typeof transactionTypeEnum[number];

export const balanceTransactions = pgTable("balance_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: varchar("wallet_address").notNull(),
  transactionType: varchar("transaction_type").notNull(),
  deltaAvailableCents: integer("delta_available_cents").notNull().default(0),
  deltaLockedCents: integer("delta_locked_cents").notNull().default(0),
  externalRef: varchar("external_ref").unique(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBalanceTransactionSchema = createInsertSchema(balanceTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertBalanceTransaction = z.infer<typeof insertBalanceTransactionSchema>;
export type BalanceTransaction = typeof balanceTransactions.$inferSelect;

export const weeklyEarnings = pgTable("weekly_earnings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: varchar("wallet_address").notNull(),
  playerName: varchar("player_name").notNull(),
  weekStart: timestamp("week_start").notNull(),
  earnedCents: integer("earned_cents").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WeeklyEarning = typeof weeklyEarnings.$inferSelect;

export const bannedWallets = pgTable("banned_wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: varchar("wallet_address").notNull().unique(),
  reason: varchar("reason"),
  bannedAt: timestamp("banned_at").notNull().defaultNow(),
});

export type BannedWallet = typeof bannedWallets.$inferSelect;

export const adminSettings = pgTable("admin_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: varchar("key").notNull().unique(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AdminSetting = typeof adminSettings.$inferSelect;

export const winStreaks = pgTable("win_streaks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletAddress: varchar("wallet_address").notNull().unique(),
  playerName: varchar("player_name").notNull(),
  currentStreak: integer("current_streak").notNull().default(0),
  alertCount: integer("alert_count").notNull().default(0),
  lastWinAt: timestamp("last_win_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type WinStreak = typeof winStreaks.$inferSelect;
