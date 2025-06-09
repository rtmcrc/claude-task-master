/**
 * tools/parsePRD.js
 * Tool to parse PRD document and generate tasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	withNormalizedProjectRoot,
	createErrorResponse
} from './utils.js';
import {
	parsePRDDirect,
	initiateParsePRDDirect,
	submitParsePRDResponseDirect
} from '../core/task-master-core.js';
import {
	PRD_FILE,
	TASKMASTER_DOCS_DIR,
	TASKMASTER_TASKS_FILE
} from '../../../src/constants/paths.js';

/**
 * Register the parse_prd tool
 * @param {Object} server - FastMCP server instance
 */
export function registerParsePRDTool(server) {
	server.addTool({
		name: 'parse_prd',
		description: `Parse a Product Requirements Document (PRD) text file to automatically generate initial tasks. Reinitializing the project is not necessary to run this tool. It is recommended to run parse-prd after initializing the project and creating/importing a prd.txt file in the project root's ${TASKMASTER_DOCS_DIR} directory.`,
		parameters: z.object({
			input: z
				.string()
				.optional()
				.default(PRD_FILE)
				.describe('Absolute path to the PRD document file (.txt, .md, etc.)'),
			projectRoot: z
				.string()
				.describe('The directory of the project. Must be an absolute path.'),
			output: z
				.string()
				.optional()
				.describe(
					`Output path for tasks.json file (default: ${TASKMASTER_TASKS_FILE})`
				),
			numTasks: z
				.string()
				.optional()
				.describe(
					'Approximate number of top-level tasks to generate (default: 10). As the agent, if you have enough information, ensure to enter a number of tasks that would logically scale with project complexity. Avoid entering numbers above 50 due to context window limitations.'
				),
			force: z
				.boolean()
				.optional()
				.default(false)
				.describe('Overwrite existing output file without prompting.'),
			research: z
				.boolean()
				.optional()
				.describe(
					'Enable Taskmaster to use the research role for potentially more informed task generation. Requires appropriate API key.'
				),
			append: z
				.boolean()
				.optional()
				.describe('Append generated tasks to existing file.')
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				const result = await parsePRDDirect(args, log, { session });
				return handleApiResult(result, log);
			} catch (error) {
				log.error(`Error in parse_prd: ${error.message}`);
				return createErrorResponse(`Failed to parse PRD: ${error.message}`);
			}
		})
	});

	server.addTool({
		name: 'initiateDelegatedParsePRD',
		description: "Initiates a delegated PRD parsing operation. Returns prompts and an interaction ID for the agent to make the LLM call.",
		parameters: z.object({
			projectRoot: z.string().describe("Absolute path to the project."),
			input: z.string().optional().describe("Path to the PRD file relative to projectRoot or absolute."),
			prdContent: z.string().optional().describe("Full text content of the PRD."),
			numTasks: z.number().int().positive().optional().describe("Approximate number of tasks to generate."),
			// nextId is usually determined internally based on existing tasks if appending,
			// but for a fresh parse or controlled generation, it might be exposed.
			// For now, let's assume the task-manager's parsePRD will handle nextId generation logic.
			research: z.boolean().optional().default(false).describe("Use research-optimized model."),
			clientContext: z.any().optional().describe("Optional client context to be echoed in the response.")
		}).refine(data => data.input || data.prdContent, {
			message: "Either 'input' (PRD file path) or 'prdContent' (direct PRD text) must be provided.",
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				// initiateParsePRDDirect expects projectRoot in args
				const result = await initiateParsePRDDirect(args, log, { session });
				// This result will be { success: true, data: { interactionId, aiServiceRequest, clientContext } }
				return handleApiResult(result, log);
			} catch (error) {
				log.error(`Error in initiateDelegatedParsePRD: ${error.message}`);
				return createErrorResponse(`Failed to initiate PRD parsing: ${error.message}`);
			}
		})
	});

	server.addTool({
		name: 'submitDelegatedParsePRDResponse',
		description: "Submits the raw LLM response for a delegated PRD parsing operation.",
		parameters: z.object({
			interactionId: z.string().describe("The interaction ID received from initiateDelegatedParsePRD tool call."),
			rawLLMResponse: z.string().describe("The raw JSON string response from the LLM."),
			llmUsageData: z.object({
				inputTokens: z.number().int().optional(),
				outputTokens: z.number().int().optional()
			}).optional().describe("Optional token usage data from the agent's LLM call."),
			projectRoot: z.string().describe("Absolute path to the project."),
			output: z.string().optional().describe(`Path to save tasks.json, relative to projectRoot. Default: ${TASKMASTER_TASKS_FILE}`),
			force: z.boolean().optional().default(false).describe("Overwrite tasks.json if it exists."),
			append: z.boolean().optional().default(false).describe("Append to existing tasks.json.")
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				// submitParsePRDResponseDirect expects projectRoot in args
				const result = await submitParsePRDResponseDirect(args, log, { session });
				return handleApiResult(result, log);
			} catch (error) {
				log.error(`Error in submitDelegatedParsePRDResponse: ${error.message}`);
				return createErrorResponse(`Failed to submit PRD response: ${error.message}`);
			}
		})
	});
}
