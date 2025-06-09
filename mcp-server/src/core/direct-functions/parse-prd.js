/**
 * parse-prd.js
 * Direct function implementation for parsing PRD documents
 */

import path from 'path';
import fs from 'fs';
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

	let numTasks = getDefaultNumTasks(projectRoot);
	if (numTasksArg) {
		numTasks =
			typeof numTasksArg === 'string' ? parseInt(numTasksArg, 10) : numTasksArg;
		if (Number.isNaN(numTasks) || numTasks <= 0) {
			// Ensure positive number
			numTasks = getDefaultNumTasks(projectRoot); // Fallback to default if parsing fails or invalid
			logWrapper.warn(
				`Invalid numTasks value: ${numTasksArg}. Using default: ${numTasks}`
			);
		}
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

		// Adjust check for the new return structure
		if (result && result.success) {
			const successMsg = `Successfully parsed PRD and generated tasks in ${result.tasksPath}`;
			logWrapper.success(successMsg);
			return {
				success: true,
				data: {
					message: successMsg,
					outputPath: result.tasksPath,
					telemetryData: result.telemetryData
				}
			};
		} else {
			// Handle case where core function didn't return expected success structure
			logWrapper.error(
				'Core parsePRD function did not return a successful structure.'
			);
			return {
				success: false,
				error: {
					code: 'CORE_FUNCTION_ERROR',
					message:
						result?.message ||
						'Core function failed to parse PRD or returned unexpected result.'
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

/**
 * Initiates the PRD parsing process for delegated AI call (Phase 1).
 * Reads PRD, prepares prompts, and returns an interactionId and AI request details.
 *
 * @param {Object} args - Command arguments.
 * @param {string} args.projectRoot - Absolute path to the project root.
 * @param {string} [args.input] - Path to the PRD file (relative to projectRoot or absolute).
 * @param {string} [args.prdContent] - Direct content of the PRD.
 * @param {number} [args.numTasks] - Approximate number of tasks to generate.
 * @param {boolean} [args.research=false] - Whether to use research-enhanced mode.
 * @param {Object} [args.clientContext] - Arbitrary client context to be passed through.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with { interactionId, aiServiceRequest, clientContext } or error.
 */
export async function initiateParsePRDDirect(args, log, context = {}) {
	const { session } = context;
	const {
		projectRoot,
		input: inputArg,
		prdContent, // New: direct content
		numTasks: numTasksArg,
		research = false,
		clientContext // New: client context
	} = args;

	const logWrapper = createLogWrapper(log);

	if (!projectRoot) {
		logWrapper.error('initiateParsePRDDirect requires a projectRoot argument.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'projectRoot is required.' }};
	}
	if (!inputArg && !prdContent) {
		logWrapper.error('initiateParsePRDDirect requires either an input path (input) or direct PRD content (prdContent).');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'PRD input or content is required.' }};
	}
	if (inputArg && prdContent) {
		logWrapper.warn('Both input path and prdContent provided to initiateParsePRDDirect. prdContent will be used.');
	}

	let resolvedPrdPath = 'direct_content'; // Default for logging if content is provided
	let actualPrdContent = prdContent;

	if (!actualPrdContent && inputArg) {
		try {
			resolvedPrdPath = resolvePrdPath({ input: inputArg, projectRoot }, session);
			if (!fs.existsSync(resolvedPrdPath)) {
				const errorMsg = `Input PRD file not found at resolved path: ${resolvedPrdPath}`;
				logWrapper.error(errorMsg);
				return { success: false, error: { code: 'FILE_NOT_FOUND', message: errorMsg }};
			}
			actualPrdContent = fs.readFileSync(resolvedPrdPath, 'utf8');
		} catch (error) {
			logWrapper.error(`Error resolving or reading PRD path ${inputArg}: ${error.message}`);
			return { success: false, error: { code: 'FILE_ERROR', message: error.message }};
		}
	}

	if (!actualPrdContent) { // Should be caught earlier, but as a safeguard
		logWrapper.error('No PRD content available for processing.');
		return { success: false, error: { code: 'MISSING_CONTENT', message: 'PRD content is empty or could not be read.' }};
	}

	let numTasks = getDefaultNumTasks(projectRoot);
	if (numTasksArg) {
		numTasks = typeof numTasksArg === 'string' ? parseInt(numTasksArg, 10) : numTasksArg;
		if (Number.isNaN(numTasks) || numTasks <= 0) {
			numTasks = getDefaultNumTasks(projectRoot);
			logWrapper.warn(`Invalid numTasks value: ${numTasksArg}. Using default: ${numTasks}`);
		}
	}

	// outputPath and file operations like append/force are not relevant for 'initiate' phase.
	// The actual tasksPath will be needed for the 'submit' phase.
	// For 'initiate', we might not even need a valid tasksPath yet, but parsePRD expects it.
	// Let's provide a nominal one; it won't be written to in this phase.
	const nominalTasksPath = path.join(projectRoot, '.taskmaster', 'temp_prd_initiate_tasks.json');


	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		// The core parsePRD needs prdPath for metadata, even if content is directly supplied.
		// We pass actualPrdContent via options to avoid re-reading if already loaded.
		const result = await parsePRD(
			resolvedPrdPath, // Path for metadata, even if content is direct
			nominalTasksPath,  // Nominal path, not written in this phase
			numTasks,
			{ // Options for parsePRD
				session,
				mcpLog: logWrapper,
				projectRoot,
				research,
				prdContent: actualPrdContent, // Pass direct content here
				clientContext, // Pass through client context
				// 'force' and 'append' are not relevant for 'initiate'
			},
			{ // Context for parsePRD
				delegationPhase: 'initiate',
				// No interactionId, rawLLMResponse, llmUsageData for initiate
			}
		);
		// Expecting { interactionId, aiServiceRequest, clientContext }
		if (result && result.interactionId && result.aiServiceRequest) {
			logWrapper.info(`Initiated PRD parsing. Interaction ID: ${result.interactionId}`);
			return { success: true, data: result };
		} else {
			logWrapper.error('initiateParsePRDDirect: Core parsePRD did not return expected initiation bundle.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to initiate PRD parsing.' }};
		}
	} catch (error) {
		logWrapper.error(`Error initiating PRD parsing: ${error.message}`);
		return { success: false, error: { code: 'INITIATE_PRD_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}


/**
 * Submits the AI's response for a previously initiated PRD parsing (Phase 2).
 * Processes the response, generates tasks, and saves them.
 *
 * @param {Object} args - Command arguments.
 * @param {string} args.interactionId - The ID of the initiated interaction.
 * @param {string|Object} args.rawLLMResponse - The raw response from the LLM.
 * @param {Object} [args.llmUsageData] - Optional LLM usage data.
 * @param {string} args.projectRoot - Absolute path to the project root.
 * @param {string} [args.output] - Path to save the tasks.json file (relative or absolute).
 * @param {boolean} [args.force=false] - Overwrite tasks.json if it exists.
 * @param {boolean} [args.append=false] - Append to existing tasks.json.
 * @param {Object} log - Logger object.
 * @param {Object} context - Context object containing session data.
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function submitParsePRDResponseDirect(args, log, context = {}) {
	const { session } = context;
	const {
		interactionId,
		rawLLMResponse,
		llmUsageData,
		projectRoot,
		output: outputArg,
		force = false,
		append = false,
		// research and numTasks are part of the stored interaction context, not resubmitted here.
	} = args;

	const logWrapper = createLogWrapper(log);

	if (!interactionId) {
		logWrapper.error('submitParsePRDResponseDirect requires an interactionId.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'interactionId is required.' }};
	}
	if (rawLLMResponse === undefined) {
		logWrapper.error('submitParsePRDResponseDirect requires rawLLMResponse.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'rawLLMResponse is required.' }};
	}
	if (!projectRoot) {
		logWrapper.error('submitParsePRDResponseDirect requires a projectRoot argument.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'projectRoot is required.' }};
	}

	// Resolve output path
	const outputPath = outputArg
		? path.isAbsolute(outputArg)
			? outputArg
			: path.resolve(projectRoot, outputArg)
		: resolveProjectPath(TASKMASTER_TASKS_FILE, { projectRoot }) || // Ensure projectRoot is passed for default resolution
			path.resolve(projectRoot, TASKMASTER_TASKS_FILE);

	const outputDir = path.dirname(outputPath);
	try {
		if (!fs.existsSync(outputDir)) {
			logWrapper.info(`Creating output directory: ${outputDir}`);
			fs.mkdirSync(outputDir, { recursive: true });
		}
	} catch (error) {
		const errorMsg = `Failed to create output directory ${outputDir}: ${error.message}`;
		logWrapper.error(errorMsg);
		return { success: false, error: { code: 'DIRECTORY_CREATE_FAILED', message: errorMsg }};
	}

	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		// prdPath, numTasks, research are part of the stored interaction context.
		// The core parsePRD function will retrieve these via getInteractionContext()
		// when submitDelegatedObjectResponseService is called.
		// However, parsePRD itself needs some nominal prdPath and numTasks for its signature,
		// but they won't be used for prompt generation in the 'submit' phase.
		// The actual PRD content/path used for prompt generation was handled in 'initiate'.
		// tasksPath (outputPath here) IS used.
		const result = await parsePRD(
			'delegated_submission', // Nominal prdPath, not used for prompt generation in submit phase
			outputPath,
			0, // Nominal numTasks, not used for prompt generation in submit phase
			{ // Options for parsePRD
				session,
				mcpLog: logWrapper,
				projectRoot,
				force, // Pass through force/append for file writing
				append,
				// research is part of stored context
				commandName: 'parse-prd-submit', // Distinguish command if needed
				outputType: 'mcp',
			},
			{ // Context for parsePRD
				delegationPhase: 'submit',
				interactionId,
				rawLLMResponse,
				llmUsageData,
			}
		);

		if (result && result.success) {
			const successMsg = `Successfully processed delegated PRD response and generated tasks in ${result.tasksPath}`;
			logWrapper.success(successMsg);
			return {
				success: true,
				data: {
					message: successMsg,
					outputPath: result.tasksPath,
					telemetryData: result.telemetryData,
				},
			};
		} else {
			logWrapper.error('submitParsePRDResponseDirect: Core parsePRD did not return a successful structure for submit phase.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to process submitted PRD response.' }};
		}

	} catch (error) {
		logWrapper.error(`Error submitting PRD response: ${error.message}`);
		return { success: false, error: { code: 'SUBMIT_PRD_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}
