import { openai } from "@ai-sdk/openai";
import { stepCountIs, streamText } from "ai";
import { z } from "zod/v4";
import {
	type ChatModelId,
	chatModels,
	DEFAULT_CHAT_MODEL,
} from "@/config/billing.config";
import { assertUserIsOrgMember, getSession } from "@/lib/auth/server";
import {
	CreditError,
	calculateCreditCost,
	consumeCredits,
	estimateCreditCost,
	getCreditBalance,
	InsufficientCreditsError,
	logFailedDeduction,
} from "@/lib/billing/credits";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAvailableTools } from "@/lib/services/ai/tool-registry";
import { buildSystemPrompt } from "@/lib/services/ai/prompt-builder";

export const maxDuration = 60;

// Extract allowed model IDs from shared config
const ALLOWED_MODEL_IDS = chatModels.map((m) => m.id);

// Type guard to check if a model is allowed
function isAllowedModel(model: string): model is ChatModelId {
	return ALLOWED_MODEL_IDS.includes(model as ChatModelId);
}

// Input validation schema
const chatRequestSchema = z.object({
	messages: z.array(
		z
			.object({
				role: z.enum(["user", "assistant", "system", "tool"]),
				content: z.string().optional(),
			})
			.passthrough(),
	),
	model: z.string().optional(),
	chatId: z.string().uuid().optional(),
	organizationId: z.string().uuid().optional(),
});

// Standard error response helper
function errorResponse(
	error: string,
	message: string,
	status: number,
	details?: Record<string, unknown>,
) {
	return Response.json(
		{ error, message, ...(details && { details }) },
		{ status },
	);
}

/**
 * This is a separate route handler instead of a tRPC procedure because tRPC
 * doesn't support streaming responses. The Vercel AI SDK's `streamText()`
 * returns chunks over time as the LLM generates tokens, which requires raw
 * HTTP streaming (ReadableStream + chunked transfer encoding). tRPC's
 * request/response model and JSON serialization would break this.
 */

export async function POST(req: Request) {
	const session = await getSession();

	if (!session) {
		return errorResponse("unauthorized", "Authentication required", 401);
	}

	// Validate request body
	let messages: { role: "user" | "assistant" | "system" | "tool"; content: string }[];
	let chatId: string | undefined;
	let organizationId: string | undefined;
	let selectedModel: ChatModelId = DEFAULT_CHAT_MODEL;

	try {
		const body = await req.json();
		const parsed = chatRequestSchema.parse(body);

		chatId = parsed.chatId;
		organizationId = parsed.organizationId;

		// Normalize messages to ensure proper content string for credit calculation and streamText
		messages = parsed.messages.map((msg) => {
			let content = msg.content ?? "";

			// If content is missing, try to extract from parts (passed through via zod)
			if (!content) {
				const msgAny = msg as unknown as {
					parts?: { type: string; text?: string }[];
				};
				if (Array.isArray(msgAny.parts)) {
					const textPart = msgAny.parts.find((p) => p.type === "text");
					if (textPart?.text) {
						content = textPart.text;
					}
				}
			}

			return {
				role: msg.role,
				content,
			};
		});

		// Validate and set model
		if (parsed.model) {
			if (!isAllowedModel(parsed.model)) {
				return errorResponse(
					"invalid_model",
					`Model '${parsed.model}' is not supported. Allowed models: ${ALLOWED_MODEL_IDS.join(", ")}`,
					400,
					{ allowedModels: ALLOWED_MODEL_IDS },
				);
			}
			selectedModel = parsed.model;
		}
	} catch (error) {
		logger.warn({ error }, "Invalid chat request body");
		return errorResponse("invalid_request", "Invalid request body", 400);
	}

	// Verify user is a member of the organization before allowing access
	if (organizationId) {
		try {
			await assertUserIsOrgMember(organizationId, session.user.id);
		} catch (error) {
			logger.debug(
				{ error, organizationId, userId: session.user.id },
				"AI chat access denied - user not member of organization",
			);
			return errorResponse("forbidden", "Access denied", 403);
		}
	}

	// Verify the chat belongs to the user's organization
	if (chatId && organizationId) {
		const chat = await prisma.aiChat.findFirst({
			where: { id: chatId, organizationId },
			select: { id: true },
		});

		if (!chat) {
			return errorResponse("not_found", "Chat not found", 404);
		}
	}

	// Verify personal chats belong to the authenticated user
	if (chatId && !organizationId) {
		const chat = await prisma.aiChat.findFirst({
			where: { id: chatId, userId: session.user.id, organizationId: null },
			select: { id: true },
		});

		if (!chat) {
			return errorResponse("not_found", "Chat not found", 404);
		}
	}

	// Check credit balance before proceeding (only for organization chats)
	if (organizationId) {
		const estimatedCost = estimateCreditCost(selectedModel, messages);

		try {
			const balance = await getCreditBalance(organizationId);

			if (balance.balance < estimatedCost) {
				return errorResponse(
					"insufficient_credits",
					"Not enough credits to send this message",
					402,
					{
						balance: balance.balance,
						estimated: estimatedCost,
						model: selectedModel,
					},
				);
			}
		} catch (error) {
			logger.error({ error, organizationId }, "Failed to check credit balance");
			return errorResponse(
				"internal_error",
				"Failed to check credit balance",
				500,
			);
		}
	}

	// Build tools and system prompt for organization chats
	// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool types are complex
	let tools: any;
	let systemPrompt: string | undefined;

	if (organizationId) {
		try {
			const org = await prisma.organization.findUnique({
				where: { id: organizationId },
				select: { name: true },
			});

			[tools, systemPrompt] = await Promise.all([
				getAvailableTools(organizationId, session.user.id),
				buildSystemPrompt({
					userName: session.user.name,
					userEmail: session.user.email,
					organizationName: org?.name ?? "Unknown",
					organizationId,
				}),
			]);
		} catch (error) {
			logger.error(
				{ error, organizationId },
				"Failed to build AI tools/prompt",
			);
			// Continue without tools - basic chat still works
		}
	}

	const result = streamText({
		model: openai(selectedModel),
		system: systemPrompt,
		// biome-ignore lint/suspicious/noExplicitAny: AI SDK message types differ from our normalized format
		messages: messages as any,
		tools,
		stopWhen: stepCountIs(5), // Agentic loop: up to 5 tool call iterations
		async onFinish({ text, usage }) {
			const inputTokens = usage?.inputTokens ?? 0;
			const outputTokens = usage?.outputTokens ?? 0;

			// Deduct credits for organization chats
			if (organizationId) {
				const actualCost = calculateCreditCost(
					selectedModel,
					inputTokens,
					outputTokens,
				);

				try {
					await consumeCredits({
						organizationId,
						amount: actualCost,
						description: `AI Chat (${selectedModel})`,
						model: selectedModel,
						inputTokens,
						outputTokens,
						referenceType: "ai_chat",
						referenceId: chatId,
						createdBy: session.user.id,
					});
				} catch (error) {
					// Log the failure for reconciliation
					const errorCode =
						error instanceof InsufficientCreditsError
							? "INSUFFICIENT_CREDITS"
							: error instanceof CreditError
								? error.code
								: "UNKNOWN_ERROR";

					const errorMessage =
						error instanceof Error ? error.message : "Unknown error";

					await logFailedDeduction({
						organizationId,
						amount: actualCost,
						errorCode,
						errorMessage,
						model: selectedModel,
						inputTokens,
						outputTokens,
						referenceType: "ai_chat",
						referenceId: chatId,
						userId: session.user.id,
					});

					if (error instanceof InsufficientCreditsError) {
						logger.warn(
							{
								organizationId,
								model: selectedModel,
								required: actualCost,
								available: error.available,
							},
							"Insufficient credits during streaming - logged for reconciliation",
						);
					} else {
						logger.error(
							{ error, organizationId, model: selectedModel },
							"Failed to deduct credits - logged for reconciliation",
						);
					}
				}
			}

			// Save the assistant's response to the database
			if (chatId) {
				const updatedMessages = [
					...messages,
					{
						role: "assistant",
						content: text,
					},
				];

				const where = organizationId
					? { id: chatId, organizationId }
					: { id: chatId, userId: session.user.id, organizationId: null };

				const updated = await prisma.aiChat.updateMany({
					where,
					data: { messages: JSON.stringify(updatedMessages) },
				});

				if (updated.count === 0) {
					logger.warn(
						{ chatId, organizationId, userId: session.user.id },
						"Failed to persist AI chat messages - chat not found or not owned by user/org",
					);
				}
			}
		},
	});

	return result.toTextStreamResponse();
}
