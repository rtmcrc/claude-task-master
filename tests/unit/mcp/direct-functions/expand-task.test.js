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

// Mock fs (for copyFileSync and existsSync - though initiate might not use them directly, expandTaskDirect does)
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
jest.unstable_mockModule('../../tools/utils.js', () => ({ // Path from direct-functions to tools
	createLogWrapper: mockCreateLogWrapper,
}));

// Import the functions to test
let initiateExpandTaskDirect;
// Import other functions if they are also tested in this file later
// let expandTaskDirect, submitExpandTaskResponseDirect;


describe('Direct Functions - expand-task', () => {
	const baseLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	const baseServerContext = { session: { id: 'test-session' } }; // Added session for completeness
	const defaultTasksJsonPath = '/fake/project/tasks.json';
	const defaultProjectRoot = '/fake/project';
	const defaultTaskId = '1';

	beforeAll(async () => {
		const module = await import('../../../../mcp-server/src/core/direct-functions/expand-task.js');
		initiateExpandTaskDirect = module.initiateExpandTaskDirect;
		// expandTaskDirect = module.expandTaskDirect;
		// submitExpandTaskResponseDirect = module.submitExpandTaskResponseDirect;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		// Default successful return for the core expandTask in 'initiate' phase
		mockCoreExpandTask.mockResolvedValue({
			interactionId: 'test-interaction-id-123',
			aiServiceRequest: { some: 'data' }
		});
		mockReadJSON.mockReturnValue({ tasks: [{ id: 1, title: 'Test Task', status: 'pending' }] });
		mockIsSilentMode.mockReturnValue(false); // Default to not silent initially
	});

	describe('initiateExpandTaskDirect', () => {
		const mockArgs = {
			tasksJsonPath: defaultTasksJsonPath,
			id: defaultTaskId,
			projectRoot: defaultProjectRoot,
			num: '5',
			research: true,
			prompt: 'Custom additional context',
			clientContext: { agentId: 'agent-007' }
		};

		test('should call core expandTask with delegationPhase: initiate in context and correct arguments', async () => {
			await initiateExpandTaskDirect(mockArgs, baseLog, baseServerContext);

			expect(mockCoreExpandTask).toHaveBeenCalledTimes(1);
			// Assert exactly 7 arguments were passed to the task-manager expandTask
			expect(mockCoreExpandTask.mock.calls[0].length).toBe(7);

			// Verify each argument passed to mockCoreExpandTask
			expect(mockCoreExpandTask.mock.calls[0][0]).toEqual(mockArgs.tasksJsonPath); // tasksJsonPath
			expect(mockCoreExpandTask.mock.calls[0][1]).toEqual(parseInt(mockArgs.id, 10)); // taskId
			expect(mockCoreExpandTask.mock.calls[0][2]).toEqual(parseInt(mockArgs.num, 10)); // numSubtasks
			expect(mockCoreExpandTask.mock.calls[0][3]).toEqual(mockArgs.research); // useResearch
			expect(mockCoreExpandTask.mock.calls[0][4]).toEqual(mockArgs.prompt); // additionalUserContext

			// 6th argument: context object
			expect(mockCoreExpandTask.mock.calls[0][5]).toEqual(
				expect.objectContaining({
					mcpLog: mockMcpLogInstance,
					session: baseServerContext.session,
					projectRoot: mockArgs.projectRoot,
					commandName: 'expand-task-initiate',
					outputType: 'mcp',
					clientContext: mockArgs.clientContext,
					delegationPhase: 'initiate' // Key assertion
				})
			);

			// 7th argument: forceFlag (should be false as passed by initiateExpandTaskDirect)
			expect(mockCoreExpandTask.mock.calls[0][6]).toBe(false);
		});

		test('should return success true with data on successful initiation', async () => {
			const expectedBundle = {
				interactionId: 'test-interaction-id-xyz',
				aiServiceRequest: { detail: 'detail' },
				clientContext: mockArgs.clientContext
			};
			mockCoreExpandTask.mockResolvedValueOnce(expectedBundle); // Ensure this specific mock is used

			const result = await initiateExpandTaskDirect(mockArgs, baseLog, baseServerContext);

			expect(result.success).toBe(true);
			expect(result.data).toEqual(expectedBundle);
		});

		test('should return error if core expandTask fails during initiation', async () => {
			const coreError = new Error('Core expandTask failed');
			mockCoreExpandTask.mockRejectedValueOnce(coreError);

			const result = await initiateExpandTaskDirect(mockArgs, baseLog, baseServerContext);

			expect(result.success).toBe(false);
			expect(result.error.code).toBe('INITIATE_EXPAND_ERROR');
			expect(result.error.message).toBe(coreError.message);
		});

		test('should return error if required arguments are missing', async () => {
			const result = await initiateExpandTaskDirect({ projectRoot: defaultProjectRoot, id: defaultTaskId }, baseLog, baseServerContext); // Missing tasksJsonPath
			expect(result.success).toBe(false);
			expect(result.error.code).toBe('MISSING_ARGUMENT');
		});
	});
});
