import { jest } from '@jest/globals';

// Mock the core task manager function
const mockCoreExpandTask = jest.fn();
jest.unstable_mockModule('../../../../scripts/modules/task-manager/expand-task.js', () => ({
	default: mockCoreExpandTask,
}));

// Mock utils from scripts/modules/utils.js
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockEnableSilentMode = jest.fn();
const mockDisableSilentMode = jest.fn();
const mockIsSilentMode = jest.fn();
jest.unstable_mockModule('../../../../scripts/modules/utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	enableSilentMode: mockEnableSilentMode,
	disableSilentMode: mockDisableSilentMode,
	isSilentMode: mockIsSilentMode,
}));

// Mock fs (for copyFileSync and existsSync)
const mockCopyFileSync = jest.fn();
const mockFsExistsSync = jest.fn().mockReturnValue(true); // Default to true
jest.unstable_mockModule('fs', () => ({
	default: {
		copyFileSync: mockCopyFileSync,
		existsSync: mockFsExistsSync,
	},
	copyFileSync: mockCopyFileSync,
	existsSync: mockFsExistsSync,
}));

// Mock logger utility from mcp-server/src/tools/utils.js
const mockCreateLogWrapper = jest.fn();
const mockMcpLogInstance = { // The object returned by createLogWrapper
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
	success: jest.fn(),
};
mockCreateLogWrapper.mockReturnValue(mockMcpLogInstance);
jest.unstable_mockModule('../../tools/utils.js', () => ({
	createLogWrapper: mockCreateLogWrapper,
}));

// Import the functions to test
let expandTaskDirect, initiateExpandTaskDirect, submitExpandTaskResponseDirect;

describe('Direct Functions - expand-task', () => {
	const baseLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	const baseSessionContext = { session: {} };
	const defaultTasksJsonPath = '/fake/project/tasks.json';
	const defaultProjectRoot = '/fake/project';
	const defaultTaskId = '1';

	const mockTaskData = {
		tasks: [
			{ id: 1, title: 'Test Task 1', status: 'pending', subtasks: [] },
			{ id: 2, title: 'Test Task 2', status: 'done', subtasks: [] },
		],
	};

	beforeAll(async () => {
		const module = await import('../../../../mcp-server/src/core/direct-functions/expand-task.js');
		expandTaskDirect = module.expandTaskDirect;
		initiateExpandTaskDirect = module.initiateExpandTaskDirect;
		submitExpandTaskResponseDirect = module.submitExpandTaskResponseDirect;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		mockCoreExpandTask.mockResolvedValue({
			task: { ...mockTaskData.tasks[0], subtasks: [{id: 101, title: 'New Subtask'}] },
			telemetryData: { directCall: 'data' }
		});
		mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(mockTaskData)));
		mockIsSilentMode.mockReturnValue(false);
		mockFsExistsSync.mockReturnValue(true); // Default for file checks in expandTaskDirect
	});

	describe('expandTaskDirect (Original Direct Mode)', () => {
		test('should call core expandTask without delegationPhase for direct calls', async () => {
			const directArgs = {
				tasksJsonPath: defaultTasksJsonPath,
				id: defaultTaskId,
				projectRoot: defaultProjectRoot,
				num: '3',
				research: false,
				prompt: 'custom prompt',
				force: false,
			};

			await expandTaskDirect(directArgs, baseLog, baseSessionContext);

			expect(mockCoreExpandTask).toHaveBeenCalledWith(
				defaultTasksJsonPath,
				1, // Parsed task ID
				3, // Parsed num
				false, // research
				'custom prompt', // additionalContext
				expect.objectContaining({ // Core context for expandTask
					mcpLog: mockMcpLogInstance,
					session: baseSessionContext.session,
					projectRoot: defaultProjectRoot,
					commandName: 'expand-task', // Default commandName in expandTaskDirect
					outputType: 'mcp',         // Default outputType in expandTaskDirect
					// Ensure no delegation-specific fields are here from directArgs
					clientContext: undefined,
				}),
				false, // forceFlag
				// Context for delegation - should not have delegationPhase or be empty
				expect.objectContaining({
					delegationPhase: undefined,
					interactionId: undefined,
					rawLLMResponse: undefined,
					llmUsageData: undefined
				})
			);
		});
	});

	describe('initiateExpandTaskDirect', () => {
		test('should call core expandTask with delegationPhase: initiate', async () => {
			const initiateArgs = {
				tasksJsonPath: defaultTasksJsonPath,
				id: defaultTaskId,
				projectRoot: defaultProjectRoot,
				clientContext: { agent: 'test-agent' }
			};
			const expectedBundle = { interactionId: 'init-expand-123' };
			mockCoreExpandTask.mockResolvedValueOnce(expectedBundle);

			const result = await initiateExpandTaskDirect(initiateArgs, baseLog, baseSessionContext);

			expect(mockCoreExpandTask).toHaveBeenCalledWith(
				defaultTasksJsonPath,
				1,
				undefined,
				false,
				'',
				expect.objectContaining({ // 6th argument: context object for expandTask
					projectRoot: defaultProjectRoot,
					clientContext: initiateArgs.clientContext,
					commandName: 'expand-task-initiate',
					delegationPhase: 'initiate' // Ensure this is checked here
				}),
				false // 7th argument: forceFlag
				// No 8th argument should be here
			);
			expect(mockCoreExpandTask.mock.calls[0].length).toBe(7); // Verify exactly 7 arguments were passed
			expect(result.success).toBe(true);
			expect(result.data).toEqual(expectedBundle);
		});
	});

	describe('submitExpandTaskResponseDirect', () => {
		test('should call core expandTask with delegationPhase: submit', async () => {
			const submitArgs = {
				interactionId: 'submit-expand-456',
				rawLLMResponse: '{ "subtasks": [] }',
				llmUsageData: { tokens: 100 },
				tasksJsonPath: defaultTasksJsonPath,
				id: defaultTaskId,
				projectRoot: defaultProjectRoot,
			};
			const expectedResult = { task: { id: 1, subtasks: [] }, telemetryData: {} };
			mockCoreExpandTask.mockResolvedValueOnce(expectedResult);

			const result = await submitExpandTaskResponseDirect(submitArgs, baseLog, baseSessionContext);

			expect(mockCoreExpandTask).toHaveBeenCalledWith(
				defaultTasksJsonPath,
				1,
				null, // numSubtasks for core expandTask signature
				false, // useResearch for core expandTask signature
				'', // additionalContext for core expandTask signature
				expect.objectContaining({
					projectRoot: defaultProjectRoot,
					commandName: 'expand-task-submit',
				}),
				false, // force flag
				expect.objectContaining({
					delegationPhase: 'submit',
					interactionId: submitArgs.interactionId,
					rawLLMResponse: submitArgs.rawLLMResponse,
					llmUsageData: submitArgs.llmUsageData,
				})
			);
			expect(result.success).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({
				task: expectedResult.task
			}));
		});
	});
});
