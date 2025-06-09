/**
 * tools/analyze.js
 * Tool for analyzing task complexity and generating recommendations
 */

import { z } from 'zod';
import path from 'path';
import fs from 'fs'; // Import fs for directory check/creation
import {
	handleApiResult,
	createErrorResponse,
	withNormalizedProjectRoot
} from './utils.js';
import {
	analyzeTaskComplexityDirect,
	initiateAnalyzeTaskComplexityDirect,
	submitAnalyzeTaskComplexityResponseDirect
} from '../core/task-master-core.js';
import { findTasksPath } from '../core/utils/path-utils.js';
import { COMPLEXITY_REPORT_FILE } from '../../../src/constants/paths.js';

/**
 * Register the analyze_project_complexity tool
 * @param {Object} server - FastMCP server instance
 */
export function registerAnalyzeProjectComplexityTool(server) {
	server.addTool({
		name: 'analyze_project_complexity',
		description:
			'Analyze task complexity and generate expansion recommendations.',
		parameters: z.object({
			threshold: z.coerce // Use coerce for number conversion from string if needed
				.number()
				.int()
				.min(1)
				.max(10)
				.optional()
				.default(5) // Default threshold
				.describe('Complexity score threshold (1-10) to recommend expansion.'),
			research: z
				.boolean()
				.optional()
				.default(false)
				.describe('Use Perplexity AI for research-backed analysis.'),
			output: z
				.string()
				.optional()
				.describe(
					`Output file path relative to project root (default: ${COMPLEXITY_REPORT_FILE}).`
				),
			file: z
				.string()
				.optional()
				.describe(
					'Path to the tasks file relative to project root (default: tasks/tasks.json).'
				),
			ids: z
				.string()
				.optional()
				.describe(
					'Comma-separated list of task IDs to analyze specifically (e.g., "1,3,5").'
				),
			from: z.coerce
				.number()
				.int()
				.positive()
				.optional()
				.describe('Starting task ID in a range to analyze.'),
			to: z.coerce
				.number()
				.int()
				.positive()
				.optional()
				.describe('Ending task ID in a range to analyze.'),
			projectRoot: z
				.string()
				.describe('The directory of the project. Must be an absolute path.')
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			const toolName = 'analyze_project_complexity';
			try {
				log.info(`Executing ${toolName} tool with args: ${JSON.stringify(args)}`);
				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.file }, log);
				} catch (error) {
					return createErrorResponse(`Failed to find tasks.json: ${error.message}`);
				}
				const outputPath = args.output ? path.resolve(args.projectRoot, args.output) : path.resolve(args.projectRoot, COMPLEXITY_REPORT_FILE);
				const outputDir = path.dirname(outputPath);
				if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

				const directArgs = { ...args, tasksJsonPath, outputPath };
				const result = await analyzeTaskComplexityDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error analyzing task complexity');
			} catch (error) {
				return createErrorResponse(`Internal tool error (${toolName}): ${error.message}`);
			}
		})
	});

	server.addTool({
		name: 'initiateDelegatedAnalyzeTaskComplexity',
		description: 'Initiates a delegated task complexity analysis. Returns prompts and an interaction ID.',
		parameters: z.object({
			projectRoot: z.string().describe("Absolute path to the project."),
			file: z.string().optional().describe("Path to the tasks file relative to project root."),
			ids: z.string().optional().describe("Comma-separated list of task IDs to analyze."),
			from: z.coerce.number().int().positive().optional().describe("Starting task ID in a range."),
			to: z.coerce.number().int().positive().optional().describe("Ending task ID in a range."),
			research: z.boolean().optional().default(false).describe("Use research role for analysis."),
			clientContext: z.any().optional().describe("Optional client context to be echoed.")
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			const toolName = 'initiateDelegatedAnalyzeTaskComplexity';
			try {
				let tasksJsonPath;
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.file }, log);
				} catch (error) {
					return createErrorResponse(`Failed to find tasks.json: ${error.message}`);
				}
				const directArgs = { ...args, tasksJsonPath };
				const result = await initiateAnalyzeTaskComplexityDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error initiating complexity analysis');
			} catch (error) {
				return createErrorResponse(`Internal tool error (${toolName}): ${error.message}`);
			}
		})
	});

	server.addTool({
		name: 'submitDelegatedAnalyzeTaskComplexityResponse',
		description: 'Submits the raw LLM response for a delegated task complexity analysis.',
		parameters: z.object({
			interactionId: z.string().describe("The interaction ID from the initiate call."),
			rawLLMResponse: z.string().describe("The raw JSON string response from the LLM."),
			llmUsageData: z.object({
				inputTokens: z.number().int().optional(),
				outputTokens: z.number().int().optional()
			}).optional().describe("Optional token usage data."),
			projectRoot: z.string().describe("Absolute path to the project."),
			tasksJsonPath: z.string().optional().describe("Path to the tasks.json file (for context)."), // Added, as direct fn needs it
			outputPath: z.string().optional().describe(`Path to save the complexity report. Default: ${COMPLEXITY_REPORT_FILE}`),
			threshold: z.coerce.number().int().min(1).max(10).optional().default(5).describe("Complexity threshold for the report.")
		}),
		execute: withNormalizedProjectRoot(async (args, { log, session }) => {
			const toolName = 'submitDelegatedAnalyzeTaskComplexityResponse';
			try {
				let tasksJsonPath; // tasksJsonPath is needed by submitAnalyzeTaskComplexityResponseDirect
				try {
					tasksJsonPath = findTasksPath({ projectRoot: args.projectRoot, file: args.tasksJsonPath }, log);
				} catch (error) {
					// If not provided, it might be optional if the core function can work without it using stored context,
					// but direct function currently requires it.
					return createErrorResponse(`Failed to determine tasks.json path: ${error.message}. 'tasksJsonPath' might be required.`);
				}

				const outputPath = args.outputPath
					? path.resolve(args.projectRoot, args.outputPath)
					: path.resolve(args.projectRoot, COMPLEXITY_REPORT_FILE);

				const outputDir = path.dirname(outputPath);
				if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

				const directArgs = { ...args, tasksJsonPath, outputPath };
				const result = await submitAnalyzeTaskComplexityResponseDirect(directArgs, log, { session });
				return handleApiResult(result, log, 'Error submitting complexity analysis response');
			} catch (error) {
				return createErrorResponse(`Internal tool error (${toolName}): ${error.message}`);
			}
		})
	});
}
