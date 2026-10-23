import type { Prisma } from "@prisma/client";
import {
	InvitationStatus,
	type SubscriptionStatus,
} from "@/lib/db/enums";
import { TRPCError } from "@trpc/server";
import { adjustCredits as adjustCreditsLib } from "@/lib/billing/credits";
import {
	cancelSubscriptionAtPeriodEnd,
	cancelSubscriptionImmediately,
} from "@/lib/billing/subscriptions";
import {
	syncOrganizationOrders,
	syncOrganizationSubscriptions,
} from "@/lib/billing/sync";
import { appendAnd, prisma } from "@/lib/db";
import { LoggerFactory } from "@/lib/logger/factory";
import {
	adjustCreditsAdminSchema,
	cancelSubscriptionAdminSchema,
	deleteOrganizationAdminSchema,
	exportOrganizationsAdminSchema,
	listOrganizationsAdminSchema,
} from "@/schemas/admin-organization-schemas";
import { createTRPCRouter, protectedAdminProcedure } from "@/trpc/init";

const logger = LoggerFactory.getLogger("admin-organization");

export const adminOrganizationRouter = createTRPCRouter({
	list: protectedAdminProcedure
		.input(listOrganizationsAdminSchema)
		.query(async ({ input }) => {
			const where: Prisma.OrganizationWhereInput = {};

			if (input.query) {
				where.name = { contains: input.query, mode: "insensitive" };
			}

			if (input.filters?.createdAt?.length) {
				const now = new Date();
				const dateOr: Prisma.OrganizationWhereInput[] = [];
				for (const range of input.filters.createdAt) {
					switch (range) {
						case "today": {
							const start = new Date(
								now.getFullYear(),
								now.getMonth(),
								now.getDate(),
							);
							const end = new Date(
								now.getFullYear(),
								now.getMonth(),
								now.getDate() + 1,
							);
							dateOr.push({ createdAt: { gte: start, lt: end } });
							break;
						}
						case "this-week": {
							const weekStart = new Date(
								now.getFullYear(),
								now.getMonth(),
								now.getDate() - now.getDay(),
							);
							dateOr.push({ createdAt: { gte: weekStart } });
							break;
						}
						case "this-month": {
							const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
							dateOr.push({ createdAt: { gte: monthStart } });
							break;
						}
						case "older": {
							const monthAgo = new Date(
								now.getFullYear(),
								now.getMonth() - 1,
								now.getDate(),
							);
							dateOr.push({ createdAt: { lte: monthAgo } });
							break;
						}
					}
				}
				if (dateOr.length) appendAnd(where, { OR: dateOr });
			}

			// Subscription status filter
			if (input.filters?.subscriptionStatus?.length) {
				appendAnd(where, {
					subscriptions: {
						some: {
							status: {
								in: input.filters.subscriptionStatus as SubscriptionStatus[],
							},
						},
					},
				});
			}

			// Balance range filter
			if (input.filters?.balanceRange?.length) {
				const balanceOr: Prisma.OrganizationWhereInput[] = [];
				for (const range of input.filters.balanceRange) {
					switch (range) {
						case "zero":
							balanceOr.push({
								OR: [
									{ creditBalance: null },
									{ creditBalance: { balance: 0 } },
								],
							});
							break;
						case "low":
							balanceOr.push({
								creditBalance: { balance: { gte: 1, lte: 1000 } },
							});
							break;
						case "medium":
							balanceOr.push({
								creditBalance: { balance: { gte: 1001, lte: 50000 } },
							});
							break;
						case "high":
							balanceOr.push({
								creditBalance: { balance: { gte: 50001 } },
							});
							break;
					}
				}
				if (balanceOr.length) appendAnd(where, { OR: balanceOr });
			}

			// member count filters (approx via Prisma groupBy)
			if (input.filters?.membersCount?.length) {
				const matchingOrgIds = new Set<string>();
				const counts = await prisma.member.groupBy({
					by: ["organizationId"],
					_count: { _all: true },
				});

				for (const c of counts) {
					const memberCount = c._count._all;
					for (const range of input.filters.membersCount) {
						if (range === "0" && memberCount === 0)
							matchingOrgIds.add(c.organizationId);
						if (range === "1-5" && memberCount >= 1 && memberCount <= 5)
							matchingOrgIds.add(c.organizationId);
						if (range === "6-10" && memberCount >= 6 && memberCount <= 10)
							matchingOrgIds.add(c.organizationId);
						if (range === "11+" && memberCount > 10)
							matchingOrgIds.add(c.organizationId);
					}
				}

				// Also consider orgs with zero members (not present in groupBy results)
				if (input.filters.membersCount.includes("0")) {
					const orgsWithMembers = new Set(counts.map((c) => c.organizationId));
					const zeroMemberOrgs = await prisma.organization.findMany({
						where: { id: { notIn: Array.from(orgsWithMembers) } },
						select: { id: true },
					});
					for (const o of zeroMemberOrgs) matchingOrgIds.add(o.id);
				}

				if (matchingOrgIds.size === 0) {
					return { organizations: [], total: 0 };
				}
				appendAnd(where, { id: { in: Array.from(matchingOrgIds) } });
			}

			const order = input.sortOrder === "desc" ? "desc" : "asc";
			const orderBy: Prisma.OrganizationOrderByWithRelationInput =
				input.sortBy === "createdAt" ? { createdAt: order } : { name: order };

			const [organizations, total] = await Promise.all([
				prisma.organization.findMany({
					where,
					take: input.limit,
					skip: input.offset,
					orderBy,
					include: {
						_count: { select: { members: true } },
						subscriptions: {
							orderBy: { createdAt: "desc" },
							take: 1,
							select: {
								id: true,
								status: true,
								stripePriceId: true,
								trialEnd: true,
								cancelAtPeriodEnd: true,
							},
						},
						creditBalance: {
							select: { balance: true },
						},
					},
				}),
				prisma.organization.count({ where }),
			]);

			// pending invitations count (per org)
			const orgIds = organizations.map((o) => o.id);
			const pendingInvites =
				orgIds.length > 0
					? await prisma.invitation.groupBy({
							by: ["organizationId"],
							where: {
								organizationId: { in: orgIds },
								status: InvitationStatus.pending,
							},
							_count: { _all: true },
						})
					: [];
			const pendingMap = new Map(
				pendingInvites.map((p) => [p.organizationId, p._count._all]),
			);

			const shaped = organizations.map((o) => {
				const sub = o.subscriptions[0];
				return {
					id: o.id,
					name: o.name,
					logo: o.logo,
					createdAt: o.createdAt,
					metadata: o.metadata,
					membersCount: o._count.members,
					pendingInvites: pendingMap.get(o.id) ?? 0,
					subscriptionStatus: sub?.status ?? null,
					subscriptionPlan: sub?.stripePriceId ?? null,
					subscriptionId: sub?.id ?? null,
					cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? null,
					trialEnd: sub?.trialEnd ?? null,
					credits: o.creditBalance?.balance ?? null,
				};
			});

			return { organizations: shaped, total };
		}),

	delete: protectedAdminProcedure
		.input(deleteOrganizationAdminSchema)
		.mutation(async ({ input }) => {
			await prisma.organization.delete({ where: { id: input.id } });
		}),

	exportSelectedToCsv: protectedAdminProcedure
		.input(exportOrganizationsAdminSchema)
		.mutation(async ({ input }) => {
			const organizations = await prisma.organization.findMany({
				where: { id: { in: input.organizationIds } },
				select: {
					id: true,
					name: true,
					createdAt: true,
					updatedAt: true,
					_count: {
						select: { members: true },
					},
					invitations: {
						where: { status: "pending" },
						select: { id: true },
					},
					subscriptions: {
						orderBy: { createdAt: "desc" },
						take: 1,
						select: { status: true, stripePriceId: true },
					},
					creditBalance: {
						select: { balance: true },
					},
				},
			});

			const flattened = organizations.map((org) => {
				const sub = org.subscriptions[0];
				return {
					id: org.id,
					name: org.name,
					membersCount: org._count.members,
					pendingInvites: org.invitations.length,
					subscriptionStatus: sub?.status ?? null,
					subscriptionPlan: sub?.stripePriceId ?? null,
					credits: org.creditBalance?.balance ?? 0,
					createdAt: org.createdAt,
					updatedAt: org.updatedAt,
				};
			});

			const Papa = await import("papaparse");
			return Papa.unparse(flattened);
		}),

	exportSelectedToExcel: protectedAdminProcedure
		.input(exportOrganizationsAdminSchema)
		.mutation(async ({ input }) => {
			const organizations = await prisma.organization.findMany({
				where: { id: { in: input.organizationIds } },
				select: {
					id: true,
					name: true,
					createdAt: true,
					updatedAt: true,
					_count: {
						select: { members: true },
					},
					invitations: {
						where: { status: "pending" },
						select: { id: true },
					},
					subscriptions: {
						orderBy: { createdAt: "desc" },
						take: 1,
						select: { status: true, stripePriceId: true },
					},
					creditBalance: {
						select: { balance: true },
					},
				},
			});

			const ExcelJS = await import("exceljs");
			const workbook = new ExcelJS.Workbook();
			const worksheet = workbook.addWorksheet("Organizations");

			if (organizations.length > 0) {
				worksheet.columns = [
					{ header: "ID", key: "id", width: 40 },
					{ header: "Name", key: "name", width: 30 },
					{ header: "Members", key: "membersCount", width: 15 },
					{ header: "Pending Invites", key: "pendingInvites", width: 15 },
					{ header: "Plan", key: "subscriptionPlan", width: 20 },
					{ header: "Status", key: "subscriptionStatus", width: 15 },
					{ header: "Credits", key: "credits", width: 15 },
					{ header: "Created At", key: "createdAt", width: 25 },
					{ header: "Updated At", key: "updatedAt", width: 25 },
				];

				for (const org of organizations) {
					const sub = org.subscriptions[0];
					worksheet.addRow({
						id: org.id,
						name: org.name,
						membersCount: org._count.members,
						pendingInvites: org.invitations.length,
						subscriptionPlan: sub?.stripePriceId ?? null,
						subscriptionStatus: sub?.status ?? null,
						credits: org.creditBalance?.balance ?? 0,
						createdAt: org.createdAt,
						updatedAt: org.updatedAt,
					});
				}
			}

			const buffer = await workbook.xlsx.writeBuffer();
			return Buffer.from(buffer).toString("base64");
		}),

	/**
	 * Sync selected organizations' subscriptions from Stripe
	 * Fetches fresh data from Stripe based on customer ID and updates local database
	 */
	syncFromStripe: protectedAdminProcedure
		.input(exportOrganizationsAdminSchema)
		.mutation(async ({ input, ctx }) => {
			logger.info(
				{
					organizationIds: input.organizationIds,
					adminId: ctx.user.id,
				},
				"Admin triggered manual sync from Stripe",
			);

			const [subscriptionResult, orderResult] = await Promise.all([
				syncOrganizationSubscriptions(input.organizationIds),
				syncOrganizationOrders(input.organizationIds),
			]);

			// Granular logging of results
			const subFailures = subscriptionResult.results.filter((r) => !r.success);
			const orderFailures = orderResult.results.filter((r) => !r.success);

			if (subFailures.length > 0 || orderFailures.length > 0) {
				logger.warn(
					{
						subFailures: subFailures.map((r) => ({
							id: r.organizationId,
							error: r.error,
						})),
						orderFailures: orderFailures.map((r) => ({
							id: r.organizationId,
							error: r.error,
						})),
					},
					"Some organizations failed to sync from Stripe",
				);
			}

			if (subscriptionResult.successful > 0 || orderResult.successful > 0) {
				logger.info(
					{
						subscriptionsSynced: subscriptionResult.successful,
						ordersSynced: orderResult.successful,
					},
					"Stripe sync completed successfully for some/all organizations",
				);
			}

			return {
				subscriptions: subscriptionResult,
				orders: orderResult,
			};
		}),

	/**
	 * Adjust organization credits (admin action)
	 */
	adjustCredits: protectedAdminProcedure
		.input(adjustCreditsAdminSchema)
		.mutation(async ({ ctx, input }) => {
			// Verify organization exists
			const org = await prisma.organization.findUnique({
				where: { id: input.organizationId },
			});

			if (!org) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Organization not found",
				});
			}

			const transaction = await adjustCreditsLib({
				organizationId: input.organizationId,
				amount: input.amount,
				description: input.description,
				createdBy: ctx.user.id,
				metadata: {
					adjustedByAdmin: ctx.user.id,
					adjustedByEmail: ctx.user.email,
				},
			});

			return {
				success: true,
				newBalance: transaction.balanceAfter,
				transactionId: transaction.id,
			};
		}),

	/**
	 * Cancel an organization's subscription (admin action)
	 */
	cancelSubscription: protectedAdminProcedure
		.input(cancelSubscriptionAdminSchema)
		.mutation(async ({ input, ctx }) => {
			const { subscriptionId, immediate } = input;

			logger.info(
				{ subscriptionId, immediate, adminId: ctx.user.id },
				"Admin canceling subscription",
			);

			if (immediate) {
				await cancelSubscriptionImmediately(subscriptionId);
			} else {
				await cancelSubscriptionAtPeriodEnd(subscriptionId);
			}

			// The webhook will handle updating the local database

			return {
				success: true,
				immediate,
			};
		}),
});
