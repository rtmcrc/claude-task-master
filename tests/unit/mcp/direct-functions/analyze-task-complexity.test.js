import { jest } from '@jest/globals';

// Mock the core task manager function
const mockCoreAnalyzeTaskComplexity = jest.fn();
jest.unstable_mockModule('../../../../scripts/modules/task-manager/analyze-task-complexity.js', () => ({
	default: mockCoreAnalyzeTaskComplexity,
}));

// Mock fs for existsSync (used by direct function for output path checking)
const mockFsExistsSync = jest.fn().mockReturnValue(true); // Assume output path exists by default
jest.unstable_mockModule('fs', () => ({
	default: {
		existsSync: mockFsExistsSync,
		// Add other fs mocks if analyzeTaskComplexityDirect uses them directly
	},
	existsSync: mockFsExistsSync,
}));

// Mock logger utility
const mockCreateLogWrapper = jest.fn();
const mockMcpLogInstance = {
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

// Mock path utilities (needed for resolving output path)
const mockPathResolve = jest.fn((...paths) => paths.join('/').replace(/\/\//g, '/'));
const mockPathDirname = jest.fn((p) => p.substring(0, p.lastIndexOf('/')) || '.');
jest.unstable_mockModule('path', () => ({
	default: {
		resolve: mockPathResolve,
		dirname: mockPathDirname,
		// Add other path mocks if needed
	},
	resolve: mockPathResolve,
	dirname: mockPathDirname,
}));


// Import the functions to test
let analyzeTaskComplexityDirect, initiateAnalyzeTaskComplexityDirect, submitAnalyzeTaskComplexityResponseDirect;


describe('Direct Functions - analyze-task-complexity', () => {
	const baseLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	const baseSessionContext = { session: {} };
	const defaultTasksJsonPath = '/fake/project/tasks.json';
	const defaultOutputPath = '/fake/project/.taskmaster/reports/task-complexity-report.json';
	const defaultProjectRoot = '/fake/project';

	beforeAll(async () => {
		const module = await import('../../../../mcp-server/src/core/direct-functions/analyze-task-complexity.js');
		analyzeTaskComplexityDirect = module.analyzeTaskComplexityDirect;
		initiateAnalyzeTaskComplexityDirect = module.initiateAnalyzeTaskComplexityDirect;
		submitAnalyzeTaskComplexityResponseDirect = module.submitAnalyzeTaskComplexityResponseDirect;
	});

	beforeEach(() => {
		jest.clearAllMocks();
		mockCoreAnalyzeTaskComplexity.mockResolvedValue({
			report: { meta: {}, complexityAnalysis: [] },
			telemetryData: { directCall: 'data' }
		});
		mockFsExistsSync.mockReturnValue(true); // Default for file/path checks
		mockPathResolve.mockImplementation((...paths) => paths.join('/').replace(/\/+/g, '/')); // Simple mock for resolve
		mockPathDirname.mockImplementation(p => p.substring(0, p.lastIndexOf('/')) || '.');

	});

	describe('analyzeTaskComplexityDirect (Original Direct Mode)', () => {
		test('should call core analyzeTaskComplexity without delegationPhase for direct calls', async () => {
			const directArgs = {
				tasksJsonPath: defaultTasksJsonPath,
				outputPath: defaultOutputPath,
				projectRoot: defaultProjectRoot,
				threshold: 5,
				research: false,
			};

			await analyzeTaskComplexityDirect(directArgs, baseLog, baseSessionContext);

			expect(mockCoreAnalyzeTaskComplexity).toHaveBeenCalledWith(
				expect.objectContaining({ // coreOptions
					file: defaultTasksJsonPath,
					output: defaultOutputPath, // Should be resolved path
					projectRoot: defaultProjectRoot,
					threshold: 5,
					research: false,
				}),
				expect.objectContaining({ // context for task manager analyzeTaskComplexity
					session: baseSessionContext.session,
					mcpLog: mockMcpLogInstance,
					commandName: 'analyze-complexity',
					outputType: 'mcp',
					delegationPhase: undefined, // Crucial check
				})
			);
		});
	});

	describe('initiateAnalyzeTaskComplexityDirect', () => {
		test('should call core analyzeTaskComplexity with delegationPhase: initiate', async () => {
			const initiateArgs = {
				tasksJsonPath: defaultTasksJsonPath,
				projectRoot: defaultProjectRoot,
				clientContext: { agent: 'test-agent-analyzer' }
				// other args like ids, from, to, research can be added if needed for specific tests
			};
			const expectedBundle = { interactionId: 'init-analyze-123', aiServiceRequest: {} };
			mockCoreAnalyzeTaskComplexity.mockResolvedValueOnce(expectedBundle);
			// Mock path.resolve for the nominal output path construction if it's different from default
			mockPathResolve.mockImplementationOnce((root, file) => `${root}/${file}`);


			const result = await initiateAnalyzeTaskComplexityDirect(initiateArgs, baseLog, baseSessionContext);

			expect(mockCoreAnalyzeTaskComplexity).toHaveBeenCalledWith(
				expect.objectContaining({
					file: defaultTasksJsonPath,
					projectRoot: defaultProjectRoot,
					// output path for initiate is nominal, check it's formed correctly if sensitive
				}),
				expect.objectContaining({
					clientContext: initiateArgs.clientContext,
					commandName: 'analyze-complexity-initiate',
					delegationPhase: 'initiate'
				})
			);
			expect(result.success).toBe(true);
			expect(result.data).toEqual(expectedBundle);
		});
	});

	describe('submitAnalyzeTaskComplexityResponseDirect', () => {
		test('should call core analyzeTaskComplexity with delegationPhase: submit', async () => {
			const submitArgs = {
				interactionId: 'submit-analyze-456',
				rawLLMResponse: '[{ "taskId": 1 }]',
				llmUsageData: { tokens: 150 },
				tasksJsonPath: defaultTasksJsonPath, // Needed for context by core function
				outputPath: defaultOutputPath,     // Where to save the final report
				projectRoot: defaultProjectRoot,
			};
			const expectedReport = { report: { meta: {}, complexityAnalysis: [{ taskId: 1 }] }, telemetryData: {} };
			mockCoreAnalyzeTaskComplexity.mockResolvedValueOnce(expectedReport);
			mockPathResolve.mockImplementation((root, file) => {
				if (file) return `${root}/${file}`;
				return root;
			});


			const result = await submitAnalyzeTaskComplexityResponseDirect(submitArgs, baseLog, baseSessionContext);

			expect(mockCoreAnalyzeTaskComplexity).toHaveBeenCalledWith(
				expect.objectContaining({ // coreOptions
					file: defaultTasksJsonPath,
					output: defaultOutputPath, // Resolved path
					projectRoot: defaultProjectRoot,
				}),
				expect.objectContaining({ // context for task manager
					commandName: 'analyze-complexity-submit',
					delegationPhase: 'submit',
					interactionId: submitArgs.interactionId,
					rawLLMResponse: submitArgs.rawLLMResponse,
					llmUsageData: submitArgs.llmUsageData,
				})
			);
			expect(result.success).toBe(true);
			expect(result.data.fullReport).toEqual(expectedReport.report);
		});
	});
});
