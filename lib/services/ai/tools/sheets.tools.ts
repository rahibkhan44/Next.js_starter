import { z } from "zod";
import { SheetsService } from "@/lib/services/google/sheets";

// biome-ignore lint/suspicious/noExplicitAny: AI SDK tool() types are complex with zod v3/v4 interop
type AnyTool = any;

export function createSheetsTools(organizationId: string): Record<string, AnyTool> {
	const sheets = new SheetsService(organizationId);
	const { tool } = require("ai") as { tool: (...args: unknown[]) => AnyTool };

	return {
		list_spreadsheets: tool({
			description:
				"List Google Spreadsheets accessible to the user, sorted by most recently modified.",
			parameters: z.object({
				maxResults: z
					.number()
					.min(1)
					.max(50)
					.optional()
					.describe("Maximum number of spreadsheets to return (default 20)"),
			}),
			execute: async (args: { maxResults?: number }) => {
				return sheets.listSpreadsheets({ maxResults: args.maxResults });
			},
		}),

		read_sheet_range: tool({
			description:
				"Read data from a specific range in a Google Spreadsheet. Use list_spreadsheets first to get the spreadsheet ID.",
			parameters: z.object({
				spreadsheetId: z
					.string()
					.describe("The Google Spreadsheet ID"),
				range: z
					.string()
					.describe(
						"The A1 notation range to read (e.g. 'Sheet1!A1:D10', 'Sheet1!A:A')",
					),
			}),
			execute: async (args: {
				spreadsheetId: string;
				range: string;
			}) => {
				return sheets.readRange(args.spreadsheetId, args.range);
			},
		}),

		write_sheet_range: tool({
			description:
				"Write data to a specific range in a Google Spreadsheet. Always confirm with the user before writing.",
			parameters: z.object({
				spreadsheetId: z
					.string()
					.describe("The Google Spreadsheet ID"),
				range: z
					.string()
					.describe(
						"The A1 notation range to write to (e.g. 'Sheet1!A1:D10')",
					),
				values: z
					.array(z.array(z.string()))
					.describe(
						"2D array of values to write (rows x columns)",
					),
			}),
			execute: async (args: {
				spreadsheetId: string;
				range: string;
				values: string[][];
			}) => {
				return sheets.writeRange(
					args.spreadsheetId,
					args.range,
					args.values,
				);
			},
		}),

		append_sheet_data: tool({
			description:
				"Append rows of data to the end of a Google Spreadsheet range. Useful for adding new entries to a list.",
			parameters: z.object({
				spreadsheetId: z
					.string()
					.describe("The Google Spreadsheet ID"),
				range: z
					.string()
					.describe(
						"The A1 notation range to append to (e.g. 'Sheet1!A:D')",
					),
				values: z
					.array(z.array(z.string()))
					.describe("2D array of row values to append"),
			}),
			execute: async (args: {
				spreadsheetId: string;
				range: string;
				values: string[][];
			}) => {
				return sheets.appendRange(
					args.spreadsheetId,
					args.range,
					args.values,
				);
			},
		}),
	};
}
