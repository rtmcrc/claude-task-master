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
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
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
					const delegationData = result; // result is the delegation object { type, interactionId, details }
					log.info(
						`${toolName}: Detected agent_llm_delegation. Returning pending_agent_llm_action structure for MCP processing. Interaction ID: ${delegationData.interactionId}`
					);
					return {
						status: "pending_agent_llm_action",
						message: "Tool 'update' requires an LLM call from the agent. Details provided in llmRequestForAgent.",
						llmRequestForAgent: delegationData.details,
						interactionId: delegationData.interactionId,
						pendingInteractionSignalToAgent: {
							type: 'agent_must_respond_via_agent_llm',
							interactionId: delegationData.interactionId,
							instructions: "Agent, please perform the LLM call for the 'update' tool using llmRequestForAgent and then invoke 'agent_llm' with your response, including this interactionId.",
							originalCommandName: "update"
						}
					};
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
