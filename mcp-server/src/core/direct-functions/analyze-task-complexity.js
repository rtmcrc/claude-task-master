/**
 * Direct function wrapper for analyzeTaskComplexity
 */

import analyzeTaskComplexity from '../../../../scripts/modules/task-manager/analyze-task-complexity.js';
import {
	enableSilentMode,
	disableSilentMode,
	isSilentMode
} from '../../../../scripts/modules/utils.js';
import fs from 'fs';
import { createLogWrapper } from '../../tools/utils.js'; // Import the new utility

/**
 * Analyze task complexity and generate recommendations
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {string} args.outputPath - Explicit absolute path to save the report.
 * @param {string|number} [args.threshold] - Minimum complexity score to recommend expansion (1-10)
 * @param {boolean} [args.research] - Use Perplexity AI for research-backed complexity analysis
 * @param {string} [args.ids] - Comma-separated list of task IDs to analyze
 * @param {number} [args.from] - Starting task ID in a range to analyze
 * @param {number} [args.to] - Ending task ID in a range to analyze
 * @param {string} [args.projectRoot] - Project root path.
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Context object containing session data
 * @param {Object} [context.session] - MCP session object
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
export async function analyzeTaskComplexityDirect(args, log, context = {}) {
	const { session } = context;
	const {
		tasksJsonPath,
		outputPath,
		threshold,
		research,
		projectRoot,
		ids,
		from,
		to
	} = args;

	const logWrapper = createLogWrapper(log);

	// --- Initial Checks (remain the same) ---
	try {
		log.info(`Analyzing task complexity with args: ${JSON.stringify(args)}`);

		if (!tasksJsonPath) {
			log.error('analyzeTaskComplexityDirect called without tasksJsonPath');
			return {
				success: false,
				error: {
					code: 'MISSING_ARGUMENT',
					message: 'tasksJsonPath is required'
				}
			};
		}
		if (!outputPath) {
			log.error('analyzeTaskComplexityDirect called without outputPath');
			return {
				success: false,
				error: { code: 'MISSING_ARGUMENT', message: 'outputPath is required' }
			};
		}

		const tasksPath = tasksJsonPath;
		const resolvedOutputPath = outputPath;

		log.info(`Analyzing task complexity from: ${tasksPath}`);
		log.info(`Output report will be saved to: ${resolvedOutputPath}`);

		if (ids) {
			log.info(`Analyzing specific task IDs: ${ids}`);
		} else if (from || to) {
			const fromStr = from !== undefined ? from : 'first';
			const toStr = to !== undefined ? to : 'last';
			log.info(`Analyzing tasks in range: ${fromStr} to ${toStr}`);
		}

		if (research) {
			log.info('Using research role for complexity analysis');
		}

		// Prepare options for the core function - REMOVED mcpLog and session here
		const coreOptions = {
			file: tasksJsonPath,
			output: outputPath,
			threshold: threshold,
			research: research === true, // Ensure boolean
			projectRoot: projectRoot, // Pass projectRoot here
			id: ids, // Pass the ids parameter to the core function as 'id'
			from: from, // Pass from parameter
			to: to // Pass to parameter
		};
		// --- End Initial Checks ---

		// --- Silent Mode and Logger Wrapper ---
		const wasSilent = isSilentMode();
		if (!wasSilent) {
			enableSilentMode(); // Still enable silent mode as a backup
		}

		let report;
		let coreResult;

		try {
			// --- Call Core Function (Pass context separately) ---
			// Pass coreOptions as the first argument
			// Pass context object { session, mcpLog } as the second argument
			coreResult = await analyzeTaskComplexity(coreOptions, {
				session,
				mcpLog: logWrapper,
				commandName: 'analyze-complexity',
				outputType: 'mcp'
			});
			report = coreResult.report;
		} catch (error) {
			log.error(
				`Error in analyzeTaskComplexity core function: ${error.message}`
			);
			// Restore logging if we changed it
			if (!wasSilent && isSilentMode()) {
				disableSilentMode();
			}
			return {
				success: false,
				error: {
					code: 'ANALYZE_CORE_ERROR',
					message: `Error running core complexity analysis: ${error.message}`
				}
			};
		} finally {
			// Always restore normal logging in finally block if we enabled silent mode
			if (!wasSilent && isSilentMode()) {
				disableSilentMode();
			}
		}

		// --- Result Handling (remains largely the same) ---
		// Verify the report file was created (core function writes it)
		if (!fs.existsSync(resolvedOutputPath)) {
			return {
				success: false,
				error: {
					code: 'ANALYZE_REPORT_MISSING', // Specific code
					message:
						'Analysis completed but no report file was created at the expected path.'
				}
			};
		}

		if (
			!coreResult ||
			!coreResult.report ||
			typeof coreResult.report !== 'object'
		) {
			log.error(
				'Core analysis function returned an invalid or undefined response.'
			);
			return {
				success: false,
				error: {
					code: 'INVALID_CORE_RESPONSE',
					message: 'Core analysis function returned an invalid response.'
				}
			};
		}

		try {
			// Ensure complexityAnalysis exists and is an array
			const analysisArray = Array.isArray(coreResult.report.complexityAnalysis)
				? coreResult.report.complexityAnalysis
				: [];

			// Count tasks by complexity (remains the same)
			const highComplexityTasks = analysisArray.filter(
				(t) => t.complexityScore >= 8
			).length;
			const mediumComplexityTasks = analysisArray.filter(
				(t) => t.complexityScore >= 5 && t.complexityScore < 8
			).length;
			const lowComplexityTasks = analysisArray.filter(
				(t) => t.complexityScore < 5
			).length;

			return {
				success: true,
				data: {
					message: `Task complexity analysis complete. Report saved to ${outputPath}`,
					reportPath: outputPath,
					reportSummary: {
						taskCount: analysisArray.length,
						highComplexityTasks,
						mediumComplexityTasks,
						lowComplexityTasks
					},
					fullReport: coreResult.report,
					telemetryData: coreResult.telemetryData
				}
			};
		} catch (parseError) {
			// Should not happen if core function returns object, but good safety check
			log.error(`Internal error processing report data: ${parseError.message}`);
			return {
				success: false,
				error: {
					code: 'REPORT_PROCESS_ERROR',
					message: `Internal error processing complexity report: ${parseError.message}`
				}
			};
		}
		// --- End Result Handling ---
	} catch (error) {
		// Catch errors from initial checks or path resolution
		// Make sure to restore normal logging if silent mode was enabled
		if (isSilentMode()) {
			disableSilentMode();
		}
		log.error(`Error in analyzeTaskComplexityDirect setup: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'DIRECT_FUNCTION_SETUP_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Initiates task complexity analysis for delegated AI call (Phase 1).
 * Prepares context and returns an interactionId and AI request details.
 * @param {Object} args - Function arguments
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file.
 * @param {boolean} [args.research] - Use Perplexity AI for research-backed complexity analysis
 * @param {string} [args.ids] - Comma-separated list of task IDs to analyze
 * @param {number} [args.from] - Starting task ID in a range to analyze
 * @param {number} [args.to] - Ending task ID in a range to analyze
 * @param {string} [args.projectRoot] - Project root path.
 * @param {Object} [args.clientContext] - Arbitrary client context.
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Context object containing session data
 * @returns {Promise<Object>} - Result object with { interactionId, aiServiceRequest, clientContext } or error.
 */
export async function initiateAnalyzeTaskComplexityDirect(args, log, context = {}) {
	const { session } = context;
	const {
		tasksJsonPath,
		research,
		projectRoot,
		ids,
		from,
		to,
		clientContext
	} = args;

	const logWrapper = createLogWrapper(log);

	if (!tasksJsonPath || !projectRoot) {
		logWrapper.error('tasksJsonPath and projectRoot are required for initiateAnalyzeTaskComplexityDirect.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'tasksJsonPath and projectRoot are required.' }};
	}

	// outputPath and threshold are not strictly needed for 'initiate' phase's AI call,
	// but analyzeTaskComplexity core function expects them in options.
	// Provide nominal or default values.
	const coreOptions = {
		file: tasksJsonPath,
		output: projectRoot ? `${projectRoot}/.taskmaster/reports/temp-complexity-report.json` : 'temp-complexity-report.json', // Nominal
		threshold: '5', // Default or nominal
		research: research === true,
		projectRoot: projectRoot,
		id: ids,
		from: from,
		to: to
	};

	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		const result = await analyzeTaskComplexity(coreOptions, {
			session,
			mcpLog: logWrapper,
			commandName: 'analyze-complexity-initiate',
			outputType: 'mcp',
			clientContext, // Pass through
			delegationPhase: 'initiate'
		});

		if (result && result.interactionId && result.aiServiceRequest) {
			logWrapper.info(`Initiated complexity analysis. Interaction ID: ${result.interactionId}`);
			return { success: true, data: result };
		} else {
			logWrapper.error('initiateAnalyzeTaskComplexityDirect: Core analyzeTaskComplexity did not return expected initiation bundle.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to initiate complexity analysis.' }};
		}
	} catch (error) {
		logWrapper.error(`Error initiating complexity analysis: ${error.message}`);
		return { success: false, error: { code: 'INITIATE_ANALYZE_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}


/**
 * Submits the AI's response for a previously initiated complexity analysis (Phase 2).
 * Processes the response and generates the complexity report.
 * @param {Object} args - Function arguments
 * @param {string} args.interactionId - The ID of the initiated interaction.
 * @param {string} args.rawLLMResponse - The raw text response from the LLM (JSON string of analysis).
 * @param {Object} [args.llmUsageData] - Optional LLM usage data.
 * @param {string} args.tasksJsonPath - Explicit path to the tasks.json file (for context, task data).
 * @param {string} args.outputPath - Explicit absolute path to save the report.
 * @param {string|number} [args.threshold] - Minimum complexity score (used in report generation).
 * @param {string} [args.projectRoot] - Project root path.
 * @param {string} [args.ids] - Comma-separated list of task IDs (context for report).
 * @param {number} [args.from] - Starting task ID (context for report).
 * @param {number} [args.to] - Ending task ID (context for report).
 * @param {Object} log - Logger object
 * @param {Object} [context={}] - Context object containing session data
 * @returns {Promise<Object>} - Result object with success status and data/error information.
 */
export async function submitAnalyzeTaskComplexityResponseDirect(args, log, context = {}) {
	const { session } = context;
	const {
		interactionId,
		rawLLMResponse,
		llmUsageData,
		tasksJsonPath,
		outputPath,
		threshold,
		projectRoot,
		ids,
		from,
		to
		// research flag is part of the stored interaction context from phase 1
	} = args;

	const logWrapper = createLogWrapper(log);

	if (!interactionId || rawLLMResponse === undefined || !tasksJsonPath || !outputPath || !projectRoot) {
		logWrapper.error('interactionId, rawLLMResponse, tasksJsonPath, outputPath, and projectRoot are required.');
		return { success: false, error: { code: 'MISSING_ARGUMENT', message: 'Required arguments missing for submission.' }};
	}

	// research, original prompt context are part of stored interaction context.
	// coreOptions here are for file paths and report generation parameters.
	const coreOptions = {
		file: tasksJsonPath,
		output: outputPath,
		threshold: threshold,
		projectRoot: projectRoot,
		id: ids,
		from: from,
		to: to
		// research will be retrieved from stored context if needed by core for report metadata
	};

	const wasSilent = isSilentMode();
	if (!wasSilent) enableSilentMode();

	try {
		const result = await analyzeTaskComplexity(coreOptions, {
			session,
			mcpLog: logWrapper,
			commandName: 'analyze-complexity-submit',
			outputType: 'mcp',
			delegationPhase: 'submit',
			interactionId,
			rawLLMResponse,
			llmUsageData
		});

		// analyzeTaskComplexity in submit phase should return { report, telemetryData }
		if (result && result.report) {
			logWrapper.info(`Successfully processed delegated complexity analysis. Report saved to ${outputPath}`);
			// Reconstruct the data structure expected by the original analyzeTaskComplexityDirect caller
			const analysisArray = Array.isArray(result.report.complexityAnalysis) ? result.report.complexityAnalysis : [];
			const highComplexityTasks = analysisArray.filter(t => t.complexityScore >= 8).length;
			const mediumComplexityTasks = analysisArray.filter(t => t.complexityScore >= 5 && t.complexityScore < 8).length;
			const lowComplexityTasks = analysisArray.filter(t => t.complexityScore < 5).length;

			return {
				success: true,
				data: {
					message: `Task complexity analysis complete. Report saved to ${outputPath}`,
					reportPath: outputPath,
					reportSummary: {
						taskCount: analysisArray.length,
						highComplexityTasks,
						mediumComplexityTasks,
						lowComplexityTasks
					},
					fullReport: result.report,
					telemetryData: result.telemetryData
				}
			};
		} else {
			logWrapper.error('submitAnalyzeTaskComplexityResponseDirect: Core analyzeTaskComplexity did not return a successful structure for submit phase.');
			return { success: false, error: { code: 'CORE_FUNCTION_ERROR', message: 'Failed to process submitted complexity analysis response.' }};
		}
	} catch (error) {
		logWrapper.error(`Error submitting complexity analysis response: ${error.message}`);
		return { success: false, error: { code: 'SUBMIT_ANALYZE_ERROR', message: error.message }};
	} finally {
		if (!wasSilent && isSilentMode()) disableSilentMode();
	}
}
