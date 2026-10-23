import "server-only";

import { google } from "googleapis";
import { logger } from "@/lib/logger";
import { getAuthenticatedClient } from "./oauth";

export class CalendarService {
	private organizationId: string;

	constructor(organizationId: string) {
		this.organizationId = organizationId;
	}

	private async getClient() {
		const auth = await getAuthenticatedClient(
			this.organizationId,
			"calendar",
		);
		return google.calendar({ version: "v3", auth });
	}

	/**
	 * List upcoming events.
	 */
	async listEvents(options?: {
		maxResults?: number;
		timeMin?: string;
		timeMax?: string;
		calendarId?: string;
	}) {
		const calendar = await this.getClient();
		const {
			maxResults = 10,
			timeMin = new Date().toISOString(),
			timeMax,
			calendarId = "primary",
		} = options ?? {};

		const response = await calendar.events.list({
			calendarId,
			timeMin,
			timeMax,
			maxResults,
			singleEvents: true,
			orderBy: "startTime",
		});

		return (response.data.items ?? []).map((event) => ({
			id: event.id!,
			summary: event.summary ?? "(No title)",
			description: event.description ?? null,
			location: event.location ?? null,
			start: event.start?.dateTime ?? event.start?.date ?? null,
			end: event.end?.dateTime ?? event.end?.date ?? null,
			attendees:
				event.attendees?.map((a) => ({
					email: a.email!,
					responseStatus: a.responseStatus ?? "needsAction",
					displayName: a.displayName ?? null,
				})) ?? [],
			htmlLink: event.htmlLink ?? null,
			status: event.status ?? null,
		}));
	}

	/**
	 * Create a calendar event.
	 */
	async createEvent(options: {
		summary: string;
		description?: string;
		location?: string;
		startDateTime: string;
		endDateTime: string;
		attendees?: string[];
		calendarId?: string;
	}) {
		const calendar = await this.getClient();
		const {
			summary,
			description,
			location,
			startDateTime,
			endDateTime,
			attendees,
			calendarId = "primary",
		} = options;

		const response = await calendar.events.insert({
			calendarId,
			requestBody: {
				summary,
				description,
				location,
				start: {
					dateTime: startDateTime,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
				end: {
					dateTime: endDateTime,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
				attendees: attendees?.map((email) => ({ email })),
			},
		});

		logger.info(
			{
				organizationId: this.organizationId,
				eventId: response.data.id,
			},
			"Calendar event created",
		);

		return {
			id: response.data.id!,
			summary: response.data.summary ?? summary,
			htmlLink: response.data.htmlLink ?? null,
			start:
				response.data.start?.dateTime ??
				response.data.start?.date ??
				null,
			end:
				response.data.end?.dateTime ??
				response.data.end?.date ??
				null,
		};
	}

	/**
	 * Find free time slots between two dates.
	 */
	async findFreeSlots(options: {
		timeMin: string;
		timeMax: string;
		calendarId?: string;
	}) {
		const calendar = await this.getClient();
		const { timeMin, timeMax, calendarId = "primary" } = options;

		const response = await calendar.freebusy.query({
			requestBody: {
				timeMin,
				timeMax,
				items: [{ id: calendarId }],
			},
		});

		const busySlots =
			response.data.calendars?.[calendarId]?.busy ?? [];

		// Calculate free slots from busy slots
		const freeSlots: Array<{ start: string; end: string }> = [];
		let currentStart = timeMin;

		for (const busy of busySlots) {
			if (busy.start && busy.start > currentStart) {
				freeSlots.push({
					start: currentStart,
					end: busy.start,
				});
			}
			if (busy.end) {
				currentStart = busy.end;
			}
		}

		if (currentStart < timeMax) {
			freeSlots.push({
				start: currentStart,
				end: timeMax,
			});
		}

		return freeSlots;
	}
}
