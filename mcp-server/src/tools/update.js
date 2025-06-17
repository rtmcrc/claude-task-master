/**
 * tools/update.js
 * Tool to update tasks based on new context/prompt
 */

import { z } from 'zod';
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import { updateTasksDirect } from '../core/task-master-core.js';
import { findTasksPath } from '../core/utils/path-utils.js';

/**
 * Register the update tool with the MCP server
 * @param {Object} server - FastMCP server instance
 */
export function registerUpdateTool(server) {
	server.addTool({
		name: 'update',
		description:
			"Update multiple upcoming tasks (with ID >= 'from' ID) based on new context or changes provided in the prompt. Use 'update_task' instead for a single specific task or 'update_subtask' for subtasks.",
		parameters: z.object({
			from: z
				.string()
				.describe(
					"Task ID from which to start updating (inclusive). IMPORTANT: This tool uses 'from', not 'id'"
				),
			prompt: z
				.string()
				.describe('Explanation of changes or new context to apply'),
			research: z
				.boolean()
				.optional()
				.describe('Use Perplexity AI for research-backed updates'),
			file: z
				.string()
				.optional()
				.describe('Path to the tasks file relative to project root'),
			projectRoot: z
				.string()
				.optional()
				.describe(
					'The directory of the project. (Optional, usually from session)'
				)
		}),
		// Assuming 'server' will be available in the context passed by withNormalizedProjectRoot
		// e.g., by modifying withNormalizedProjectRoot or how context is built.
		execute: withNormalizedProjectRoot(async (args, { log, session, server }) => {
			const toolName = 'update';
			const { from, prompt, research, file, projectRoot } = args;

			try {
				log.info(
					`Executing ${toolName} tool with normalized root: ${projectRoot}`
				);

				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot, file }, log);
					log.info(`${toolName}: Resolved tasks path: ${tasksJsonPath}`);
				} catch (error) {
					log.error(`${toolName}: Error finding tasks.json: ${error.message}`);
					return createErrorResponse(
						`Failed to find tasks.json within project root '${projectRoot}': ${error.message}`
					);
				}

				const result = await updateTasksDirect(
					{
						tasksJsonPath: tasksJsonPath,
						from: from,
						prompt: prompt,
						research: research,
						projectRoot: projectRoot
					},
					log,
					{ session }
				);

				// New delegation handling: Check for needsAgentDelegation and pendingInteraction
				if (result && result.needsAgentDelegation === true && result.pendingInteraction) {
					log.info(
						`${toolName}: Agent delegation signaled by direct function. Returning 'resource' type for MCP processing. Interaction ID: ${result.pendingInteraction.interactionId}`
					);
					return {
						content: [{
							type: "resource",
							resource: {
								uri: "agent-llm://pending-interaction", // Standardized URI
								mimeType: "application/json",
								text: JSON.stringify({
									// Standardized payload for agent pending interactions
									isAgentLLMPendingInteraction: true,
									details: result.pendingInteraction
								})
							}
						}],
						isError: false
					};
				} else {
					// If not a delegation, or if delegation signal is incomplete, proceed with normal logging and result handling
					// This handles both successful results from updateTasksDirect (no delegation)
					// and error objects returned by updateTasksDirect.
					log.info(
						`${toolName}: Direct function result (no delegation or incomplete signal): success=${result?.success}, type=${result?.type}`
					);
					return handleApiResult(result, log, 'Error updating tasks');
				}
			} catch (error) {
				log.error(
				return handleApiResult(result, log, 'Error updating tasks');
			} catch (error) {
				log.error(
					`Critical error in ${toolName} tool execute: ${error.message}`
				);
				return createErrorResponse(
					`Internal tool error (${toolName}): ${error.message}`
				);
			}
		})
	});
}
