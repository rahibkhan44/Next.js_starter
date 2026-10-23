import { z } from "zod";
import { CalendarService } from "@/lib/services/google/calendar";

// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() types are complex with zod v3/v4 interop
type AnyTool = any;

export function createCalendarTools(organizationId: string): Record<string, AnyTool> {
	const calendar = new CalendarService(organizationId);
	const { tool } = require("ai") as { tool: (...args: unknown[]) => AnyTool };

	return {
		list_events: tool({
			description:
				"List upcoming calendar events. By default shows today's remaining events.",
			parameters: z.object({
				maxResults: z
					.number()
					.min(1)
					.max(25)
					.optional()
					.describe("Maximum number of events to return (default 10)"),
				timeMin: z
					.string()
					.optional()
					.describe(
						"Start of time range in ISO 8601 format (default: now)",
					),
				timeMax: z
					.string()
					.optional()
					.describe(
						"End of time range in ISO 8601 format",
					),
			}),
			execute: async (args: {
				maxResults?: number;
				timeMin?: string;
				timeMax?: string;
			}) => {
				return calendar.listEvents({
					maxResults: args.maxResults,
					timeMin: args.timeMin,
					timeMax: args.timeMax,
				});
			},
		}),

		create_event: tool({
			description:
				"Create a new calendar event. Always confirm the details with the user before creating.",
			parameters: z.object({
				summary: z.string().describe("Event title/summary"),
				description: z
					.string()
					.optional()
					.describe("Event description"),
				location: z
					.string()
					.optional()
					.describe("Event location"),
				startDateTime: z
					.string()
					.describe(
						"Event start date and time in ISO 8601 format (e.g. '2024-03-15T10:00:00')",
					),
				endDateTime: z
					.string()
					.describe(
						"Event end date and time in ISO 8601 format (e.g. '2024-03-15T11:00:00')",
					),
				attendees: z
					.array(z.string())
					.optional()
					.describe("List of attendee email addresses"),
			}),
			execute: async (args: {
				summary: string;
				description?: string;
				location?: string;
				startDateTime: string;
				endDateTime: string;
				attendees?: string[];
			}) => {
				return calendar.createEvent(args);
			},
		}),

		find_free_slots: tool({
			description:
				"Find available free time slots in the user's calendar between two dates.",
			parameters: z.object({
				timeMin: z
					.string()
					.describe(
						"Start of search range in ISO 8601 format",
					),
				timeMax: z
					.string()
					.describe(
						"End of search range in ISO 8601 format",
					),
			}),
			execute: async (args: { timeMin: string; timeMax: string }) => {
				return calendar.findFreeSlots(args);
			},
		}),
	};
}
