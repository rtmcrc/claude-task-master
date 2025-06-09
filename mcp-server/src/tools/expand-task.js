/**
 * tools/expand-task.js
 * Tool to expand a task into subtasks
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	expandTaskDirect,
	initiateExpandTaskDirect,
	submitExpandTaskResponseDirect
} from '../core/task-master-core.js';
import { findTasksPath } from '../core/utils/path-utils.js';

/**
 * Register the expand-task tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerExpandTaskTool(server) {
	server.addTool({
		name: 'expand_task',
		description: 'Expand a task into subtasks for detailed implementation',
		parameters: z.object({
			id: z.string().describe('ID of task to expand'),
			num: z.string().optional().describe('Number of subtasks to generate'),
			research: z
				.boolean()
				.optional()
				.default(false)
				.describe('Use research role for generation'),
			prompt: z
				.string()
				.optional()
				.describe('Additional context for subtask generation'),
			file: z
				.string()
				.optional()
				.describe(
					'Path to the tasks file relative to project root (e.g., tasks/tasks.json)'
				),
			projectRoot: z
				.string()
				.describe('The directory of the project. Must be an absolute path.'),
			force: z
				.boolean()
				.optional()
				.default(false)
				.describe('Force expansion even if subtasks exist')
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				log.info(`Starting expand-task with args: ${JSON.stringify(args)}`);
				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.file }, log);
				} catch (error) {
					log.error(`Error finding tasks.json: ${error.message}`);
					return createErrorResponse(`Failed to find tasks.json: ${error.message}`);
				}

				const directArgs = { ...args, tasksJsonPath };
				const result = await expandTaskDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error expanding task');
			} catch (error) {
				log.error(`Error in expand-task tool: ${error.message}`);
				return createErrorResponse(error.message);
			}
		})
	});

	server.addTool({
		name: 'initiateDelegatedExpandTask',
		description: 'Initiates a delegated task expansion. Returns prompts and an interaction ID.',
		parameters: z.object({
			projectRoot: z.string().describe("Absolute path to the project."),
			file: z.string().optional().describe("Path to the tasks file relative to project root (e.g., tasks/tasks.json)."),
			id: z.string().describe("ID of the task to expand."),
			num: z.string().optional().describe("Number of subtasks to generate."),
			research: z.boolean().optional().default(false).describe("Use research role for generation."),
			prompt: z.string().optional().describe("Additional context for subtask generation."),
			clientContext: z.any().optional().describe("Optional client context to be echoed.")
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.file }, log);
				} catch (error) {
					return createErrorResponse(`Failed to find tasks.json: ${error.message}`);
				}
				const directArgs = { ...args, tasksJsonPath };
				const result = await initiateExpandTaskDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error initiating task expansion');
			} catch (error) {
				log.error(`Error in initiateDelegatedExpandTask tool: ${error.message}`);
				return createErrorResponse(error.message);
			}
		})
	});

	server.addTool({
		name: 'submitDelegatedExpandTaskResponse',
		description: 'Submits the raw LLM response for a delegated task expansion.',
		parameters: z.object({
			interactionId: z.string().describe("The interaction ID from initiateDelegatedExpandTask."),
			rawLLMResponse: z.string().describe("The raw JSON string response from the LLM."),
			llmUsageData: z.object({
				inputTokens: z.number().int().optional(),
				outputTokens: z.number().int().optional()
			}).optional().describe("Optional token usage data."),
			projectRoot: z.string().describe("Absolute path to the project."),
			file: z.string().optional().describe("Path to the tasks file (for writing)."),
			id: z.string().describe("ID of the parent task being expanded (for context)."),
			force: z.boolean().optional().default(false).describe("Force expansion (if applicable to stored context).")
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			try {
				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.file }, log);
				} catch (error) {
					return createErrorResponse(`Failed to find tasks.json: ${error.message}`);
				}
				const directArgs = { ...args, tasksJsonPath };
				const result = await submitExpandTaskResponseDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error submitting task expansion response');
			} catch (error) {
				log.error(`Error in submitDelegatedExpandTaskResponse tool: ${error.message}`);
				return createErrorResponse(error.message);
			}
		})
	});
}
