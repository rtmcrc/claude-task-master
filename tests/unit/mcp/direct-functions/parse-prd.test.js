import { jest } from '@jest/globals';

// Mock the core task manager function `parsePRD`
const mockCoreParsePRD = jest.fn();
jest.unstable_mockModule('../../../../scripts/modules/task-manager.js', () => ({
	parsePRD: mockCoreParsePRD,
}));

// Mock fs module for path resolution and file checks
const mockFsExistsSync = jest.fn();
const mockFsReadFileSync = jest.fn();
const mockFsMkdirSync = jest.fn();
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: mockFsExistsSync,
		readFileSync: mockFsReadFileSync,
		mkdirSync: mockFsMkdirSync,
	},
	existsSync: mockFsExistsSync,
	readFileSync: mockFsReadFileSync,
	mkdirSync: mockFsMkdirSync,
}));

// Mock path utilities if needed, e.g., resolvePrdPath, resolveProjectPath
const mockResolvePrdPath = jest.fn((options, session) => `/resolved${options.input || '/default-prd-path'}`);
const mockResolveProjectPath = jest.fn(filePath => `/resolved${filePath}`);
jest.unstable_mockModule('../../utils/path-utils.js', () => ({
	resolvePrdPath: mockResolvePrdPath,
	resolveProjectPath: mockResolveProjectPath,
}));


// Mock logger utility from mcp-server/src/tools/utils.js
const mockCreateLogWrapper = jest.fn();
const mockMcpLog = {
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
	success: jest.fn(),
};
mockCreateLogWrapper.mockReturnValue(mockMcpLog);
jest.unstable_mockModule('../../../tools/utils.js', () => ({ // Relative path from direct-functions to tools
	createLogWrapper: mockCreateLogWrapper,
}));

// Mock config-manager for getDefaultNumTasks
const mockGetDefaultNumTasks = jest.fn();
jest.unstable_mockModule('../../../../scripts/modules/config-manager.js', () => ({
    getDefaultNumTasks: mockGetDefaultNumTasks,
}));


// Import the functions to test
let initiateParsePRDDirect, submitParsePRDResponseDirect, parsePRDDirect;


describe('Direct Functions - parse-prd', () => {
	const baseLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	const baseSessionContext = { session: {} };

	beforeAll(async () => {
		const module = await import('../../../../mcp-server/src/core/direct-functions/parse-prd.js');
		initiateParsePRDDirect = module.initiateParsePRDDirect;
		submitParsePRDResponseDirect = module.submitParsePRDResponseDirect;
		parsePRDDirect = module.parsePRDDirect; // Assuming we might want to ensure it still works
	});

	beforeEach(() => {
		jest.clearAllMocks();
		mockGetDefaultNumTasks.mockReturnValue(10); // Default for tests
		mockFsExistsSync.mockReturnValue(true); // Assume files/paths exist by default
		mockFsReadFileSync.mockReturnValue("Sample PRD content");
	});

	describe('initiateParsePRDDirect', () => {
		const defaultInitiateArgs = {
			projectRoot: '/fake/project',
			input: '/prd.txt', // Will be resolved by mockResolvePrdPath
			numTasks: 5,
			research: false,
			clientContext: { user: 'test-user' },
		};

		test('should call core parsePRD with delegationPhase: initiate and map args correctly', async () => {
			const expectedInitiationBundle = { interactionId: 'init-123', aiServiceRequest: {} };
			mockCoreParsePRD.mockResolvedValue(expectedInitiationBundle);
			mockResolvePrdPath.mockReturnValueOnce('/fake/project/prd.txt');


			const result = await initiateParsePRDDirect(defaultInitiateArgs, baseLog, baseSessionContext);

			expect(mockCoreParsePRD).toHaveBeenCalledWith(
				'/fake/project/prd.txt', // resolvedPrdPath
				expect.stringContaining('temp_prd_initiate_tasks.json'), // nominalTasksPath
				defaultInitiateArgs.numTasks,
				expect.objectContaining({ // Options for parsePRD
					session: baseSessionContext.session,
					mcpLog: mockMcpLog,
					projectRoot: defaultInitiateArgs.projectRoot,
					research: defaultInitiateArgs.research,
					prdContent: "Sample PRD content",
					clientContext: defaultInitiateArgs.clientContext,
				}),
				expect.objectContaining({ // Context for parsePRD
					delegationPhase: 'initiate',
				})
			);
			expect(result.success).toBe(true);
			expect(result.data).toEqual(expectedInitiationBundle);
		});

		test('should use prdContent if provided', async () => {
			const argsWithContent = { ...defaultInitiateArgs, input: undefined, prdContent: "Direct PRD Text" };
			mockCoreParsePRD.mockResolvedValue({ interactionId: 'init-content-123' });

			await initiateParsePRDDirect(argsWithContent, baseLog, baseSessionContext);

			expect(mockFsReadFileSync).not.toHaveBeenCalled(); // Should not read from file if content is direct
			expect(mockCoreParsePRD).toHaveBeenCalledWith(
				'direct_content', // resolvedPrdPath when content is direct
				expect.any(String),
				argsWithContent.numTasks,
				expect.objectContaining({
					prdContent: "Direct PRD Text",
				}),
				expect.objectContaining({ delegationPhase: 'initiate' })
			);
		});

		test('should return error if projectRoot is missing', async () => {
			const result = await initiateParsePRDDirect({ ...defaultInitiateArgs, projectRoot: undefined }, baseLog, baseSessionContext);
			expect(result.success).toBe(false);
			expect(result.error.code).toBe('MISSING_ARGUMENT');
			expect(result.error.message).toContain('projectRoot is required');
		});

		test('should return error if neither input nor prdContent is provided', async () => {
			const result = await initiateParsePRDDirect({ ...defaultInitiateArgs, input: undefined, prdContent: undefined }, baseLog, baseSessionContext);
			expect(result.success).toBe(false);
			expect(result.error.code).toBe('MISSING_ARGUMENT');
			expect(result.error.message).toContain('PRD input or content is required');
		});
	});

	describe('submitParsePRDResponseDirect', () => {
		const defaultSubmitArgs = {
			interactionId: 'submit-123',
			rawLLMResponse: '{ "tasks": [] }',
			llmUsageData: { inputTokens: 10, outputTokens: 20 },
			projectRoot: '/fake/project',
			output: 'custom-tasks.json',
			force: false,
			append: false,
		};

		test('should call core parsePRD with delegationPhase: submit and map args correctly', async () => {
			const expectedSubmitResult = { success: true, tasksPath: '/fake/project/custom-tasks.json', telemetryData: {} };
			mockCoreParsePRD.mockResolvedValue(expectedSubmitResult);
			mockResolveProjectPath.mockImplementationOnce(tasksFile => `/fake/project/${tasksFile}`);


			const result = await submitParsePRDResponseDirect(defaultSubmitArgs, baseLog, baseSessionContext);

			expect(mockCoreParsePRD).toHaveBeenCalledWith(
				'delegated_submission', // nominalPrdPath
				'/fake/project/custom-tasks.json', // resolved outputPath
				0, // nominalNumTasks
				expect.objectContaining({ // Options for parsePRD
					session: baseSessionContext.session,
					mcpLog: mockMcpLog,
					projectRoot: defaultSubmitArgs.projectRoot,
					force: defaultSubmitArgs.force,
					append: defaultSubmitArgs.append,
					commandName: 'parse-prd-submit',
				}),
				expect.objectContaining({ // Context for parsePRD
					delegationPhase: 'submit',
					interactionId: defaultSubmitArgs.interactionId,
					rawLLMResponse: defaultSubmitArgs.rawLLMResponse,
					llmUsageData: defaultSubmitArgs.llmUsageData,
				})
			);
			expect(result.success).toBe(true);
			expect(result.data).toEqual(expect.objectContaining({
				outputPath: '/fake/project/custom-tasks.json'
			}));
		});

		test('should return error if interactionId is missing', async () => {
			const result = await submitParsePRDResponseDirect({ ...defaultSubmitArgs, interactionId: undefined }, baseLog, baseSessionContext);
			expect(result.success).toBe(false);
			expect(result.error.code).toBe('MISSING_ARGUMENT');
			expect(result.error.message).toContain('interactionId is required');
		});

		test('should create output directory if it does not exist', async () => {
			mockFsExistsSync.mockImplementation(p => p !== '/fake/project'); // mock output dir as not existing
			mockResolveProjectPath.mockImplementationOnce(tasksFile => `/fake/project/${tasksFile}`);
			await submitParsePRDResponseDirect(defaultSubmitArgs, baseLog, baseSessionContext);
			expect(mockFsMkdirSync).toHaveBeenCalledWith('/fake/project', { recursive: true });
		});
	});

	// Optional: Add a test for the original parsePRDDirect to ensure it still works (direct mode)
	describe('parsePRDDirect (Original Direct Mode)', () => {
		test('should call core parsePRD without delegationPhase for direct calls', async () => {
			const directArgs = {
				projectRoot: '/fake/project',
				input: '/prd.txt',
				output: 'tasks.json'
			};
			mockCoreParsePRD.mockResolvedValue({ success: true, tasksPath: '/fake/project/tasks.json' });
			mockResolvePrdPath.mockReturnValueOnce('/fake/project/prd.txt');
			mockResolveProjectPath.mockImplementationOnce(tasksFile => `/fake/project/${tasksFile}`);


			await parsePRDDirect(directArgs, baseLog, baseSessionContext);

			expect(mockCoreParsePRD).toHaveBeenCalledWith(
				'/fake/project/prd.txt', // inputPath
				'/fake/project/tasks.json', // outputPath
				10, // Default numTasks
				expect.objectContaining({
					projectRoot: directArgs.projectRoot,
					commandName: 'parse-prd'
				}),
				// The fifth argument is the 'context' for parsePRD, which should be empty or not have delegationPhase
				// For the original parsePRDDirect, it passes 'json' as the 5th arg, which is an error in the old code.
				// The refactored parsePRD now takes options (4th) and context (5th).
				// The original parsePRDDirect calls parsePRD(inputPath, outputPath, numTasks, options, 'json')
				// This 'json' will be treated as the context object. This is fine if parsePRD handles it.
				// The new parsePRD signature is parsePRD(prdPath, tasksPath, numTasks, options = {}, context = {})
				// So, 'json' becomes the `context` arg.
				// We should check that `delegationPhase` is NOT in this context.
				expect.objectContaining({
					delegationPhase: undefined
				})
			);
		});
	});
});
