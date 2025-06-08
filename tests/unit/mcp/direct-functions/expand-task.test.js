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
// Add any other utils used by expandTaskDirect
jest.unstable_mockModule('../../../../scripts/modules/utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	enableSilentMode: mockEnableSilentMode,
	disableSilentMode: mockDisableSilentMode,
	isSilentMode: mockIsSilentMode,
}));

// Mock fs (for copyFileSync)
const mockCopyFileSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
	default: {
		copyFileSync: mockCopyFileSync,
		// Add other fs mocks if expandTaskDirect uses them directly
		existsSync: jest.fn(() => true), // Default to true for basic file checks
	},
	copyFileSync: mockCopyFileSync,
	existsSync: jest.fn(() => true),
}));

// Mock logger utility from mcp-server/src/tools/utils.js
const mockCreateLogWrapper = jest.fn();
const mockMcpLog = { // The object returned by createLogWrapper
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
	success: jest.fn(),
};
mockCreateLogWrapper.mockReturnValue(mockMcpLog);
jest.unstable_mockModule('../../tools/utils.js', () => ({
	createLogWrapper: mockCreateLogWrapper,
}));

// Import the function to test
let expandTaskDirect;

describe('Direct Function - expandTaskDirect', () => {
	const baseArgs = {
		tasksJsonPath: '/fake/project/tasks.json',
		id: '1', // Task ID to expand
		projectRoot: '/fake/project',
	};
	const mockLog = { // The log object passed into expandTaskDirect
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
		debug: jest.fn(),
		success: jest.fn(),
	};
	const baseContext = { session: {} };
	const mockTaskData = {
		tasks: [
			{ id: 1, title: 'Test Task 1', description: '...', details: '...', subtasks: [], status: 'pending' },
			{ id: 2, title: 'Test Task 2', description: '...', details: '...', subtasks: [], status: 'done' },
		],
	};

	beforeAll(async () => {
		const module = await import('../../../../mcp-server/src/core/direct-functions/expand-task.js');
		expandTaskDirect = module.expandTaskDirect;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		// Default successful return for core expandTask
		mockCoreExpandTask.mockResolvedValue({
			task: { ...mockTaskData.tasks[0], subtasks: [{id: 101, title: 'New Subtask'}] },
			telemetryData: {}
		});
		mockReadJSON.mockReturnValue(mockTaskData); // Default mock for readJSON
		mockIsSilentMode.mockReturnValue(false); // Default to not silent initially
	});

	test('should call core expandTask with agentTextOutput and agentUsageData when provided', async () => {
		const args = {
			...baseArgs,
			agentTextOutput: 'Agent generated subtasks text',
			agentUsageData: { inputTokens: 5, outputTokens: 10 },
		};

		await expandTaskDirect(args, mockLog, baseContext);

		expect(mockCoreExpandTask).toHaveBeenCalledTimes(1);
		expect(mockCoreExpandTask).toHaveBeenCalledWith(
			args.tasksJsonPath,
			1, // Parsed task ID
			undefined, // numSubtasks (default)
			false, // useResearch (default)
			'', // additionalContext (default)
			expect.objectContaining({
				session: baseContext.session,
				projectRoot: args.projectRoot,
				agentTextOutput: args.agentTextOutput,
				agentUsageData: args.agentUsageData,
				commandName: 'expand-task',
				outputType: 'mcp',
			}),
			false // forceFlag (default)
		);
	});

	test('should call core expandTask without agent data when not provided', async () => {
		await expandTaskDirect(baseArgs, mockLog, baseContext);

		expect(mockCoreExpandTask).toHaveBeenCalledTimes(1);
		expect(mockCoreExpandTask).toHaveBeenCalledWith(
			baseArgs.tasksJsonPath,
			1,
			undefined,
			false,
			'',
			expect.objectContaining({
				session: baseContext.session,
				projectRoot: baseArgs.projectRoot,
				agentTextOutput: undefined, // Should be undefined
				agentUsageData: undefined, // Should be undefined
			}),
			false
		);
	});

	test('should return success:false if tasksJsonPath is missing', async () => {
		const args = { ...baseArgs, tasksJsonPath: undefined };
		const result = await expandTaskDirect(args, mockLog, baseContext);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('MISSING_ARGUMENT');
		expect(result.error.message).toContain('tasksJsonPath is required');
		expect(mockCoreExpandTask).not.toHaveBeenCalled();
	});

	test('should return success:false if task ID is missing', async () => {
		const args = { ...baseArgs, id: undefined };
		const result = await expandTaskDirect(args, mockLog, baseContext);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('INPUT_VALIDATION_ERROR');
		expect(result.error.message).toContain('Task ID is required');
	});

	test('should return success:false if task is already completed', async () => {
		const args = { ...baseArgs, id: '2' }; // Task 2 is 'done'
		const result = await expandTaskDirect(args, mockLog, baseContext);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('TASK_COMPLETED');
		expect(result.error.message).toContain('already marked as done');
	});

	test('should skip expansion if task has existing subtasks and force is false', async () => {
		mockReadJSON.mockReturnValue({
			tasks: [{ ...mockTaskData.tasks[0], subtasks: [{id: 100, title: "Existing"}] }]
		});
		const result = await expandTaskDirect(baseArgs, mockLog, baseContext);
		expect(result.success).toBe(true);
		expect(result.data.message).toContain('already has subtasks. Expansion skipped.');
		expect(mockCoreExpandTask).not.toHaveBeenCalled();
	});

	test('should clear existing subtasks and call core expandTask if force is true', async () => {
		const taskWithSubtasks = { ...mockTaskData.tasks[0], subtasks: [{id: 100, title: "Existing"}] };
		mockReadJSON.mockReturnValue({ tasks: [taskWithSubtasks] });
		const args = { ...baseArgs, force: true };

		await expandTaskDirect(args, mockLog, baseContext);

		// Check that writeJSON was called to clear subtasks (indirectly, by checking task.subtasks was empty before core call)
		// This is a bit harder to test directly without spying on task object modification.
		// We rely on the fact that expandTaskDirect modifies the 'task' object from 'data.tasks'
		// and then calls writeJSON. The core call should then receive the task with empty subtasks.
		// For this unit test, we mainly ensure coreExpandTask is called.

		expect(mockMcpLog.info).toHaveBeenCalledWith(expect.stringContaining('Force flag set. Clearing existing subtasks'));
		expect(mockCoreExpandTask).toHaveBeenCalledTimes(1);
	});

	test('should handle errors from core expandTask function', async () => {
		const coreError = new Error('Core expansion failed');
		mockCoreExpandTask.mockRejectedValue(coreError);

		const result = await expandTaskDirect(baseArgs, mockLog, baseContext);
		expect(result.success).toBe(false);
		expect(result.error.code).toBe('CORE_FUNCTION_ERROR');
		expect(result.error.message).toBe(coreError.message);
	});

	test('should enable and disable silent mode correctly', async () => {
		mockIsSilentMode.mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false); // Sequence of return values
		await expandTaskDirect(baseArgs, mockLog, baseContext);
		expect(mockEnableSilentMode).toHaveBeenCalledTimes(1);
		expect(mockDisableSilentMode).toHaveBeenCalledTimes(1);
	});

	test('should handle num, research, and prompt arguments', async () => {
		const args = {
			...baseArgs,
			num: '5',
			research: true,
			prompt: 'Custom context for expansion'
		};
		await expandTaskDirect(args, mockLog, baseContext);
		expect(mockCoreExpandTask).toHaveBeenCalledWith(
			args.tasksJsonPath,
			1,
			5, // numSubtasks
			true, // useResearch
			'Custom context for expansion', // additionalContext
			expect.anything(), // context object
			false
		);
	});
});
