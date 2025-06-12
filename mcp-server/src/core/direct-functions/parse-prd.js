/**
 * parse-prd.js
 * Direct function implementation for parsing PRD documents
 */

import path from 'path';
import fs from 'fs';
// Add these if not already present, adjust paths as necessary
import { writeJSON } from '../../../../scripts/modules/utils.js';
import generateTaskFiles from '../../../../scripts/modules/task-manager/generate-task-files.js';
import { parsePRD } from '../../../../scripts/modules/task-manager.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import { createLogWrapper } from '../../tools/utils.js';
import { getDefaultNumTasks } from '../../../../scripts/modules/config-manager.js';
import { resolvePrdPath, resolveProjectPath } from '../utils/path-utils.js';
import { TASKMASTER_TASKS_FILE } from '../../../../src/constants/paths.js';

/**
 * Direct function wrapper for parsing PRD documents and generating tasks.
 *
 * @param {Object} args - Command arguments containing projectRoot, input, output, numTasks options.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function parsePRDDirect(args, log, context = {}) {
	const { session } = context;
	// Extract projectRoot from args
	const {
		input: inputArg,
		output: outputArg,
		numTasks: numTasksArg,
		force,
		append,
		research,
		projectRoot
	} = args;

	// Create the standard logger wrapper
	const logWrapper = createLogWrapper(log);

	// --- Input Validation and Path Resolution ---
	if (!projectRoot) {
		logWrapper.error('parsePRDDirect requires a projectRoot argument.');
		return {
			success: false,
			error: {
				code: 'MISSING_ARGUMENT',
				message: 'projectRoot is required.'
			}
		};
	}

	// Resolve input path using path utilities
	let inputPath;
	if (inputArg) {
		try {
			inputPath = resolvePrdPath({ input: inputArg, projectRoot }, session);
		} catch (error) {
			logWrapper.error(`Error resolving PRD path: ${error.message}`);
			return {
				success: false,
				error: { code: 'FILE_NOT_FOUND', message: error.message }
			};
		}
	} else {
		logWrapper.error('parsePRDDirect called without input path');
		return {
			success: false,
			error: { code: 'MISSING_ARGUMENT', message: 'Input path is required' }
		};
	}

	// Resolve output path - use new path utilities for default
	const outputPath = outputArg
		? path.isAbsolute(outputArg)
			? outputArg
			: path.resolve(projectRoot, outputArg)
		: resolveProjectPath(TASKMASTER_TASKS_FILE, args) ||
			path.resolve(projectRoot, TASKMASTER_TASKS_FILE);

	// Check if input file exists
	if (!fs.existsSync(inputPath)) {
		const errorMsg = `Input PRD file not found at resolved path: ${inputPath}`;
		logWrapper.error(errorMsg);
		return {
			success: false,
			error: { code: 'FILE_NOT_FOUND', message: errorMsg }
		};
	}

	const outputDir = path.dirname(outputPath);
	try {
		if (!fs.existsSync(outputDir)) {
			logWrapper.info(`Creating output directory: ${outputDir}`);
			fs.mkdirSync(outputDir, { recursive: true });
		}
	} catch (error) {
		const errorMsg = `Failed to create output directory ${outputDir}: ${error.message}`;
		logWrapper.error(errorMsg);
		return {
			success: false,
			error: { code: 'DIRECTORY_CREATE_FAILED', message: errorMsg }
		};
	}

	// Initialize numTasks with the default value first.
	let numTasks = getDefaultNumTasks(projectRoot); // Ensures numTasks always has a starting value.

	// Check if numTasksArg was actually provided and is not an empty string
	if (numTasksArg !== undefined && numTasksArg !== null && String(numTasksArg).trim() !== '') {
		const parsedNumTasksArg = parseInt(String(numTasksArg), 10); // Ensure it's treated as string then parsed

		if (!Number.isNaN(parsedNumTasksArg) && parsedNumTasksArg > 0) {
			numTasks = parsedNumTasksArg; // Override with valid provided value
			logWrapper.info(`Using numTasks provided by argument: ${numTasks}`);
		} else {
			// Log a warning if parsing failed or value was invalid, but numTasks already holds the default.
			logWrapper.warn(`Invalid numTasks value provided: '${numTasksArg}'. Using default value: ${numTasks}`);
		}
	} else {
		// Log that default is being used if no argument was provided
		logWrapper.info(`numTasks argument not provided or empty. Using default value: ${numTasks}`);
	}

	if (append) {
		logWrapper.info('Append mode enabled.');
		if (force) {
			logWrapper.warn(
				'Both --force and --append flags were provided. --force takes precedence; append mode will be ignored.'
			);
		}
	}

	if (research) {
		logWrapper.info(
			'Research mode enabled. Using Perplexity AI for enhanced PRD analysis.'
		);
	}

	logWrapper.info(
		`Parsing PRD via direct function. Input: ${inputPath}, Output: ${outputPath}, NumTasks: ${numTasks}, Force: ${force}, Append: ${append}, Research: ${research}, ProjectRoot: ${projectRoot}`
	);

	const wasSilent = isSilentMode();
	if (!wasSilent) {
		enableSilentMode();
	}

	try {
		// Call the core parsePRD function
		const result = await parsePRD(
			inputPath,
			outputPath,
			numTasks,
			{
				session,
				mcpLog: logWrapper,
				projectRoot,
				force,
				append,
				research,
				commandName: 'parse-prd',
				outputType: 'mcp'
			},
			'json'
		);

		logWrapper.info(`parsePRDDirect: Resumed from await parsePRD. Result type: ${typeof result}`);
		if (result && typeof result === 'object') {
			logWrapper.info(`parsePRDDirect: Result keys: ${Object.keys(result).join(', ')}`);
			logWrapper.info(`parsePRDDirect: result.tasks is array: ${Array.isArray(result.tasks)}`);
			logWrapper.info(`parsePRDDirect: result.metadata is object: ${typeof result.metadata === 'object' && result.metadata !== null}`);
			logWrapper.info(`parsePRDDirect: result.needsAgentDelegation value: ${result.needsAgentDelegation}`);
			logWrapper.info(`parsePRDDirect: result.success value: ${result.success}`);
			// Optionally, log a snippet of the result if the above isn't detailed enough for diagnosis
			// logWrapper.info(`parsePRDDirect: Resumed result (snippet): ${JSON.stringify(result, null, 2)?.substring(0, 500)}`);
		} else {
			logWrapper.info(`parsePRDDirect: Resumed result is not an object or is null: ${JSON.stringify(result)}`);
		}

		// === NEW MODIFICATION START ===
		// New condition for handling resumed agent data:
		// Check if 'result' looks like the tasks object from the agent
		// (e.g., has 'tasks' and 'metadata' properties, and is NOT a delegation signal itself,
		// and NOT the original success object from a non-delegated parsePRD call).
		logWrapper.info("parsePRDDirect: Evaluating condition for agent data handling...");
		if (result && Array.isArray(result.tasks) && result.metadata &&
			result.needsAgentDelegation !== true && typeof result.success === 'undefined') { // START OF IF BLOCK

			logWrapper.info("parsePRDDirect: Condition MET for agent data handling. Proceeding to save tasks.");
			// The line below was redundant and part of the previous error, removed by this correction.
			// logWrapper.info(`parsePRDDirect: Resumed from agent delegation. Received tasks data. Saving to ${outputPath}`);

			const agentTasks = result.tasks;
			// The 'outputData' should be an object with a 'tasks' key, similar to how parsePRD (from task-manager) saves it.
			const outputData = { tasks: agentTasks };

			try {
				writeJSON(outputPath, outputData); // writeJSON is from scripts/modules/utils.js
				logWrapper.info(`Tasks from agent successfully written to ${outputPath}`);

				// Call generateTaskFiles, similar to how scripts/modules/task-manager/parse-prd.js does it
				await generateTaskFiles(outputPath, path.dirname(outputPath), { mcpLog: logWrapper });
				logWrapper.info(`Markdown task files generated for tasks from agent.`);

				const successMsg = `Successfully parsed PRD (via agent) and generated tasks in ${outputPath}`;
				logWrapper.success(successMsg);
				return {
					success: true,
					data: {
						message: successMsg,
						outputPath: outputPath
						// metadata: result.metadata // Optionally include metadata if useful for the return
					}
				};
			} catch (saveError) {
				logWrapper.error(`Error saving tasks from agent or generating markdown: ${saveError.message}`);
				return {
					success: false,
					error: {
						code: 'AGENT_DATA_SAVE_FAILED',
						message: `Failed to save tasks received from agent: ${saveError.message}`
					}
				};
			}
		} // END OF IF BLOCK
		// Existing logic follows
		else if (result && result.needsAgentDelegation === true) {
			logWrapper.info("parsePRDDirect: Evaluating condition for needsAgentDelegation..."); // Moved before else if
			// ... (existing code for propagating delegation signal)
			logWrapper.info('parsePRDDirect: Propagating agent_llm_delegation signal.'); // Keep this log
			return result;
		}
		// Check for direct success (no delegation involved)
		else if (result && result.success === true) {
			logWrapper.info("parsePRDDirect: Evaluating condition for direct success..."); // Moved before else if
			// ... (existing code for direct success)
			const successMsg = `Successfully parsed PRD and generated tasks in ${result.tasksPath}`; // Keep this log
			logWrapper.success(successMsg);
			return {
				success: true,
				data: {
					message: successMsg,
					outputPath: result.tasksPath,
					telemetryData: result.telemetryData
				}
			};
		}
		// Fallback error case
		else {
			logWrapper.info("parsePRDDirect: None of the primary conditions met, evaluating final else (error) block.");// Moved before else
			// ... (existing code for error)
			logWrapper.error('Core parsePRD function did not return a successful structure and was not an agent delegation or recognized agent data.');
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message: result?.message || 'Core function failed to parse PRD or returned unexpected result.'
				}
			};
		}
	} catch (error) {
		logWrapper.error(`Error executing core parsePRD: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'PARSE_PRD_CORE_ERROR',
				message: error.message || 'Unknown error parsing PRD'
			}
		};
	} finally {
		if (!wasSilent && isSilentMode()) {
			disableSilentMode();
		}
	}
}
