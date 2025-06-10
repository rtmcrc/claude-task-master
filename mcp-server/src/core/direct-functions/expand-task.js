/**
 * expand-task.js
 * Direct function implementation for expanding a task into subtasks
 */

import expandTask from '../../../../scripts/modules/task-manager/expand-task.js';
import {
	readJSON,
	writeJSON,
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import path from 'path';
import fs from 'fs';
import { createLogWrapper } from '../../tools/utils.js';

/**
 * Direct function wrapper for expanding a task into subtasks with error handling.
 *
 * @param {Object} args - Command arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.id - The ID of the task to expand.
 * @param {number|string} [args.num] - Number of subtasks to generate.
 * @param {boolean} [args.research] - Enable research role for subtask generation.
 * @param {string} [args.prompt] - Additional context to guide subtask generation.
 * @param {boolean} [args.force] - Force expansion even if subtasks exist.
 * @param {string} [args.projectRoot] - Project root directory.
 * @param {Object} log - Logger object
 * @param {Object} context - Context object containing session
 * @param {Object} [context.session] - MCP Session object
 * @returns {Promise<Object>} - Task expansion result { success: boolean, data?: any, error?: { code: string, message: string } }
 */
export async function expandTaskDirect(args, log, context = {}) {
	const { session } = context; // Extract session
	// Destructure expected args, including projectRoot
	const { tasksJsonPath, id, num, research, prompt, force, projectRoot } = args;

	// Log session root data for debugging
	log.info(
		`Session data in expandTaskDirect: ${JSON.stringify({
			hasSession: !!session,
			sessionKeys: session ? Object.keys(session) : [],
			roots: session?.roots,
			rootsStr: JSON.stringify(session?.roots)
		})}`
	);

	// Check if tasksJsonPath was provided
	if (!tasksJsonPath) {
		log.error('expandTaskDirect called without tasksJsonPath');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'tasksJsonPath is required'
			}
		};
	}

	// Use provided path
	const tasksPath = tasksJsonPath;

	log.info(`[expandTaskDirect] Using tasksPath: ${tasksPath}`);

	// Validate task ID
	const taskId = id ? parseInt(id, 10) : null;
	if (!taskId) {
		log.error('Task ID is required');
		return {
			success: false,
			error: {
				code: 'INPUT_VALIDATION_ERROR',
				message: 'Task ID is required'
			}
		};
	}

	// Process other parameters
	const numSubtasks = num ? parseInt(num, 10) : undefined;
	const useResearch = research === true;
	const additionalContext = prompt || '';
	const forceFlag = force === true;

	try {
		log.info(
			`[expandTaskDirect] Expanding task ${taskId} into ${numSubtasks || 'default'} subtasks. Research: ${useResearch}, Force: ${forceFlag}`
		);

		// Read tasks data
		log.info(`[expandTaskDirect] Attempting to read JSON from: ${tasksPath}`);
		const data = readJSON(tasksPath);
		log.info(
			`[expandTaskDirect] Result of readJSON: ${data ? 'Data read successfully' : 'readJSON returned null or undefined'}`
		);

		if (!data || !data.tasks) {
			log.error(
				`[expandTaskDirect] readJSON failed or returned invalid data for path: ${tasksPath}`
			);
			return {
				success: false,
				error: {
					code: 'INVALID_TASKS_FILE',
					message: `No valid tasks found in ${tasksPath}. readJSON returned: ${JSON.stringify(data)}`
				}
			};
		}

		// Find the specific task
		log.info(`[expandTaskDirect] Searching for task ID ${taskId} in data`);
		const task = data.tasks.find((t) => t.id === taskId);
		log.info(`[expandTaskDirect] Task found: ${task ? 'Yes' : 'No'}`);

		if (!task) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Task with ID ${taskId} not found`
				}
			};
		}

		// Check if task is completed
		if (task.status === 'done' || task.status === 'completed') {
			return {
				success: false,
				error: {
					code: 'TASK_COMPLETED',
					message: `Task ${taskId} is already marked as ${task.status} and cannot be expanded`
				}
			};
		}

		// Check for existing subtasks and force flag
		const hasExistingSubtasks = task.subtasks && task.subtasks.length > 0;
		if (hasExistingSubtasks && !forceFlag) {
			log.info(
				`Task ${taskId} already has ${task.subtasks.length} subtasks. Use --force to overwrite.`
			);
			return {
				success: true,
				data: {
					message: `Task ${taskId} already has subtasks. Expansion skipped.`,
					task,
					subtasksAdded: 0,
					hasExistingSubtasks
				}
			};
		}

		// If force flag is set, clear existing subtasks
		if (hasExistingSubtasks && forceFlag) {
			log.info(
				`Force flag set. Clearing existing subtasks for task ${taskId}.`
			);
			task.subtasks = [];
		}

		// Keep a copy of the task before modification
		const originalTask = JSON.parse(JSON.stringify(task));

		// Tracking subtasks count before expansion
		const subtasksCountBefore = task.subtasks ? task.subtasks.length : 0;

		// Create a backup of the tasks.json file
		const backupPath = path.join(path.dirname(tasksPath), 'tasks.json.bak');
		fs.copyFileSync(tasksPath, backupPath);

		// Directly modify the data instead of calling the CLI function
		if (!task.subtasks) {
			task.subtasks = [];
		}

		// Save tasks.json with potentially empty subtasks array
		writeJSON(tasksPath, data);

		// Create logger wrapper using the utility
		const mcpLog = createLogWrapper(log);

		let wasSilent; // Declare wasSilent outside the try block
		// Process the request
		try {
			// Enable silent mode to prevent console logs from interfering with JSON response
			wasSilent = isSilentMode(); // Assign inside the try block
			if (!wasSilent) enableSilentMode();

			// Call the core expandTask function with the wrapped logger and projectRoot
			const coreResult = await expandTask(
				tasksPath,
				taskId,
				numSubtasks,
				useResearch,
				additionalContext,
				{
					mcpLog,
					session,
					projectRoot,
					commandName: 'expand-task',
					outputType: 'mcp'
				},
				forceFlag
			);

			// Restore normal logging
			if (!wasSilent && isSilentMode()) disableSilentMode();

			// Read the updated data
			const updatedData = readJSON(tasksPath);
			const updatedTask = updatedData.tasks.find((t) => t.id === taskId);

			// Calculate how many subtasks were added
			const subtasksAdded = updatedTask.subtasks
				? updatedTask.subtasks.length - subtasksCountBefore
				: 0;

			// Return the result, including telemetryData
			log.info(
				`Successfully expanded task ${taskId} with ${subtasksAdded} new subtasks`
			);
			return {
				success: true,
				data: {
					task: coreResult.task,
					subtasksAdded,
					hasExistingSubtasks,
					telemetryData: coreResult.telemetryData
				}
			};
		} catch (error) {
			// Make sure to restore normal logging even if there's an error
			if (!wasSilent && isSilentMode()) disableSilentMode();

			log.error(`Error expanding task: ${error.message}`);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message: error.message || 'Failed to expand task'
				}
			};
		}
	} catch (error) {
		log.error(`Error expanding task: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'CORE_FUNCTION_ERROR',
				message: error.message || 'Failed to expand task'
			}
		};
	}
}

/**
 * Initiates task expansion for delegated AI call (Phase 1).
 * Prepares context and returns an interactionId and AI request details.
 *
 * @param {Object} args - Command arguments.
 * @param {string} args.tasksJsonPath - Path to the tasks.json file.
 * @param {string} args.id - ID of the task to expand.
 * @param {number|string} [args.num] - Number of subtasks to generate.
 * @param {boolean} [args.research=false] - Enable research role.
 * @param {string} [args.prompt] - Additional context for expansion.
 * @param {string} args.projectRoot - Project root directory.
 * @param {Object} [args.clientContext] - Arbitrary client context.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with { interactionId, aiServiceRequest, clientContext } or error.
 */
export async function initiateExpandTaskDirect(args, log, context = {}) {
	const { session } = context;
	const {
		tasksJsonPath,
		id,
		num,
		research,
		prompt: additionalContextPrompt,
		projectRoot,
		clientContext
	} = args;

	const logWrapper = createLogWrapper(log);

	// Basic validation (tasksJsonPath, id, projectRoot are essential for this phase too)
	if (!tasksJsonPath || !id || !projectRoot) {
		logWrapper.error('tasksJsonPath, id, and projectRoot are required for initiateExpandTaskDirect.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'tasksJsonPath, id, and projectRoot are required.' }};
	}

	const taskId = parseInt(id, 10);
	if (isNaN(taskId)) {
		logWrapper.error('Invalid Task ID provided.');
		return { success: false, error: { code: 'INPUT_VALIDATION_ERROR', message: 'Valid Task ID is required.' }};
	}

	const numSubtasks = num ? parseInt(num, 10) : undefined;
	const useResearch = research === true;
	const additionalUserContext = additionalContextPrompt || '';

	// Note: File reading for task validation (e.g., if task exists, not completed)
	// is typically done in the core `expandTask`. For 'initiate', we might
	// defer some checks to the 'submit' phase or assume the caller ensures validity.
	// For now, minimal checks here, core `expandTask` will do more before AI call setup.
	// The `expandTask` function itself reads tasks.json, so we don't need to here for phase 1.

	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		const result = await expandTask(
			tasksJsonPath,
			taskId,
			numSubtasks,
			useResearch,
			additionalUserContext,
			{ // Core context for expandTask
				mcpLog: logWrapper,
				session,
				projectRoot,
				commandName: 'expand-task-initiate', // Distinguish command
				outputType: 'mcp',
				clientContext, // Pass through
				delegationPhase: 'initiate' // Correctly placed here
			},
			false // force flag - not relevant for initiate, but expandTask expects it
			// No 8th argument
		);

		if (result && result.interactionId && result.aiServiceRequest) {
			logWrapper.info(`Initiated task expansion. Interaction ID: ${result.interactionId}`);
			return { success: true, data: result };
		} else {
			logWrapper.error('initiateExpandTaskDirect: Core expandTask did not return expected initiation bundle.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to initiate task expansion.' }};
		}
	} catch (error) {
		logWrapper.error(`Error initiating task expansion: ${error.message}`);
		// If expandTask itself throws (e.g. task not found before trying to initiate), catch it.
		return { success: false, error: { code: 'INITIATE_EXPAND_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}

/**
 * Submits the AI's response for a previously initiated task expansion (Phase 2).
 * Processes the response, generates subtasks, and saves them.
 *
 * @param {Object} args - Command arguments.
 * @param {string} args.interactionId - The ID of the initiated interaction.
 * @param {string} args.rawLLMResponse - The raw text response from the LLM (JSON string of subtasks).
 * @param {Object} [args.llmUsageData] - Optional LLM usage data.
 * @param {string} args.tasksJsonPath - Path to the tasks.json file.
 * @param {string} args.id - ID of the parent task being expanded.
 * @param {string} args.projectRoot - Project root directory.
 * @param {boolean} [args.force=false] - Force expansion (relevant if original pre-check was bypassed).
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function submitExpandTaskResponseDirect(args, log, context = {}) {
	const { session } = context;
	const {
		interactionId,
		rawLLMResponse,
		llmUsageData,
		tasksJsonPath, // Path to tasks.json, needed for writing
		id,            // Parent task ID
		projectRoot,
		force = false  // Force flag might be relevant for file writing consistency
	} = args;

	const logWrapper = createLogWrapper(log);

	if (!interactionId || rawLLMResponse === undefined || !tasksJsonPath || !id || !projectRoot) {
		logWrapper.error('interactionId, rawLLMResponse, tasksJsonPath, id, and projectRoot are required for submitExpandTaskResponseDirect.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'Required arguments missing.' }};
	}

	const taskId = parseInt(id, 10);
	if (isNaN(taskId)) {
		logWrapper.error('Invalid Task ID provided for submission.');
		return { success: false, error: { code: 'INPUT_VALIDATION_ERROR', message: 'Valid Task ID is required for submission.' }};
	}

	// numSubtasks, useResearch, additionalContext are part of the stored interaction context.
	// The core expandTask will retrieve these via getInteractionContext() if needed by submitDelegatedTextResponseService,
	// or they are implicitly handled because the AI call is already done.

	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		// The core expandTask function handles reading tasks.json, finding the parent task,
		// parsing the rawLLMResponse, creating subtasks, and writing back to tasks.json.
		const result = await expandTask(
			tasksJsonPath,
			taskId,
			null, // numSubtasks - not used for prompt gen in submit, but original value might be in stored context
			false, // useResearch - similar to numSubtasks
			'',    // additionalContext - similar to numSubtasks
			{ // Core context for expandTask
				mcpLog: logWrapper,
				session,
				projectRoot,
				commandName: 'expand-task-submit', // Distinguish command
				outputType: 'mcp',
			},
			force, // Pass force flag for file operations consistency
			{ // Delegation context for expandTask
				delegationPhase: 'submit',
				interactionId,
				rawLLMResponse,
				llmUsageData,
			}
		);

		// expandTask in submit phase should return { task, telemetryData } after successful processing
		if (result && result.task && result.task.subtasks) {
			const subtasksAdded = result.task.subtasks.length; // Simplified, assumes all are new from this response
			logWrapper.info(`Successfully processed delegated task expansion for task ${taskId}. ${subtasksAdded} subtasks added.`);
			return {
				success: true,
				data: {
					task: result.task,
					subtasksAdded, // This might need more accurate calculation if appending to existing from prior submit etc.
					telemetryData: result.telemetryData,
				},
			};
		} else {
			logWrapper.error('submitExpandTaskResponseDirect: Core expandTask did not return a successful structure for submit phase.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to process submitted task expansion response.' }};
		}
	} catch (error) {
		logWrapper.error(`Error submitting task expansion response: ${error.message}`);
		return { success: false, error: { code: 'SUBMIT_EXPAND_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}
