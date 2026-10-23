/**
 * Enum-like constants to replace Prisma native enums (SQLite doesn't support enums).
 * These provide the same API as the old Prisma enums: e.g. MemberRole.owner
 * When migrating to PostgreSQL, switch back to importing from @prisma/client.
 */

export const BillingInterval = {
	day: "day",
	week: "week",
	month: "month",
	year: "year",
} as const;
export type BillingInterval =
	(typeof BillingInterval)[keyof typeof BillingInterval];

export const CreditTransactionType = {
	purchase: "purchase",
	subscriptionGrant: "subscription_grant",
	bonus: "bonus",
	promo: "promo",
	usage: "usage",
	refund: "refund",
	expire: "expire",
	adjustment: "adjustment",
} as const;
export type CreditTransactionType =
	(typeof CreditTransactionType)[keyof typeof CreditTransactionType];

export const InvitationStatus = {
	pending: "pending",
	accepted: "accepted",
	rejected: "rejected",
	canceled: "canceled",
} as const;
export type InvitationStatus =
	(typeof InvitationStatus)[keyof typeof InvitationStatus];

export const LeadSource = {
	website: "website",
	referral: "referral",
	socialMedia: "social_media",
	advertising: "advertising",
	coldCall: "cold_call",
	email: "email",
	event: "event",
	other: "other",
} as const;
export type LeadSource = (typeof LeadSource)[keyof typeof LeadSource];

export const LeadStatus = {
	new: "new",
	contacted: "contacted",
	qualified: "qualified",
	proposal: "proposal",
	negotiation: "negotiation",
	won: "won",
	lost: "lost",
} as const;
export type LeadStatus = (typeof LeadStatus)[keyof typeof LeadStatus];

export const MemberRole = {
	owner: "owner",
	admin: "admin",
	member: "member",
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];

export const OrderStatus = {
	pending: "pending",
	completed: "completed",
	failed: "failed",
	refunded: "refunded",
	partiallyRefunded: "partially_refunded",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderType = {
	subscription: "subscription",
	oneTime: "one_time",
} as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

export const PriceModel = {
	flat: "flat",
	perSeat: "per_seat",
	metered: "metered",
} as const;
export type PriceModel = (typeof PriceModel)[keyof typeof PriceModel];

export const PriceType = {
	recurring: "recurring",
	oneTime: "one_time",
} as const;
export type PriceType = (typeof PriceType)[keyof typeof PriceType];

export const SubscriptionStatus = {
	active: "active",
	canceled: "canceled",
	incomplete: "incomplete",
	incomplete_expired: "incomplete_expired",
	past_due: "past_due",
	paused: "paused",
	trialing: "trialing",
	unpaid: "unpaid",
} as const;
export type SubscriptionStatus =
	(typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const UserRole = {
	user: "user",
	admin: "admin",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const TaskStatus = {
	todo: "todo",
	inProgress: "in_progress",
	done: "done",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskPriority = {
	low: "low",
	medium: "medium",
	high: "high",
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];
