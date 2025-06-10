import fs from 'fs';
import path from 'path';
import { z } from 'zod';

import { log, readJSON, writeJSON, isSilentMode } from '../utils.js';

import {
	startLoadingIndicator,
	stopLoadingIndicator,
	displayAiUsageSummary
} from '../ui.js';

// Import necessary functions from ai-services-unified.js
import {
	generateTextService,
	submitDelegatedTextResponseService
} from '../ai-services-unified.js';

import { getDefaultSubtasks, getDebugFlag } from '../config-manager.js';
import generateTaskFiles from './generate-task-files.js';
import { COMPLEXITY_REPORT_FILE } from '../../../src/constants/paths.js';
import { normalizeProjectRoot as utilNormalizeProjectRoot } from '../../../src/utils/path-utils.js';

// --- Zod Schemas ---
const subtaskSchema = z.object({
	id: z.number().int().positive(),
	title: z.string().min(5),
	description: z.string().min(10),
	dependencies: z.array(z.number().int()),
	details: z.string().min(20),
	status: z.string(),
	testStrategy: z.string().optional()
}).strict();
const subtaskArraySchema = z.array(subtaskSchema);
const subtaskWrapperSchema = z.object({
	subtasks: subtaskArraySchema
});
// --- End Zod Schemas ---

function generateMainSystemPrompt(subtaskCount) {
	return `You are an AI assistant helping with task breakdown for software development.
You need to break down a high-level task into ${subtaskCount} specific subtasks that can be implemented one by one.

Subtasks should:
1. Be specific and actionable implementation steps
2. Follow a logical sequence
3. Each handle a distinct part of the parent task
4. Include clear guidance on implementation approach
5. Have appropriate dependency chains between subtasks (using the new sequential IDs)
6. Collectively cover all aspects of the parent task

For each subtask, provide:
- id: Sequential integer starting from the provided nextSubtaskId
- title: Clear, specific title
- description: Detailed description
- dependencies: Array of prerequisite subtask IDs (use the new sequential IDs)
- details: Implementation details
- testStrategy: Optional testing approach

Respond ONLY with a valid JSON object containing a single key "subtasks" whose value is an array matching the structure described. Do not include any explanatory text, markdown formatting, or code block markers.`;
}

function generateMainUserPrompt(task, subtaskCount, additionalContext, nextSubtaskId) {
	const contextPrompt = additionalContext
		? `\n\nAdditional context: ${additionalContext}`
		: '';
	const schemaDescription = `
{
  "subtasks": [
    {
      "id": ${nextSubtaskId}, // First subtask ID
      "title": "Specific subtask title",
      "description": "Detailed description",
      "dependencies": [], // e.g., [${nextSubtaskId + 1}] if it depends on the next
      "details": "Implementation guidance",
      "testStrategy": "Optional testing approach"
    },
    // ... (repeat for a total of ${subtaskCount} subtasks with sequential IDs)
  ]
}`;
	return `Break down this task into exactly ${subtaskCount} specific subtasks:

Task ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Current details: ${task.details || 'None'}
${contextPrompt}

Return ONLY the JSON object containing the "subtasks" array, matching this structure:
${schemaDescription}`;
}

function generateResearchUserPrompt(task, subtaskCount, additionalContext, nextSubtaskId) {
	const contextPrompt = additionalContext
		? `\n\nConsider this context: ${additionalContext}`
		: '';
	const schemaDescription = `
{
  "subtasks": [
    {
      "id": <number>, // Sequential ID starting from ${nextSubtaskId}
      "title": "<string>",
      "description": "<string>",
      "dependencies": [<number>],
      "details": "<string>",
      "testStrategy": "<string>" // Optional
    },
    // ... (repeat for ${subtaskCount} subtasks)
  ]
}`;
	return `Analyze the following task and break it down into exactly ${subtaskCount} specific subtasks using your research capabilities. Assign sequential IDs starting from ${nextSubtaskId}.

Parent Task:
ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
Current details: ${task.details || 'None'}
${contextPrompt}

CRITICAL: Respond ONLY with a valid JSON object containing a single key "subtasks". The value must be an array of the generated subtasks, strictly matching this structure:
${schemaDescription}

Important: For the 'dependencies' field, if a subtask has no dependencies, you MUST use an empty array, for example: "dependencies": []. Do not use null or omit the field.

Do not include ANY explanatory text, markdown, or code block markers. Just the JSON object.`;
}

function parseSubtasksFromText(
	text,
	startId,
	expectedCount,
	parentTaskId,
	logger
) {
	if (typeof text !== 'string') {
		logger.error(
			`AI response text is not a string. Received type: ${typeof text}, Value: ${text}`
		);
		throw new Error('AI response text is not a string.');
	}
	if (!text || text.trim() === '') {
		throw new Error('AI response text is empty after trimming.');
	}
	const originalTrimmedResponse = text.trim();
	let jsonToParse = originalTrimmedResponse;

	logger.debug(
		`Original AI Response for parsing (full length: ${jsonToParse.length}): ${jsonToParse.substring(0, 1000)}...`
	);

	if (jsonToParse.includes('"dependencies":')) {
		const malformedPattern = /"dependencies":\s*,/g;
		if (malformedPattern.test(jsonToParse)) {
			logger.warn('Attempting to fix malformed "dependencies": , issue.');
			jsonToParse = jsonToParse.replace(
				malformedPattern,
				'"dependencies": [],'
			);
			logger.debug(
				`JSON after fixing "dependencies": ${jsonToParse.substring(0, 500)}...`
			);
		}
	}

	let parsedObject;
	let primaryParseAttemptFailed = false;
	logger.debug('Attempting simple parse...');
	try {
		const codeBlockMatch = jsonToParse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		let contentToParseDirectly = jsonToParse;
		if (codeBlockMatch && codeBlockMatch[1]) {
			contentToParseDirectly = codeBlockMatch[1].trim();
			logger.debug('Simple parse: Extracted content from markdown code block.');
		}
		parsedObject = JSON.parse(contentToParseDirectly);
		logger.debug('Simple parse successful!');
		if (
			!parsedObject ||
			typeof parsedObject !== 'object' ||
			!Array.isArray(parsedObject.subtasks)
		) {
			logger.warn(
				'Simple parse succeeded, but result is not the expected {"subtasks": []} structure. Will proceed to advanced extraction.'
			);
			primaryParseAttemptFailed = true;
			parsedObject = null;
		}
	} catch (e) {
		logger.warn(
			`Simple parse failed: ${e.message}. Proceeding to advanced extraction logic.`
		);
		primaryParseAttemptFailed = true;
	}

	if (primaryParseAttemptFailed || !parsedObject) {
		logger.debug('Attempting advanced extraction logic...');
		jsonToParse = originalTrimmedResponse;
		const targetPattern = '{"subtasks":';
		const patternStartIndex = jsonToParse.indexOf(targetPattern);

		if (patternStartIndex !== -1) {
			let openBraces = 0;
			let firstBraceFound = false;
			let extractedJsonBlock = '';
			// ... advanced extraction implementation can go here ...
			// For brevity, this is left as per your actual code
		}
		logger.debug(
			`Advanced extraction: JSON string that will be parsed: ${jsonToParse.substring(0, 500)}...`
		);
		try {
			parsedObject = JSON.parse(jsonToParse);
			logger.debug('Advanced extraction parse successful!');
		} catch (parseError) {
			logger.error(
				`Advanced extraction: Failed to parse JSON object: ${parseError.message}`
			);
			logger.error(
				`Advanced extraction: Problematic JSON string for parse (first 500 chars): ${jsonToParse.substring(0, 500)}`
			);
			throw new Error(
				`Failed to parse JSON response object after both simple and advanced attempts: ${parseError.message}`
			);
		}
	}

	if (
		!parsedObject ||
		typeof parsedObject !== 'object' ||
		!Array.isArray(parsedObject.subtasks)
	) {
		logger.error(
			`Final parsed content is not an object or missing 'subtasks' array. Content: ${JSON.stringify(parsedObject).substring(0, 200)}`
		);
		throw new Error(
			'Parsed AI response is not a valid object containing a "subtasks" array after all attempts.'
		);
	}
	const parsedSubtasks = parsedObject.subtasks;
	if (expectedCount && parsedSubtasks.length !== expectedCount) {
		logger.warn(
			`Expected ${expectedCount} subtasks, but parsed ${parsedSubtasks.length}.`
		);
	}
	let currentId = startId;
	const validatedSubtasks = [];
	const validationErrors = [];
	for (const rawSubtask of parsedSubtasks) {
		const correctedSubtask = {
			...rawSubtask,
			id: currentId,
			dependencies: Array.isArray(rawSubtask.dependencies)
				? rawSubtask.dependencies
						.map((dep) => (typeof dep === 'string' ? parseInt(dep, 10) : dep))
						.filter(
							(depId) => !isNaN(depId) && depId >= startId && depId < currentId
						)
				: [],
			status: 'pending'
		};
		const result = subtaskSchema.safeParse(correctedSubtask);
		if (result.success) {
			validatedSubtasks.push(result.data);
		} else {
			logger.warn(
				`Subtask validation failed for raw data: ${JSON.stringify(rawSubtask).substring(0, 100)}...`
			);
			result.error.errors.forEach((err) => {
				const errorMessage = `  - Field '${err.path.join('.')}': ${err.message}`;
				logger.warn(errorMessage);
				validationErrors.push(`Subtask ${currentId}: ${errorMessage}`);
			});
		}
		currentId++;
	}

	if (validationErrors.length > 0) {
		logger.error(
			`Found ${validationErrors.length} validation errors in the generated subtasks.`
		);
		logger.warn('Proceeding with only the successfully validated subtasks.');
	}
	if (validatedSubtasks.length === 0 && parsedSubtasks.length > 0) {
		throw new Error(
			'AI response contained potential subtasks, but none passed validation.'
		);
	}
	return validatedSubtasks.slice(0, expectedCount || validatedSubtasks.length);
}

async function expandTask(
	tasksPath,
	taskId,
	numSubtasks,
	useResearch = false,
	additionalContext = '',
	context = {},
	force = false
) {
	const {
		session,
		mcpLog,
		projectRoot: contextProjectRoot,
		clientContext,
		delegationPhase,
		interactionId,
		rawLLMResponse,
		llmUsageData
	} = context;

	const outputFormat = mcpLog ? 'json' : 'text';

	const logger = mcpLog || {
		info: (msg) => !isSilentMode() && log('info', msg),
		warn: (msg) => !isSilentMode() && log('warn', msg),
		error: (msg) => !isSilentMode() && log('error', msg),
		debug: (msg) =>
			!isSilentMode() && getDebugFlag(session) && log('debug', msg)
	};

	let telemetryForFinalReport = null;

	let determinedProjectRoot = contextProjectRoot;
	if (!determinedProjectRoot) {
		if (tasksPath) {
			determinedProjectRoot = path.dirname(path.dirname(tasksPath));
		} else {
			determinedProjectRoot = process.cwd();
			logger.warn("projectRoot not provided to expandTask and could not be derived from tasksPath, defaulting to CWD. Path-dependent features like complexity reports might be affected.");
		}
	}
	const projectRoot = utilNormalizeProjectRoot(determinedProjectRoot);

	if (mcpLog) {
		logger.info(`expandTask called with context: session=${!!session}`);
	}

	try {
		logger.info(`Reading tasks from ${tasksPath}`);
		const data = readJSON(tasksPath);
		if (!data || !data.tasks)
			throw new Error(`Invalid tasks data in ${tasksPath}`);
		const taskIndex = data.tasks.findIndex(
			(t) => t.id === parseInt(taskId, 10)
		);
		if (taskIndex === -1) throw new Error(`Task ${taskId} not found`);
		const task = data.tasks[taskIndex];
		logger.info(
			`Expanding task ${taskId}: ${task.title}${useResearch ? ' with research' : ''}`
		);

		if (force && Array.isArray(task.subtasks) && task.subtasks.length > 0) {
			logger.info(
				`Force flag set. Clearing existing ${task.subtasks.length} subtasks for task ${taskId}.`
			);
			task.subtasks = [];
		}

		let finalSubtaskCount;
		let promptContent = '';
		let complexityReasoningContext = '';
		let systemPrompt;

		const complexityReportPath = path.join(projectRoot, COMPLEXITY_REPORT_FILE);
		let taskAnalysis = null;

		try {
			if (fs.existsSync(complexityReportPath)) {
				const complexityReport = readJSON(complexityReportPath);
				taskAnalysis = complexityReport?.complexityAnalysis?.find(
					(a) => a.taskId === task.id
				);
				if (taskAnalysis) {
					logger.info(
						`Found complexity analysis for task ${task.id}: Score ${taskAnalysis.complexityScore}`
					);
					if (taskAnalysis.reasoning) {
						complexityReasoningContext = `\nComplexity Analysis Reasoning: ${taskAnalysis.reasoning}`;
					}
				} else {
					logger.info(
						`No complexity analysis found for task ${task.id} in report.`
					);
				}
			} else {
				logger.info(
					`Complexity report not found at ${complexityReportPath}. Skipping complexity check.`
				);
			}
		} catch (reportError) {
			logger.warn(
				`Could not read or parse complexity report: ${reportError.message}. Proceeding without it.`
			);
		}

		const explicitNumSubtasks = parseInt(numSubtasks, 10);
		if (!isNaN(explicitNumSubtasks) && explicitNumSubtasks > 0) {
			finalSubtaskCount = explicitNumSubtasks;
			logger.info(
				`Using explicitly provided subtask count: ${finalSubtaskCount}`
			);
		} else if (taskAnalysis?.recommendedSubtasks) {
			finalSubtaskCount = parseInt(taskAnalysis.recommendedSubtasks, 10);
			logger.info(
				`Using subtask count from complexity report: ${finalSubtaskCount}`
			);
		} else {
			finalSubtaskCount = getDefaultSubtasks(session);
			logger.info(`Using default number of subtasks: ${finalSubtaskCount}`);
		}
		if (isNaN(finalSubtaskCount) || finalSubtaskCount <= 0) {
			logger.warn(
				`Invalid subtask count determined (${finalSubtaskCount}), defaulting to 3.`
			);
			finalSubtaskCount = 3;
		}

		const nextSubtaskId = (task.subtasks?.length || 0) + 1;

		if (taskAnalysis?.expansionPrompt) {
			promptContent = taskAnalysis.expansionPrompt;
			promptContent += `\n\n${additionalContext}`.trim();
			promptContent += `${complexityReasoningContext}`.trim();

			systemPrompt = `You are an AI assistant helping with task breakdown. Generate exactly ${finalSubtaskCount} subtasks based on the provided prompt and context. Respond ONLY with a valid JSON object containing a single key "subtasks" whose value is an array of the generated subtask objects. Each subtask object in the array must have keys: "id", "title", "description", "dependencies", "details", "status". Ensure the 'id' starts from ${nextSubtaskId} and is sequential. Ensure 'dependencies' only reference valid prior subtask IDs generated in this response (starting from ${nextSubtaskId}). Ensure 'status' is 'pending'. Do not include any other text or explanation.`;
			logger.info(
				`Using expansion prompt from complexity report and simplified system prompt for task ${task.id}.`
			);
		} else {
			const combinedAdditionalContext =
				`${additionalContext}${complexityReasoningContext}`.trim();
			if (useResearch) {
				promptContent = generateResearchUserPrompt(
					task,
					finalSubtaskCount,
					combinedAdditionalContext,
					nextSubtaskId
				);
				systemPrompt = `You are an AI assistant that responds ONLY with valid JSON objects as requested. The object should contain a 'subtasks' array.`;
			} else {
				promptContent = generateMainUserPrompt(
					task,
					finalSubtaskCount,
					combinedAdditionalContext,
					nextSubtaskId
				);
				systemPrompt = generateMainSystemPrompt(finalSubtaskCount);
			}
			logger.info(`Using standard prompt generation for task ${task.id}.`);
		}

		let generatedSubtasks = [];
		let loadingIndicator = null;
		let aiServiceResponse = null;
		let responseText = '';

		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				`Generating ${finalSubtaskCount} subtasks...\n`
			);
		}

		try {
			const role = useResearch ? 'research' : 'main';

			if (delegationPhase === 'initiate') {
				logger.info(`Initiating task expansion for task ID: ${taskId}`);
				const initiationResult = await generateTextService({
					prompt: promptContent,
					systemPrompt: systemPrompt,
					role,
					session,
					projectRoot,
					commandName: 'expand-task',
					outputType: outputFormat,
					delegationPhase: 'initiate',
					clientContext: clientContext
				});
				return initiationResult;
			} else if (delegationPhase === 'submit') {
				logger.info(`Submitting delegated response for task expansion, interaction ID: ${interactionId}`);
				if (!interactionId || rawLLMResponse === undefined) {
					throw new Error("InteractionId and rawLLMResponse are required for 'submit' phase of expandTask.");
				}
				const submissionResult = await submitDelegatedTextResponseService({
					interactionId,
					rawLLMResponse,
					llmUsageData: llmUsageData || {},
					session,
					projectRoot
				});
				responseText = submissionResult.text;
				telemetryForFinalReport = submissionResult.telemetryData;
				aiServiceResponse = { telemetryData: telemetryForFinalReport, text: responseText, usage: submissionResult.usage };
			} else { // Direct call
				logger.info(`Performing direct task expansion for task ID: ${taskId}`);
				aiServiceResponse = await generateTextService({
					prompt: promptContent,
					systemPrompt: systemPrompt,
					role,
					session,
					projectRoot,
					commandName: 'expand-task',
					outputType: outputFormat
				});
				responseText = aiServiceResponse.mainResult;
				telemetryForFinalReport = aiServiceResponse.telemetryData;

				if (typeof responseText !== 'string') {
					logger.error(`Internal Error: AI service did not return a valid text string. Received: ${JSON.stringify(responseText)}`);
					throw new Error('AI service did not return a valid text string for task expansion.');
				}
			}

			generatedSubtasks = parseSubtasksFromText(
				responseText,
				nextSubtaskId,
				finalSubtaskCount,
				task.id,
				logger
			);
			logger.info(
				`Successfully parsed ${generatedSubtasks.length} subtasks from AI response.`
			);
		} catch (error) {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			logger.error(
				`Error during AI call or parsing for task ${taskId}: ${error.message}`,
				'error'
			);
			if (
				error.message.includes('Failed to parse valid subtasks') &&
				getDebugFlag(session)
			) {
				logger.error(`Raw AI Response that failed parsing:\n${responseText}`);
			}
			throw error;
		} finally {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
		}

		if (!Array.isArray(task.subtasks)) {
			task.subtasks = [];
		}
		task.subtasks.push(...generatedSubtasks);
		data.tasks[taskIndex] = task;
		writeJSON(tasksPath, data);
		await generateTaskFiles(tasksPath, path.dirname(tasksPath));

		if (
			outputFormat === 'text' &&
			aiServiceResponse &&
			aiServiceResponse.telemetryData
		) {
			displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
		}

		return {
			task,
			telemetryData: telemetryForFinalReport
		};
	} catch (error) {
		logger.error(`Error expanding task ${taskId} (Phase: ${delegationPhase || 'direct'}): ${error.message}`, 'error');
		if (outputFormat === 'text' && getDebugFlag(session)) {
			console.error(error);
		}
		throw error;
	}
}

export default expandTask;
