import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";
import {
	disconnectIntegration,
	getAuthUrl,
	listIntegrations,
	toggleIntegration,
	type IntegrationProvider,
} from "@/lib/services/google/oauth";
import {
	createTRPCRouter,
	protectedOrganizationProcedure,
} from "@/trpc/init";

const providerSchema = z.enum(["gmail", "sheets", "calendar"]);

export const organizationIntegrationRouter = createTRPCRouter({
	/**
	 * List all integrations for the current organization.
	 */
	list: protectedOrganizationProcedure.query(async ({ ctx }) => {
		return listIntegrations(ctx.organization.id);
	}),

	/**
	 * Get the OAuth URL to connect Google services.
	 */
	getConnectUrl: protectedOrganizationProcedure
		.input(
			z.object({
				providers: z.array(providerSchema).min(1),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Only org admins/owners can connect integrations
			if (
				ctx.membership.role !== "owner" &&
				ctx.membership.role !== "admin"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only organization admins can manage integrations",
				});
			}

			const url = getAuthUrl(
				ctx.organization.id,
				input.providers as IntegrationProvider[],
			);

			logger.info(
				{
					organizationId: ctx.organization.id,
					providers: input.providers,
				},
				"Generated Google connect URL",
			);

			return { url };
		}),

	/**
	 * Disconnect a specific integration.
	 */
	disconnect: protectedOrganizationProcedure
		.input(z.object({ provider: providerSchema }))
		.mutation(async ({ ctx, input }) => {
			if (
				ctx.membership.role !== "owner" &&
				ctx.membership.role !== "admin"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only organization admins can manage integrations",
				});
			}

			await disconnectIntegration(
				ctx.organization.id,
				input.provider as IntegrationProvider,
			);

			return { success: true };
		}),

	/**
	 * Toggle an integration on/off.
	 */
	toggle: protectedOrganizationProcedure
		.input(
			z.object({
				provider: providerSchema,
				enabled: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (
				ctx.membership.role !== "owner" &&
				ctx.membership.role !== "admin"
			) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Only organization admins can manage integrations",
				});
			}

			await toggleIntegration(
				ctx.organization.id,
				input.provider as IntegrationProvider,
				input.enabled,
			);

			return { success: true };
		}),
});
