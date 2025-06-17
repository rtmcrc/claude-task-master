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

				// Check for agent_llm_delegation before standard handling
				if (result && result.type === 'agent_llm_delegation') {
					const delegationInfo = result; // result is { type, interactionId, details }

					// Ensure server object is available in context, otherwise this will fail.
					if (!server || typeof server.callTool !== 'function') {
						log.error(`${toolName}: Server object with callTool method is not available in context. Cannot call agent_llm tool.`);
						// Fallback to previous behavior or return an error
						return createErrorResponse(
							'Server context error: Cannot delegate to agent_llm tool.',
							'INTERNAL_SERVER_ERROR'
						);
					}

					const paramsForAgentLLMTool = {
						delegatedCallDetails: {
							originalCommand: toolName, // Using toolName variable
							role: delegationInfo.details.role, // 'role' is in details from AgentLLMProvider
							serviceType: "generateText",     // updateTasks uses generateTextService
							requestParameters: delegationInfo.details
						},
						interactionId: delegationInfo.interactionId,
						projectRoot: projectRoot // Normalized projectRoot from withNormalizedProjectRoot
					};

					log.info(
						`${toolName}: Calling agent_llm tool to handle delegation. Interaction ID: ${delegationInfo.interactionId}, Role: ${delegationInfo.details.role}`
					);

					try {
						const agentLLMResult = await server.callTool('agent_llm', paramsForAgentLLMTool);
						log.info(`${toolName}: agent_llm tool call completed. Interaction ID: ${delegationInfo.interactionId}`);
						return agentLLMResult;
					} catch (agentLLMError) {
						log.error(`${toolName}: Error calling agent_llm tool: ${agentLLMError.message}. Interaction ID: ${delegationInfo.interactionId}`);
						return createErrorResponse(
							`Error during agent_llm tool call: ${agentLLMError.message}`,
							'AGENT_LLM_CALL_FAILED'
						);
					}
				}

				// If not a delegation, proceed with normal logging and result handling
				log.info(
					`${toolName}: Direct function result: success=${result.success}, type=${result.type}`
				);
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
