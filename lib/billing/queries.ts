import "server-only";

import type {
	BillingEvent,
	Order,
	OrderItem,
	PrismaClient,
	Subscription,
	SubscriptionItem,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
	type BillingInterval,
	OrderStatus,
	PriceModel,
	PriceType,
	SubscriptionStatus,
} from "@/lib/db/enums";
import type Stripe from "stripe";
import {
	getPlanByStripePriceId,
	getPriceByStripePriceId,
} from "@/lib/billing/plans";
import { prisma } from "@/lib/db";
import type { ActivePlanInfo } from "./types";

type DbClient = PrismaClient | Prisma.TransactionClient;

// ============================================================================
// SUBSCRIPTION QUERIES
// ============================================================================

export type SubscriptionInsert = Prisma.SubscriptionUncheckedCreateInput;
export type SubscriptionSelect = Subscription;

export async function createSubscription(
	data: SubscriptionInsert,
): Promise<SubscriptionSelect> {
	const { id, organizationId, ...update } = data;

	return prisma.subscription.upsert({
		where: { id },
		create: data,
		update: {
			...update,
			// Keep org linkage stable if Stripe sends out-of-order events
			organizationId,
		},
	});
}

export async function updateSubscription(
	id: string,
	data: Partial<Omit<SubscriptionInsert, "id">>,
	db: DbClient = prisma,
): Promise<SubscriptionSelect | null> {
	try {
		return await db.subscription.update({
			where: { id },
			data,
		});
	} catch (error) {
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return null;
		}
		throw error;
	}
}

export async function deleteSubscription(id: string): Promise<void> {
	await prisma.subscription.delete({ where: { id } });
}

export async function getSubscriptionById(
	id: string,
): Promise<SubscriptionSelect | null> {
	return prisma.subscription.findUnique({ where: { id } });
}

export async function getSubscriptionsByOrganizationId(
	organizationId: string,
	options?: { limit?: number; offset?: number },
): Promise<SubscriptionSelect[]> {
	return prisma.subscription.findMany({
		where: { organizationId },
		orderBy: { createdAt: "desc" },
		take: options?.limit,
		skip: options?.offset,
	});
}

export async function getActiveSubscriptionByOrganizationId(
	organizationId: string,
	db: DbClient = prisma,
): Promise<SubscriptionSelect | null> {
	const activeStatuses: SubscriptionStatus[] = [
		SubscriptionStatus.active,
		SubscriptionStatus.trialing,
		SubscriptionStatus.past_due,
		SubscriptionStatus.incomplete,
	];

	return db.subscription.findFirst({
		where: { organizationId, status: { in: activeStatuses } },
		orderBy: { createdAt: "desc" },
	});
}

export async function getSubscriptionByStripeCustomerId(
	stripeCustomerId: string,
): Promise<SubscriptionSelect | null> {
	return prisma.subscription.findFirst({
		where: { stripeCustomerId },
		orderBy: { createdAt: "desc" },
	});
}

export async function subscriptionExists(id: string): Promise<boolean> {
	const sub = await prisma.subscription.findUnique({
		where: { id },
		select: { id: true },
	});
	return !!sub;
}

// ============================================================================
// SUBSCRIPTION ITEM QUERIES
// ============================================================================

export type SubscriptionItemInsert =
	Prisma.SubscriptionItemUncheckedCreateInput;
export type SubscriptionItemSelect = SubscriptionItem;

export async function createSubscriptionItem(
	data: SubscriptionItemInsert,
): Promise<SubscriptionItemSelect> {
	const { id, ...update } = data;
	return prisma.subscriptionItem.upsert({
		where: { id },
		create: data,
		update,
	});
}

export async function createSubscriptionItems(
	items: SubscriptionItemInsert[],
): Promise<SubscriptionItemSelect[]> {
	if (items.length === 0) return [];

	return prisma.$transaction(async (tx) => {
		const results: SubscriptionItemSelect[] = [];
		for (const item of items) {
			const { id, ...update } = item;
			const result = await tx.subscriptionItem.upsert({
				where: { id },
				create: item,
				update,
			});
			results.push(result);
		}
		return results;
	});
}

export async function getSubscriptionItemsBySubscriptionId(
	subscriptionId: string,
): Promise<SubscriptionItemSelect[]> {
	return prisma.subscriptionItem.findMany({
		where: { subscriptionId },
	});
}

export async function getSubscriptionItemById(
	id: string,
): Promise<SubscriptionItemSelect | null> {
	return prisma.subscriptionItem.findUnique({ where: { id } });
}

export async function updateSubscriptionItem(
	id: string,
	data: Partial<Omit<SubscriptionItemInsert, "id">>,
): Promise<SubscriptionItemSelect | null> {
	try {
		return await prisma.subscriptionItem.update({
			where: { id },
			data,
		});
	} catch (error) {
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return null;
		}
		throw error;
	}
}

export async function deleteSubscriptionItem(id: string): Promise<void> {
	await prisma.subscriptionItem.delete({ where: { id } });
}

export async function deleteSubscriptionItemsBySubscriptionId(
	subscriptionId: string,
): Promise<void> {
	await prisma.subscriptionItem.deleteMany({ where: { subscriptionId } });
}

export async function syncSubscriptionItems(
	subscriptionId: string,
	items: SubscriptionItemInsert[],
): Promise<SubscriptionItemSelect[]> {
	return prisma.$transaction(async (tx) => {
		await tx.subscriptionItem.deleteMany({ where: { subscriptionId } });

		if (items.length === 0) return [];

		const created: SubscriptionItemSelect[] = [];
		for (const item of items) {
			created.push(
				await tx.subscriptionItem.create({
					data: item,
				}),
			);
		}
		return created;
	});
}

export function stripeItemsToDb(
	subscriptionId: string,
	items: Stripe.SubscriptionItem[],
): SubscriptionItemInsert[] {
	return items.map((item) => {
		const price = item.price;
		const recurring = price.recurring;

		let priceModel: PriceModel = PriceModel.flat;
		const priceConfig = getPriceByStripePriceId(price.id);
		if (
			priceConfig &&
			"seatBased" in priceConfig.price &&
			priceConfig.price.seatBased
		) {
			priceModel = PriceModel.perSeat;
		} else if (recurring?.usage_type === "metered") {
			priceModel = PriceModel.metered;
		}

		return {
			id: item.id,
			subscriptionId,
			stripePriceId: price.id,
			stripeProductId:
				typeof price.product === "string" ? price.product : undefined,
			quantity: item.quantity ?? 1,
			priceAmount: price.unit_amount ?? undefined,
			priceType: recurring ? PriceType.recurring : PriceType.oneTime,
			priceModel,
			interval: recurring?.interval as SubscriptionItemInsert["interval"],
			intervalCount: recurring?.interval_count ?? 1,
			meterId: recurring?.meter ?? undefined,
		};
	});
}

// ============================================================================
// ORDER QUERIES (One-time orders)
// ============================================================================

export type OrderInsert = Prisma.OrderUncheckedCreateInput;
export type OrderSelect = Order;

export async function createOrder(data: OrderInsert): Promise<OrderSelect> {
	return prisma.order.create({ data });
}

export async function getOrderById(id: string): Promise<OrderSelect | null> {
	return prisma.order.findUnique({ where: { id } });
}

export async function getOrdersByOrganizationId(
	organizationId: string,
	options?: { limit?: number; offset?: number },
): Promise<OrderSelect[]> {
	return prisma.order.findMany({
		where: { organizationId },
		orderBy: { createdAt: "desc" },
		take: options?.limit,
		skip: options?.offset,
	});
}

export async function getOrderByCheckoutSessionId(
	checkoutSessionId: string,
): Promise<OrderSelect | null> {
	return prisma.order.findFirst({
		where: { stripeCheckoutSessionId: checkoutSessionId },
	});
}

export async function getOrderByPaymentIntentId(
	paymentIntentId: string,
): Promise<OrderSelect | null> {
	return prisma.order.findFirst({
		where: { stripePaymentIntentId: paymentIntentId },
	});
}

export async function updateOrder(
	id: string,
	data: Partial<Omit<OrderInsert, "id">>,
): Promise<OrderSelect | null> {
	try {
		return await prisma.order.update({
			where: { id },
			data,
		});
	} catch (error) {
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === "P2025"
		) {
			return null;
		}
		throw error;
	}
}

export interface LifetimeOrderResult {
	order: OrderSelect;
	stripePriceId: string;
}

export async function getLifetimeOrderByOrganizationId(
	organizationId: string,
): Promise<LifetimeOrderResult | null> {
	const orders = await prisma.order.findMany({
		where: { organizationId, status: OrderStatus.completed },
		include: { items: true },
		orderBy: { createdAt: "desc" },
		take: 10,
	});

	for (const order of orders) {
		for (const item of order.items) {
			const plan = getPlanByStripePriceId(item.stripePriceId);
			if (plan?.id === "lifetime") {
				const { items: _, ...orderWithoutItems } = order;
				return {
					order: orderWithoutItems,
					stripePriceId: item.stripePriceId,
				};
			}
		}
	}

	return null;
}

// ============================================================================
// ORDER ITEM QUERIES
// ============================================================================

export type OrderItemInsert = Prisma.OrderItemUncheckedCreateInput;
export type OrderItemSelect = OrderItem;

export async function createOrderItem(
	data: OrderItemInsert,
): Promise<OrderItemSelect> {
	return prisma.orderItem.create({ data });
}

export async function createOrderItems(
	items: OrderItemInsert[],
): Promise<OrderItemSelect[]> {
	if (items.length === 0) return [];

	return prisma.$transaction(async (tx) => {
		const created: OrderItemSelect[] = [];
		for (const item of items) {
			created.push(await tx.orderItem.create({ data: item }));
		}
		return created;
	});
}

export async function getOrderItemsByOrderId(
	orderId: string,
): Promise<OrderItemSelect[]> {
	return prisma.orderItem.findMany({ where: { orderId } });
}

export async function getOrderItemById(
	id: string,
): Promise<OrderItemSelect | null> {
	return prisma.orderItem.findUnique({ where: { id } });
}

export async function deleteOrderItemsByOrderId(
	orderId: string,
): Promise<void> {
	await prisma.orderItem.deleteMany({ where: { orderId } });
}

// ============================================================================
// BILLING EVENT QUERIES (Audit log)
// ============================================================================

export type BillingEventInsert = Prisma.BillingEventUncheckedCreateInput;
export type BillingEventSelect = BillingEvent;

export async function createBillingEvent(
	data: BillingEventInsert,
): Promise<BillingEventSelect> {
	return prisma.billingEvent.create({ data });
}

export async function billingEventExists(
	stripeEventId: string,
): Promise<boolean> {
	const event = await prisma.billingEvent.findUnique({
		where: { stripeEventId },
		select: { id: true },
	});
	return !!event;
}

export async function getBillingEventsByOrganizationId(
	organizationId: string,
	options?: { limit?: number },
): Promise<BillingEventSelect[]> {
	return prisma.billingEvent.findMany({
		where: { organizationId },
		orderBy: { createdAt: "desc" },
		take: options?.limit ?? 50,
	});
}

export async function markBillingEventError(
	id: string,
	error: string,
): Promise<void> {
	await prisma.billingEvent.update({
		where: { id },
		data: { processed: false, error },
	});
}

export async function upsertBillingEvent(
	data: BillingEventInsert,
): Promise<BillingEventSelect> {
	const { stripeEventId, ...update } = data;
	return prisma.billingEvent.upsert({
		where: { stripeEventId },
		create: data,
		update,
	});
}

// ============================================================================
// ACTIVE PLAN HELPER
// ============================================================================

export async function getActivePlanForOrganization(
	organizationId: string,
): Promise<ActivePlanInfo | null> {
	const subscription =
		await getActiveSubscriptionByOrganizationId(organizationId);

	if (subscription) {
		const plan = getPlanByStripePriceId(subscription.stripePriceId);

		return {
			planId: plan?.id ?? "unknown",
			planName: plan?.name ?? "Unknown Plan",
			stripePriceId: subscription.stripePriceId,
			status: subscription.status,
			isTrialing: subscription.status === SubscriptionStatus.trialing,
			trialEndsAt: subscription.trialEnd,
			currentPeriodEnd: subscription.currentPeriodEnd,
			cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
			quantity: subscription.quantity,
			isLifetime: false,
		};
	}

	const lifetimeResult = await getLifetimeOrderByOrganizationId(organizationId);
	if (lifetimeResult) {
		const plan = getPlanByStripePriceId(lifetimeResult.stripePriceId);
		return {
			planId: plan?.id ?? "lifetime",
			planName: plan?.name ?? "Lifetime",
			stripePriceId: lifetimeResult.stripePriceId,
			status: SubscriptionStatus.active,
			isTrialing: false,
			trialEndsAt: null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			quantity: 1,
			isLifetime: true,
		};
	}

	return null;
}

export async function hasActivePaidPlan(
	organizationId: string,
): Promise<boolean> {
	return (await getActivePlanForOrganization(organizationId)) !== null;
}

export async function hasSpecificPlan(
	organizationId: string,
	planId: string,
): Promise<boolean> {
	const activePlan = await getActivePlanForOrganization(organizationId);
	return activePlan?.planId === planId;
}

// ============================================================================
// STRIPE SYNC HELPERS
// ============================================================================

export function safeTsToDate(ts: number | null | undefined): Date | null {
	if (ts === null || ts === undefined || ts === 0) return null;
	const date = new Date(ts * 1000);
	if (Number.isNaN(date.getTime())) return null;
	return date;
}

export function stripeSubscriptionToDb(
	stripeSubscription: Stripe.Subscription,
	organizationId: string,
): SubscriptionInsert {
	const item = stripeSubscription.items?.data?.[0];
	const price = item?.price;
	const recurring = price?.recurring;

	const quantity = Math.max(1, item?.quantity ?? 1);

	const currentPeriodStartTs =
		item?.current_period_start ??
		stripeSubscription.start_date ??
		stripeSubscription.created ??
		Math.floor(Date.now() / 1000);

	const currentPeriodEndTs =
		item?.current_period_end ??
		stripeSubscription.billing_cycle_anchor ??
		Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

	return {
		id: stripeSubscription.id,
		organizationId,
		stripeCustomerId:
			typeof stripeSubscription.customer === "string"
				? stripeSubscription.customer
				: stripeSubscription.customer?.id,
		status: (stripeSubscription.status ?? "active") as SubscriptionStatus,
		stripePriceId: price?.id ?? "",
		stripeProductId:
			typeof price?.product === "string" ? price.product : undefined,
		quantity,
		interval: (recurring?.interval ?? "month") as BillingInterval,
		intervalCount: recurring?.interval_count ?? 1,
		unitAmount: price?.unit_amount ?? null,
		currency: stripeSubscription.currency ?? "usd",
		currentPeriodStart: safeTsToDate(currentPeriodStartTs) ?? new Date(),
		currentPeriodEnd: safeTsToDate(currentPeriodEndTs) ?? new Date(),
		trialStart: safeTsToDate(stripeSubscription.trial_start),
		trialEnd: safeTsToDate(stripeSubscription.trial_end),
		cancelAtPeriodEnd: !!stripeSubscription.cancel_at_period_end,
		canceledAt: safeTsToDate(stripeSubscription.canceled_at),
	};
}
