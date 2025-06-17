/**
 * update-tasks.js
 * Direct function implementation for updating tasks based on new context
 */

import path from 'path';
import { updateTasks } from '../../../../scripts/modules/task-manager.js';
import { createLogWrapper } from '../../tools/utils.js';
import {
	enableSilentMode,
	disableSilentMode
} from '../../../../scripts/modules/utils.js';

/**
 * Direct function wrapper for updating tasks based on new context.
 *
 * @param {Object} args - Command arguments containing projectRoot, from, prompt, research options.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function updateTasksDirect(args, log, context = {}) {
	const { session } = context;
	const { from, prompt, research, tasksJsonPath, projectRoot } = args;

	// Create the standard logger wrapper
	const logWrapper = createLogWrapper(log);

	// --- Input Validation ---
	if (!projectRoot) {
		logWrapper.error('updateTasksDirect requires a projectRoot argument.');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'projectRoot is required.'
			}
		};
	}

	if (!from) {
		logWrapper.error('updateTasksDirect called without from ID');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'Starting task ID (from) is required'
			}
		};
	}

	if (!prompt) {
		logWrapper.error('updateTasksDirect called without prompt');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'Update prompt is required'
			}
		};
	}

	logWrapper.info(
		`Updating tasks via direct function. From: ${from}, Research: ${research}, File: ${tasksJsonPath}, ProjectRoot: ${projectRoot}`
	);

	enableSilentMode(); // Enable silent mode
	try {
		// Call the core updateTasks function
		const result = await updateTasks(
			tasksJsonPath,
			from,
			prompt,
			research,
			{
				session,
				mcpLog: logWrapper,
				projectRoot
			},
			'json'
		);

		// New handling logic based on needsAgentDelegation
		if (result && result.needsAgentDelegation === true) {
			logWrapper.info('updateTasks signaled needsAgentDelegation. Propagating this structure.');
			// The result object is { needsAgentDelegation: true, pendingInteraction: ..., success: true }
			// This is now considered a "successful" outcome for updateTasksDirect, to be handled by the calling tool.
			return result;
		} else if (result && result.success && Array.isArray(result.updatedTasks)) {
			// This is the normal success path (no delegation)
			logWrapper.success(
				`Successfully updated ${result.updatedTasks.length} tasks.`
			);
			return {
				success: true,
				data: {
					message: `Successfully updated ${result.updatedTasks.length} tasks.`,
					tasksPath: tasksJsonPath,
					updatedCount: result.updatedTasks.length,
					telemetryData: result.telemetryData // Ensure telemetryData is passed through
				}
			};
		} else {
			// Handle core function errors or unexpected results when not a delegation
			logWrapper.error(
				'Core updateTasks function did not return a successful structure or signal agent delegation.'
			);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message:
						result?.message || // Use message from result if available
						'Core function failed to update tasks or returned an unexpected structure.'
				}
			};
		}
	} catch (error) {
		// This catch block handles errors thrown by updateTasks itself (e.g., file read errors, critical issues)
		// or errors thrown by the new delegation logic if isMCP is false.
		logWrapper.error(`Error executing core updateTasks or processing its result: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'UPDATE_TASKS_CORE_ERROR',
				message: error.message || 'Unknown error updating tasks'
			}
		};
	} finally {
		disableSilentMode(); // Ensure silent mode is disabled
	}
}
