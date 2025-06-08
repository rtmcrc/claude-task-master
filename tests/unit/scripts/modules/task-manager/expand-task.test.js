import { jest } from '@jest/globals';

// Mock process.env
const originalEnv = { ...process.env };

// Mock ai-services-unified
const mockGenerateTextService = jest.fn();
jest.unstable_mockModule('../../ai-services-unified.js', () => ({
	generateTextService: mockGenerateTextService,
}));

// Mock utils.js
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockLog = jest.fn();
const mockIsSilentMode = jest.fn();
const mockGetDebugFlag = jest.fn();
jest.unstable_mockModule('../../utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	log: mockLog,
	isSilentMode: mockIsSilentMode,
	getDebugFlag: mockGetDebugFlag,
	// Mock other utils if expandTask uses them, e.g., findTaskById
}));

// Mock config-manager.js
const mockGetDefaultSubtasks = jest.fn();
const mockGetProjectName = jest.fn(); // Assuming it might be used directly or indirectly
jest.unstable_mockModule('../../config-manager.js', () => ({
	getDefaultSubtasks: mockGetDefaultSubtasks,
	getDebugFlag: mockGetDebugFlag, // Already in utils, but if imported directly
	getProjectName: mockGetProjectName,
	// MODEL_MAP might be needed if _getCostForModel is inadvertently called via telemetry
	MODEL_MAP: {},
}));

// Mock fs module (if expandTask or its callees use it directly)
const mockFsExistsSync = jest.fn();
const mockFsReadFileSync = jest.fn(); // If generateMainUserPrompt etc. read templates
const mockFsCopyFileSync = jest.fn(); // If backup is created
const mockFsMkdirSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
	default: { // Assuming ES6 default import for fs, adjust if it's named
		existsSync: mockFsExistsSync,
		readFileSync: mockFsReadFileSync,
		copyFileSync: mockFsCopyFileSync,
		mkdirSync: mockFsMkdirSync,
	},
	existsSync: mockFsExistsSync, // Also as named export
	readFileSync: mockFsReadFileSync,
	copyFileSync: mockFsCopyFileSync,
	mkdirSync: mockFsMkdirSync,
}));


// Mock generate-task-files.js
const mockGenerateTaskFiles = jest.fn();
jest.unstable_mockModule('./generate-task-files.js', () => ({
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
	const baseContext = {
		session: {},
		mcpLog: mockLog, // Using the mocked log for mcpLog context
		projectRoot,
		commandName: 'expand-task',
		outputType: 'mcp',
	};

	beforeAll(async () => {
		const module = await import('../../../../../scripts/modules/task-manager/expand-task.js');
		expandTask = module.default;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		process.env = { ...originalEnv }; // Reset env

		// Default mock implementations
		mockReadJSON.mockReturnValue({ tasks: [baseTask] });
		mockWriteJSON.mockImplementation(() => {});
		mockGenerateTaskFiles.mockResolvedValue(undefined);
		mockGetDefaultSubtasks.mockReturnValue(3);
		mockGetDebugFlag.mockReturnValue(false);
		mockIsSilentMode.mockReturnValue(true); // Assume silent for tests unless overridden
		mockFsExistsSync.mockReturnValue(true); // Assume files exist by default
		mockLog.info = jest.fn(); // Mock mcpLog methods
		mockLog.warn = jest.fn();
		mockLog.error = jest.fn();
		mockLog.debug = jest.fn();
		mockLog.success = jest.fn();
	});

	afterAll(() => {
		process.env = originalEnv; // Restore original env
	});

	describe('Agent-Driven Mode', () => {
		beforeEach(() => {
			process.env.MCP_AI_MODE = 'agent_driven';
		});

		test('should call generateTextService with agent data and parse its output', async () => {
			const agentTextOutput = JSON.stringify({
				subtasks: [
					{ id: 1, title: 'Agent Subtask 1', description: 'Desc 1', dependencies: [], details: 'Details 1', status: 'pending' },
					{ id: 2, title: 'Agent Subtask 2', description: 'Desc 2', dependencies: [1], details: 'Details 2', status: 'pending' },
				],
			});
			const agentUsageData = { inputTokens: 10, outputTokens: 20 };

			mockGenerateTextService.mockResolvedValue({
				text: agentTextOutput,
				usage: agentUsageData,
				telemetryData: { /* ... */ },
			});

			const context = {
				...baseContext,
				agentTextOutput,
				agentUsageData,
			};

			const result = await expandTask(tasksPath, 1, null, false, '', context, false);

			expect(mockGenerateTextService).toHaveBeenCalledWith({
				agentTextOutput,
				agentUsageData,
				role: 'main', // expandTask defaults to 'main' if useResearch is false
				session: context.session,
				projectRoot: context.projectRoot,
				commandName: context.commandName,
				outputType: context.outputType,
			});
			expect(result.task.subtasks).toHaveLength(2);
			expect(result.task.subtasks[0].title).toBe('Agent Subtask 1');
			expect(result.task.subtasks[1].dependencies).toEqual([1]); // Assuming parseSubtasksFromText handles ID remapping
			expect(result.telemetryData).toBeDefined();
		});

		test('should throw if generateTextService throws in agent_driven mode (e.g. missing agentTextOutput in ai-services)', async () => {
			// This test relies on ai-services-unified to throw if agentTextOutput is missing.
			// Here, we simulate generateTextService itself throwing that error.
			mockGenerateTextService.mockRejectedValue(new Error("MCP_AI_MODE is agent_driven but agentTextOutput was not provided"));

			const context = { ...baseContext, agentUsageData: {} }; // Missing agentTextOutput

			await expect(
				expandTask(tasksPath, 1, null, false, '', context, false)
			).rejects.toThrow("MCP_AI_MODE is agent_driven but agentTextOutput was not provided");
		});
	});

	describe('Direct Mode', () => {
		beforeEach(() => {
			process.env.MCP_AI_MODE = 'direct'; // or delete to use default
		});

		test('should call generateTextService with prompts and parse its output', async () => {
			const llmTextOutput = JSON.stringify({
				subtasks: [
					{ id: 1, title: 'LLM Subtask 1', description: 'LLM Desc 1', dependencies: [], details: 'LLM Details 1', status: 'pending' },
				],
			});
			const usageData = { inputTokens: 100, outputTokens: 200 };

			mockGenerateTextService.mockResolvedValue({
				text: llmTextOutput,
				usage: usageData,
				telemetryData: { /* ... */ },
			});
			mockFsExistsSync.mockReturnValue(false); // No complexity report

			const result = await expandTask(tasksPath, 1, 1, false, 'additional user context', baseContext, false);

			expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
				prompt: expect.stringContaining('Break down this task into exactly 1 specific subtasks'),
				systemPrompt: expect.stringContaining('You are an AI assistant helping with task breakdown'),
				role: 'main',
				// Other params: session, projectRoot, commandName, outputType
			}));
			expect(result.task.subtasks).toHaveLength(1);
			expect(result.task.subtasks[0].title).toBe('LLM Subtask 1');
			expect(result.telemetryData).toBeDefined();
		});

		test('should use research role and prompts if useResearch is true', async () => {
			const llmTextOutput = JSON.stringify({ subtasks: [] });
			mockGenerateTextService.mockResolvedValue({ text: llmTextOutput, usage: {}, telemetryData: {} });
			mockFsExistsSync.mockReturnValue(false); // No complexity report

			await expandTask(tasksPath, 1, 1, true, '', baseContext, false);

			expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
				prompt: expect.stringContaining('Analyze the following task and break it down into exactly 1 specific subtasks using your research capabilities'),
				systemPrompt: expect.stringContaining("You are an AI assistant that responds ONLY with valid JSON objects as requested."), // Research system prompt is simpler
				role: 'research',
			}));
		});

		test('should handle failure from generateTextService', async () => {
			mockGenerateTextService.mockRejectedValue(new Error("AI service failed"));

			await expect(
				expandTask(tasksPath, 1, 1, false, '', baseContext, false)
			).rejects.toThrow("AI service failed");
		});

		test('should read complexity report if present and use its recommendations', async () => {
			const complexityReport = {
				complexityAnalysis: [{
					taskId: 1,
					complexityScore: 8,
					recommendedSubtasks: 2,
					expansionPrompt: "Use this special prompt for task 1",
					reasoning: "It's very complex."
				}]
			};
			mockFsExistsSync.mockImplementation(filePath => filePath.endsWith('task-complexity-report.json')); // Only complexity report exists
			mockReadJSON.mockImplementation(filePath => {
				if (filePath.endsWith('tasks.json')) return { tasks: [baseTask] };
				if (filePath.endsWith('task-complexity-report.json')) return complexityReport;
				return null;
			});
			mockGenerateTextService.mockResolvedValue({ text: JSON.stringify({subtasks:[]}), usage: {}, telemetryData: {} });

			await expandTask(tasksPath, 1, null, false, 'user context', baseContext, false); // numSubtasks is null to trigger report usage

			expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
				prompt: expect.stringContaining("Use this special prompt for task 1\n\nuser context\nComplexity Analysis Reasoning: It's very complex."),
				systemPrompt: expect.stringContaining("Generate exactly 2 subtasks"), // Num subtasks from report
			}));
		});
	});
});
