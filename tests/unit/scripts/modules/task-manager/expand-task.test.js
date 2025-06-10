import { jest } from '@jest/globals';

// Mock process.env
const originalEnv = { ...process.env };

// Mock ai-services-unified
const mockGenerateTextService = jest.fn();
const mockSubmitDelegatedTextResponseService = jest.fn(); // Added for completeness if needed later

jest.unstable_mockModule('../../ai-services-unified.js', () => ({
	generateTextService: mockGenerateTextService,
	submitDelegatedTextResponseService: mockSubmitDelegatedTextResponseService,
}));

// Mock utils.js
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockLog = { // Ensure log methods are jest.fn()
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
	success: jest.fn(),
};
const mockIsSilentMode = jest.fn();
const mockGetDebugFlag = jest.fn();
jest.unstable_mockModule('../../utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	log: mockLog, // Use the object with jest.fn()
	isSilentMode: mockIsSilentMode,
	getDebugFlag: mockGetDebugFlag,
}));

// Mock config-manager.js
const mockGetDefaultSubtasks = jest.fn();
const mockGetProjectName = jest.fn();
jest.unstable_mockModule('../../config-manager.js', () => ({
	getDefaultSubtasks: mockGetDefaultSubtasks,
	getDebugFlag: mockGetDebugFlag,
	getProjectName: mockGetProjectName,
	MODEL_MAP: {},
}));

// Mock fs module
const mockFsExistsSync = jest.fn();
const mockFsReadFileSync = jest.fn();
const mockFsCopyFileSync = jest.fn();
const mockFsMkdirSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: mockFsExistsSync,
		readFileSync: mockFsReadFileSync,
		copyFileSync: mockFsCopyFileSync,
		mkdirSync: mockFsMkdirSync,
	},
	existsSync: mockFsExistsSync,
	readFileSync: mockFsReadFileSync,
	copyFileSync: mockFsCopyFileSync,
	mkdirSync: mockFsMkdirSync,
}));

// Mock generate-task-files.js
const mockGenerateTaskFiles = jest.fn();
jest.unstable_mockModule('./generate-task-files.js', () => ({ // Path relative to expand-task.js
	default: mockGenerateTaskFiles,
}));

// Import the module to test (AFTER all mocks)
let expandTask;

describe('Task Manager - expandTask', () => {
	const tasksPath = '/fake/tasks.json';
	const projectRoot = '/fake';
	const baseTask = {
		id: 1,
		title: 'Parent Task',
		description: 'Description of parent task',
		details: 'Initial details',
		subtasks: [],
		status: 'pending',
	};
	const baseContext = { // This is the context for expandTask itself
		session: {},
		mcpLog: mockLog, // Use the fully mocked log object
		projectRoot,
		commandName: 'expand-task', // Default commandName for telemetry
		outputType: 'mcp',        // Default outputType for telemetry
	};

	beforeAll(async () => {
		// Ensure path is relative to where `jest` is run or use appropriate mapping
		const module = await import('../../../../../scripts/modules/task-manager/expand-task.js');
		expandTask = module.default;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		process.env = { ...originalEnv }; // Reset env

		mockReadJSON.mockReturnValue({ tasks: [JSON.parse(JSON.stringify(baseTask))] }); // Deep copy for safety
		mockWriteJSON.mockImplementation(() => {});
		mockGenerateTaskFiles.mockResolvedValue(undefined);
		mockGetDefaultSubtasks.mockReturnValue(3);
		mockGetDebugFlag.mockReturnValue(false);
		mockIsSilentMode.mockReturnValue(true);
		mockFsExistsSync.mockReturnValue(true);
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	describe('Agent-Driven Mode (Delegated Two-Phase)', () => {
		// These tests were added in Subtask 5, Turn 3 and are for the newer delegation, not MCP_AI_MODE
		// They should call generateTextService with delegationPhase: 'initiate'
		// or submitDelegatedTextResponseService

		test("should call generateTextService with delegationPhase 'initiate'", async () => {
			const initiateContextForExpandTask = { // This is the 'context' arg for expandTask
				...baseContext,
				clientContext: { id: 'client123' },
				delegationPhase: 'initiate',
			};
			const expectedInitiationBundle = {
				interactionId: 'delegate-expand-id-1',
				aiServiceRequest: { /* ... request details ... */ },
				clientContext: { id: 'client123' }
			};
			mockGenerateTextService.mockResolvedValueOnce(expectedInitiationBundle);
			mockFsExistsSync.mockReturnValue(false); // No complexity report

			const result = await expandTask(tasksPath, 1, null, false, '', initiateContextForExpandTask, false);

			expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
				delegationPhase: 'initiate',
				clientContext: initiateContextForExpandTask.clientContext,
				commandName: 'expand-task',
			}));
			expect(result).toEqual(expectedInitiationBundle);
			expect(mockWriteJSON).not.toHaveBeenCalled(); // No file writing in initiate phase
		});

		test("should call submitDelegatedTextResponseService for 'submit' phase", async () => {
			const submitContextForExpandTask = { // This is the 'context' arg for expandTask
				...baseContext,
				delegationPhase: 'submit',
				interactionId: 'delegate-expand-id-1',
				rawLLMResponse: JSON.stringify({
					subtasks: [{ id: 1, title: 'Agent Subtask 1', description: 'Desc 1', dependencies: [], details: 'Details 1', status: 'pending' }]
				}),
				llmUsageData: { inputTokens: 10, outputTokens: 20 }
			};
			const mockSubmissionResultFromAIService = { // This is what submitDelegatedTextResponseService returns
				text: submitContextForExpandTask.rawLLMResponse,
				usage: submitContextForExpandTask.llmUsageData,
				telemetryData: { submitTele: 'data' }
			};
			mockSubmitDelegatedTextResponseService.mockResolvedValueOnce(mockSubmissionResultFromAIService);
			mockFsExistsSync.mockReturnValue(false); // No complexity report for simplicity

			const result = await expandTask(tasksPath, 1, null, false, '', submitContextForExpandTask, false);

			expect(mockSubmitDelegatedTextResponseService).toHaveBeenCalledWith(expect.objectContaining({
				interactionId: submitContextForExpandTask.interactionId,
				rawLLMResponse: submitContextForExpandTask.rawLLMResponse,
			}));
			expect(result.task.subtasks).toHaveLength(1);
			expect(result.task.subtasks[0].title).toBe('Agent Subtask 1');
			expect(result.telemetryData).toEqual({ submitTele: 'data' });
			expect(mockWriteJSON).toHaveBeenCalled(); // File writing should happen
		});
	});

	describe('Direct Mode (No Delegation)', () => {
		beforeEach(() => {
			// Ensure not in any special mode for these tests
			delete process.env.MCP_AI_MODE;
		});

		test('should call generateTextService with prompts and parse its mainResult', async () => {
			const llmTextOutput = JSON.stringify({
				subtasks: [
					{ id: 1, title: 'LLM Subtask 1', description: 'LLM Desc 1', dependencies: [], details: 'LLM Details 1', status: 'pending' },
				],
			});

			// Corrected mock for direct call
			mockGenerateTextService.mockResolvedValue({
				mainResult: llmTextOutput, // AI output is in mainResult
				telemetryData: { directTele: 'data' },
				// usage is not at this top level from _unifiedServiceRunner for direct calls
			});
			mockFsExistsSync.mockReturnValue(false); // No complexity report

			const result = await expandTask(tasksPath, 1, 1, false, 'additional user context', baseContext, false);

			expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
				prompt: expect.stringContaining('Break down this task into exactly 1 specific subtasks'),
				systemPrompt: expect.stringContaining('You are an AI assistant helping with task breakdown'),
				role: 'main',
				delegationPhase: undefined // Ensure not set
			}));
			expect(result.task.subtasks).toHaveLength(1);
			expect(result.task.subtasks[0].title).toBe('LLM Subtask 1');
			expect(result.telemetryData).toEqual({ directTele: 'data' });
		});

		test('should throw error if AI service does not return valid text string in direct mode', async () => {
			mockGenerateTextService.mockResolvedValue({
				mainResult: null, // Invalid text string
				telemetryData: {}
			});
			mockFsExistsSync.mockReturnValue(false);

			await expect(
				expandTask(tasksPath, 1, 1, false, '', baseContext, false)
			).rejects.toThrow('AI service did not return a valid text string for task expansion.');
		});
	});
});
