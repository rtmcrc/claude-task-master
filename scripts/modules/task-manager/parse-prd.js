import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';
import { z } from 'zod';

import {
	log,
	writeJSON,
	enableSilentMode,
	disableSilentMode,
	isSilentMode,
	readJSON,
	findTaskById
} from '../utils.js';

// Import necessary functions from ai-services-unified.js
import {
	generateObjectService,
	submitDelegatedObjectResponseService
} from '../ai-services-unified.js';
import { getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';
import { displayAiUsageSummary } from '../ui.js';

// Define the Zod schema for a SINGLE task object
const prdSingleTaskSchema = z.object({
	id: z.number().int().positive(),
	title: z.string().min(1),
	description: z.string().min(1),
	details: z.string().optional().default(''),
	testStrategy: z.string().optional().default(''),
	priority: z.enum(['high', 'medium', 'low']).default('medium'),
	dependencies: z.array(z.number().int().positive()).optional().default([]),
	status: z.string().optional().default('pending')
});

// Define the Zod schema for the ENTIRE expected AI response object
const prdResponseSchema = z.object({
	tasks: z.array(prdSingleTaskSchema),
	metadata: z.object({
		projectName: z.string(),
		totalTasks: z.number(),
		sourceFile: z.string(),
		generatedAt: z.string()
	})
});

/**
 * Parse a PRD file and generate tasks
 * @param {string} prdPath - Path to the PRD file
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} numTasks - Number of tasks to generate
 * @param {Object} options - Additional options
 * @param {boolean} [options.force=false] - Whether to overwrite existing tasks.json.
 * @param {boolean} [options.append=false] - Append to existing tasks file.
 * @param {boolean} [options.research=false] - Use research model for enhanced PRD analysis.
 * @param {Object} [options.reportProgress] - Function to report progress (optional, likely unused).
 * @param {Object} [options.mcpLog] - MCP logger object (optional).
 * @param {Object} [options.session] - Session object from MCP server (optional).
 * @param {string} [options.projectRoot] - Project root path (for MCP/env fallback).
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json').
 * @param {object} [context={}] - Context object for delegation.
 * @param {string} [context.delegationPhase] - 'initiate' or 'submit'.
 * @param {string} [context.interactionId] - ID for 'submit' phase.
 * @param {string | object} [context.rawLLMResponse] - LLM response for 'submit' phase.
 * @param {object} [context.llmUsageData] - Usage data for 'submit' phase.
 * @param {object} [context.clientContext] - Client context for 'initiate' phase.
 */
async function parsePRD(prdPath, tasksPath, numTasks, options = {}, context = {}) {
	const {
		// Options related to how parsePRD operates
		force = false,
		append = false,
		research = false,
		projectRoot, // projectRoot is crucial, ensure it's from options or derived
		// mcpLog and session are also from options if passed by direct function
		mcpLog,
		session,
		clientContext // Pass through client context if initiating
	} = options;

	// Context for delegation phases
	const {
		delegationPhase,
		interactionId,
		rawLLMResponse,
		llmUsageData
	} = context;


	const isMCP = !!mcpLog;
	const outputFormat = isMCP ? 'json' : 'text';

	const logFn = mcpLog
		? mcpLog
		: {
				// Wrapper for CLI
				info: (...args) => log('info', ...args),
				warn: (...args) => log('warn', ...args),
				error: (...args) => log('error', ...args),
				debug: (...args) => log('debug', ...args),
				success: (...args) => log('success', ...args)
			};

	// Create custom reporter using logFn
	const report = (message, level = 'info') => {
		// Check logFn directly
		if (logFn && typeof logFn[level] === 'function') {
			logFn[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			// Fallback to original log only if necessary and in CLI text mode
			log(level, message);
		}
	};

	report(
		`Parsing PRD file: ${prdPath}, Force: ${force}, Append: ${append}, Research: ${research}`
	);

	let existingTasks = [];
	let nextId = 1;
	let aiServiceResponse = null;

	try {
		// Handle file existence and overwrite/append logic
		if (fs.existsSync(tasksPath)) {
			if (append) {
				report(
					`Append mode enabled. Reading existing tasks from ${tasksPath}`,
					'info'
				);
				const existingData = readJSON(tasksPath); // Use readJSON utility
				if (existingData && Array.isArray(existingData.tasks)) {
					existingTasks = existingData.tasks;
					if (existingTasks.length > 0) {
						nextId = Math.max(...existingTasks.map((t) => t.id || 0)) + 1;
						report(
							`Found ${existingTasks.length} existing tasks. Next ID will be ${nextId}.`,
							'info'
						);
					}
				} else {
					report(
						`Could not read existing tasks from ${tasksPath} or format is invalid. Proceeding without appending.`,
						'warn'
					);
					existingTasks = []; // Reset if read fails
				}
			} else if (!force) {
				// Not appending and not forcing overwrite
				const overwriteError = new Error(
					`Output file ${tasksPath} already exists. Use --force to overwrite or --append.`
				);
				report(overwriteError.message, 'error');
				if (outputFormat === 'text') {
					console.error(chalk.red(overwriteError.message));
					process.exit(1);
				} else {
					throw overwriteError;
				}
			} else {
				// Force overwrite is true
				report(
					`Force flag enabled. Overwriting existing file: ${tasksPath}`,
					'info'
				);
			}
		}

		// Determine prdContent: prioritize direct content from options, then fall back to prdPath.
		let prdContent;
		const directPrdContent = options.prdContent; // Content passed directly in options

		if (directPrdContent && typeof directPrdContent === 'string' && directPrdContent.trim() !== '') {
			report(`Using PRD content directly provided via options.prdContent.`, 'info');
			prdContent = directPrdContent;
		} else if (prdPath && typeof prdPath === 'string' && prdPath.toLowerCase() !== 'direct_content' && prdPath.toLowerCase() !== 'delegated_submission') {
			// Only read from prdPath if directPrdContent was not usable AND
			// prdPath is not a placeholder like 'direct_content' or 'delegated_submission'.
			// The 'delegated_submission' check is because in the submit phase, prdPath might be a nominal value.
			report(`Reading PRD content from file path: ${prdPath}`, 'info');
			if (!fs.existsSync(prdPath)) {
				throw new Error(`Input PRD file not found at path: ${prdPath}`);
			}
			prdContent = fs.readFileSync(prdPath, 'utf8');
			if (!prdContent || prdContent.trim() === '') {
				throw new Error(`Input file ${prdPath} is empty or could not be read.`);
			}
		} else if (delegationPhase === 'submit') {
			// In the 'submit' phase, prdContent is not strictly needed to regenerate prompts for the AI call,
			// as the AI call is already done. It might be needed for metadata or other logic.
			// If prdPath was nominal (e.g., 'delegated_submission'), we accept that prdContent might be undefined here.
			// The original prdPath used in 'initiate' is stored in interactionContext if truly needed.
			report(`PRD content not actively read during 'submit' phase with nominal prdPath: ${prdPath}. Content determined in 'initiate'.`, 'debug');
		} else {
			// This case means:
			// 1. No directPrdContent was provided (or it was empty).
			// 2. prdPath was not provided, or it was a placeholder like 'direct_content'
			//    (implying direct content was expected but wasn't valid).
			// And not in 'submit' phase where content might be optional.
			throw new Error('No valid PRD content provided. Supply PRD text via `prdContent` option or a valid file path.');
		}

		// If, after all checks, prdContent is still undefined and we are in a phase that requires it (initiate or direct)
		if (!prdContent && (delegationPhase === 'initiate' || !delegationPhase)) {
			// This re-check is crucial if the 'submit' phase logic above allows prdContent to be undefined.
			// For 'initiate' or direct calls, prdContent MUST be defined by this point.
			throw new Error('Failed to define PRD content for processing.');
		}


		// Research-specific enhancements to the system prompt
		const researchPromptAddition = research
			? `\nBefore breaking down the PRD into tasks, you will:
1. Research and analyze the latest technologies, libraries, frameworks, and best practices that would be appropriate for this project
2. Identify any potential technical challenges, security concerns, or scalability issues not explicitly mentioned in the PRD without discarding any explicit requirements or going overboard with complexity -- always aim to provide the most direct path to implementation, avoiding over-engineering or roundabout approaches
3. Consider current industry standards and evolving trends relevant to this project (this step aims to solve LLM hallucinations and out of date information due to training data cutoff dates)
4. Evaluate alternative implementation approaches and recommend the most efficient path
5. Include specific library versions, helpful APIs, and concrete implementation guidance based on your research
6. Always aim to provide the most direct path to implementation, avoiding over-engineering or roundabout approaches

Your task breakdown should incorporate this research, resulting in more detailed implementation guidance, more accurate dependency mapping, and more precise technology recommendations than would be possible from the PRD text alone, while maintaining all explicit requirements and best practices and all details and nuances of the PRD.`
			: '';

		// Base system prompt for PRD parsing
		const systemPrompt = `You are an AI assistant specialized in analyzing Product Requirements Documents (PRDs) and generating a structured, logically ordered, dependency-aware and sequenced list of development tasks in JSON format.${researchPromptAddition}

Analyze the provided PRD content and generate approximately ${numTasks} top-level development tasks. If the complexity or the level of detail of the PRD is high, generate more tasks relative to the complexity of the PRD
Each task should represent a logical unit of work needed to implement the requirements and focus on the most direct and effective way to implement the requirements without unnecessary complexity or overengineering. Include pseudo-code, implementation details, and test strategy for each task. Find the most up to date information to implement each task.
Assign sequential IDs starting from ${nextId}. Infer title, description, details, and test strategy for each task based *only* on the PRD content.
Set status to 'pending', dependencies to an empty array [], and priority to 'medium' initially for all tasks.
Respond ONLY with a valid JSON object containing a single key "tasks", where the value is an array of task objects adhering to the provided Zod schema. Do not include any explanation or markdown formatting.

Each task should follow this JSON structure:
{
	"id": number,
	"title": string,
	"description": string,
	"status": "pending",
	"dependencies": number[] (IDs of tasks this depends on),
	"priority": "high" | "medium" | "low",
	"details": string (implementation details),
	"testStrategy": string (validation approach)
}

Guidelines:
1. Unless complexity warrants otherwise, create exactly ${numTasks} tasks, numbered sequentially starting from ${nextId}
2. Each task should be atomic and focused on a single responsibility following the most up to date best practices and standards
3. Order tasks logically - consider dependencies and implementation sequence
4. Early tasks should focus on setup, core functionality first, then advanced features
5. Include clear validation/testing approach for each task
6. Set appropriate dependency IDs (a task can only depend on tasks with lower IDs, potentially including existing tasks with IDs less than ${nextId} if applicable)
7. Assign priority (high/medium/low) based on criticality and dependency order
8. Include detailed implementation guidance in the "details" field${research ? ', with specific libraries and version recommendations based on your research' : ''}
9. If the PRD contains specific requirements for libraries, database schemas, frameworks, tech stacks, or any other implementation details, STRICTLY ADHERE to these requirements in your task breakdown and do not discard them under any circumstance
10. Focus on filling in any gaps left by the PRD or areas that aren't fully specified, while preserving all explicit requirements
11. Always aim to provide the most direct path to implementation, avoiding over-engineering or roundabout approaches${research ? '\n12. For each task, include specific, actionable guidance based on current industry standards and best practices discovered through research' : ''}`;

		// Build user prompt with PRD content
		const userPrompt = `Here's the Product Requirements Document (PRD) to break down into approximately ${numTasks} tasks, starting IDs from ${nextId}:${research ? '\n\nRemember to thoroughly research current best practices and technologies before task breakdown to provide specific, actionable implementation details.' : ''}\n\n${prdContent}\n\n

		Return your response in this format:
{
    "tasks": [
        {
            "id": 1,
            "title": "Setup Project Repository",
            "description": "...",
            ...
        },
        ...
    ],
    "metadata": {
        "projectName": "PRD Implementation",
        "totalTasks": ${numTasks},
        "sourceFile": "${prdPath}",
        "generatedAt": "YYYY-MM-DD"
    }
}`;

		// Call the unified AI service
		report(
			`Calling AI service to generate tasks from PRD${research ? ' with research-backed analysis' : ''}...`,
			'info'
		);

		// Call the unified AI service
		report(
			`AI interaction for PRD parsing. Phase: ${delegationPhase || 'direct'}${research ? ' with research-backed analysis' : ''}...`,
			'info'
		);

		let generatedData; // This will hold the { tasks: [], metadata: {} } structure
		let telemetryForFinalReport = null;

		if (delegationPhase === 'initiate') {
			// Phase 1: Initiate the call and return interaction details
			const initiationResult = await generateObjectService({
				role: research ? 'research' : 'main',
				session: session, // from options
				projectRoot: projectRoot, // from options
				schema: prdResponseSchema, // Zod schema instance
				objectName: 'tasks_data',
				systemPrompt: systemPrompt,
				prompt: userPrompt,
				commandName: 'parse-prd', // Hardcoded for this tool
				outputType: isMCP ? 'mcp' : 'cli',
				delegationPhase: 'initiate',
				clientContext: clientContext // from options
			});
			// In 'initiate' phase, parsePRD's job is to return this bundle.
			// File operations and further processing happen in 'submit' phase or direct call.
			return initiationResult;
		} else if (delegationPhase === 'submit') {
			// Phase 2: Submit the agent's response
			if (!interactionId || rawLLMResponse === undefined) {
				throw new Error("InteractionId and rawLLMResponse are required for 'submit' phase.");
			}
			const submissionResult = await submitDelegatedObjectResponseService({
				interactionId,
				rawLLMResponse,
				llmUsageData: llmUsageData || {}, // from context
				session: session, // from options
				projectRoot: projectRoot // from options
			});
			generatedData = submissionResult.object; // This is { tasks: [], metadata: {} }
			// aiServiceResponse is used later for telemetry, so let's keep a similar structure
			aiServiceResponse = { telemetryData: submissionResult.telemetryData, object: generatedData };
			telemetryForFinalReport = submissionResult.telemetryData;
		} else {
			// Direct call (no delegation)
			aiServiceResponse = await generateObjectService({
				role: research ? 'research' : 'main',
				session: session,
				projectRoot: projectRoot,
				schema: prdResponseSchema,
				objectName: 'tasks_data',
				systemPrompt: systemPrompt,
				prompt: userPrompt,
				commandName: 'parse-prd',
				outputType: isMCP ? 'mcp' : 'cli'
			});
			// --- MODIFICATION START ---
			// Original line: generatedData = aiServiceResponse.object;
			generatedData = aiServiceResponse.mainResult;
			telemetryForFinalReport = aiServiceResponse.telemetryData;

			if (!generatedData) {
				logFn.error('Internal Error: AI service returned no mainResult.');
				throw new Error('AI service returned no mainResult after validation.');
			}
			// The existing check for generatedData.tasks will follow.
			// --- MODIFICATION END ---
		}

		// Create the directory if it doesn't exist
		const tasksDir = path.dirname(tasksPath);
		if (!fs.existsSync(tasksDir)) {
			fs.mkdirSync(tasksDir, { recursive: true });
		}
		logFn.success(
			`Successfully parsed PRD via AI service${research ? ' with research-backed analysis' : ''}.`
		);

		// Validate and Process Tasks
		// generatedData is now populated from either submitDelegatedObjectResponseService or generateObjectService (or aiServiceResponse.mainResult for direct)

		// The check for !generatedData was added above for the direct call path.
		// The check below handles if generatedData exists but is missing the tasks array.
		if (!Array.isArray(generatedData.tasks)) {
			logFn.error(
				`Internal Error: AI service mainResult is missing 'tasks' array: ${JSON.stringify(generatedData)}`
			);
			throw new Error(
				"AI service mainResult is missing 'tasks' array after validation."
			);
		}

		let currentId = nextId;
		const taskMap = new Map();
		const processedNewTasks = generatedData.tasks.map((task) => {
			const newId = currentId++;
			taskMap.set(task.id, newId);
			return {
				...task,
				id: newId,
				status: 'pending',
				priority: task.priority || 'medium',
				dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
				subtasks: []
			};
		});

		// Remap dependencies for the NEWLY processed tasks
		processedNewTasks.forEach((task) => {
			task.dependencies = task.dependencies
				.map((depId) => taskMap.get(depId)) // Map old AI ID to new sequential ID
				.filter(
					(newDepId) =>
						newDepId != null && // Must exist
						newDepId < task.id && // Must be a lower ID (could be existing or newly generated)
						(findTaskById(existingTasks, newDepId) || // Check if it exists in old tasks OR
							processedNewTasks.some((t) => t.id === newDepId)) // check if it exists in new tasks
				);
		});

		const finalTasks = append
			? [...existingTasks, ...processedNewTasks]
			: processedNewTasks;
		const outputData = { tasks: finalTasks };

		// Write the final tasks to the file
		writeJSON(tasksPath, outputData);
		report(
			`Successfully ${append ? 'appended' : 'generated'} ${processedNewTasks.length} tasks in ${tasksPath}${research ? ' with research-backed analysis' : ''}`,
			'success'
		);

		// Generate markdown task files after writing tasks.json
		await generateTaskFiles(tasksPath, path.dirname(tasksPath), { mcpLog });

		// Handle CLI output (e.g., success message)
		if (outputFormat === 'text') {
			console.log(
				boxen(
					chalk.green(
						`Successfully generated ${processedNewTasks.length} new tasks${research ? ' with research-backed analysis' : ''}. Total tasks in ${tasksPath}: ${finalTasks.length}`
					),
					{ padding: 1, borderColor: 'green', borderStyle: 'round' }
				)
			);

			console.log(
				boxen(
					chalk.white.bold('Next Steps:') +
						'\n\n' +
						`${chalk.cyan('1.')} Run ${chalk.yellow('task-master list')} to view all tasks\n` +
						`${chalk.cyan('2.')} Run ${chalk.yellow('task-master expand --id=<id>')} to break down a task into subtasks`,
					{
						padding: 1,
						borderColor: 'cyan',
						borderStyle: 'round',
						margin: { top: 1 }
					}
				)
			);

			if (aiServiceResponse && aiServiceResponse.telemetryData) {
				displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
			}
		}

		// Return telemetry data
		return {
			success: true,
			tasksPath,
			telemetryData: telemetryForFinalReport
		};
	} catch (error) {
		report(`Error parsing PRD (Phase: ${delegationPhase || 'direct'}): ${error.message}`, 'error');

		// Only show error UI for text output (CLI)
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));

			if (getDebugFlag(projectRoot)) {
				// Use projectRoot for debug flag check
				console.error(error);
			}

			process.exit(1);
		} else {
			throw error; // Re-throw for JSON output
		}
	}
}

export default parsePRD;
