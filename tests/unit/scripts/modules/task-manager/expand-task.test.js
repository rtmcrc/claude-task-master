import { jest } from '@jest/globals';

// Mock dependencies at the top
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockGenerateTextService = jest.fn();
const mockGetDefaultSubtasks = jest.fn();
const mockGetDebugFlag = jest.fn().mockReturnValue(false);
const mockFindComplexityReportPath = jest.fn();
const mockFsExistsSync = jest.fn();
const mockPathDirname = jest.fn();
const mockGenerateTaskFiles = jest.fn().mockResolvedValue(undefined); // Default mock

const mockStartLoadingIndicator = jest.fn(() => ({ stop: jest.fn() }));
const mockStopLoadingIndicator = jest.fn();
const mockDisplayAiUsageSummary = jest.fn();

const mockLogger = {
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
};

// Paths are relative to this test file's location: tests/unit/scripts/modules/task-manager/
jest.unstable_mockModule('../../../../../scripts/modules/utils.js', () => ({
	readJSON: mockReadJSON,
	writeJSON: mockWriteJSON,
	isSilentMode: jest.fn().mockReturnValue(false),
	log: jest.fn(), // Assuming 'log' from utils is also used internally or by logger setup
}));

jest.unstable_mockModule('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: mockGenerateTextService,
}));

jest.unstable_mockModule('../../../../../scripts/modules/config-manager.js', () => ({
	getDefaultSubtasks: mockGetDefaultSubtasks,
	getDebugFlag: mockGetDebugFlag,
}));

// Path for path-utils.js: from tests/unit/scripts/modules/task-manager/ to scripts/src/utils/
jest.unstable_mockModule('../../../../../../src/utils/path-utils.js', () => ({
	findComplexityReportPath: mockFindComplexityReportPath,
}));

jest.unstable_mockModule('../../../../../scripts/modules/ui.js', () => ({
    startLoadingIndicator: mockStartLoadingIndicator,
    stopLoadingIndicator: mockStopLoadingIndicator,
    displayAiUsageSummary: mockDisplayAiUsageSummary,
}));

jest.unstable_mockModule('../../../../../scripts/modules/task-manager/generate-task-files.js', () => ({
    default: mockGenerateTaskFiles,
}));

jest.unstable_mockModule('fs', () => ({
	existsSync: mockFsExistsSync,
	// Mock other fs functions if directly used by expandTask for other purposes
}));

jest.unstable_mockModule('path', () => ({
    dirname: mockPathDirname,
    join: jest.fn((...args) => args.join('/')), // Simple mock for path.join
	resolve: jest.fn((...args) => args.join('/')), // Simple mock for path.resolve
	basename: jest.fn(filePath => filePath.split('/').pop()), // Simple mock for path.basename
}));


// Import the function to test AFTER mocks
// Note: expand-task.js exports { expandTask as default, parseSubtasksFromText }
// So, we import the default export which is expandTask.
import expandTask from '../../../../../scripts/modules/task-manager/expand-task.js';


describe('expandTask', () => {
	const mockTasksPath = '/fake/project/.taskmaster/tasks/tasks.json';
	const mockProjectRoot = '/fake/project';
	const mockReportPath = '/fake/project/.taskmaster/reports/task-complexity-report.json';
	const mockTask = {
		id: 1,
		title: 'Test Task',
		description: 'A task to be expanded',
		details: 'Some details',
		subtasks: [],
	};
    const mockContext = {
        projectRoot: mockProjectRoot,
        mcpLog: mockLogger,
        session: {} // Add session to context for getDebugFlag
    };

	beforeEach(() => {
		// Reset mocks before each test
		mockReadJSON.mockReset();
		mockWriteJSON.mockReset();
		mockGenerateTextService.mockReset();
		mockGetDefaultSubtasks.mockReset();
		mockGetDebugFlag.mockReset(); // Reset this as well
		mockFindComplexityReportPath.mockReset();
		mockFsExistsSync.mockReset();
		mockPathDirname.mockReset();
        mockGenerateTaskFiles.mockReset();
        mockStartLoadingIndicator.mockClear();
        mockStopLoadingIndicator.mockClear();
        mockDisplayAiUsageSummary.mockClear();

		mockLogger.info.mockClear();
		mockLogger.warn.mockClear();
		mockLogger.error.mockClear();
		mockLogger.debug.mockClear();

		// Default mock implementations
        // Simulate tasksPath leading to a project root for path.dirname calls
        mockPathDirname.mockImplementation(p => {
            if (p === mockTasksPath) return '/fake/project/.taskmaster/tasks';
            if (p === '/fake/project/.taskmaster/tasks') return '/fake/project/.taskmaster';
            if (p === '/fake/project/.taskmaster') return mockProjectRoot;
            return p.substring(0, p.lastIndexOf('/')) || '/';
        });

		mockReadJSON.mockReturnValue({ tasks: [{ ...mockTask }] }); // Return a copy
		mockGetDefaultSubtasks.mockReturnValue(3);
        mockGetDebugFlag.mockReturnValue(false); // Default debug flag
		mockGenerateTextService.mockResolvedValue({
			mainResult: '{\"subtasks\":[{\"id\":1,\"title\":\"Subtask 1\",\"description\":\"Desc 1\",\"dependencies\":[],\"details\":\"Details 1\",\"status\":\"pending\",\"testStrategy\":\"Test strat 1\"}]}',
			telemetryData: { cost: 0.001, tokens: 100, provider: 'test', model: 'test-model' },
		});
	});

	it('should call findComplexityReportPath to locate the complexity report', async () => {
		mockFindComplexityReportPath.mockReturnValue(mockReportPath);
		mockFsExistsSync.mockReturnValue(true); // Simulate report file exists

		await expandTask(mockTasksPath, 1, null, false, '', mockContext, false);

		expect(mockFindComplexityReportPath).toHaveBeenCalledTimes(1);
		// The logger inside expandTask is created based on mcpLog or a default.
		// We pass mockContext which contains mcpLog: mockLogger.
		// So, the logger passed to findComplexityReportPath should be mockLogger.
		expect(mockFindComplexityReportPath).toHaveBeenCalledWith(null, mockContext, mockLogger);
		expect(mockFsExistsSync).toHaveBeenCalledWith(mockReportPath);
	});

	it('should proceed if complexity report is not found, using default subtask count', async () => {
		mockFindComplexityReportPath.mockReturnValue(mockReportPath); // Path util still returns a path
		mockFsExistsSync.mockReturnValue(false); // But fs.existsSync says it's not there

		await expandTask(mockTasksPath, 1, null, false, '', mockContext, false);

		expect(mockFindComplexityReportPath).toHaveBeenCalledTimes(1);
        expect(mockFindComplexityReportPath).toHaveBeenCalledWith(null, mockContext, mockLogger);
		expect(mockFsExistsSync).toHaveBeenCalledWith(mockReportPath); // It will check the path given by findComplexityReportPath
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`Complexity report not found at ${mockReportPath}. Skipping complexity check.`));
		expect(mockGetDefaultSubtasks).toHaveBeenCalledTimes(1);
		expect(mockGenerateTextService).toHaveBeenCalled();
	});

    it('should use explicit numSubtasks if provided, ignoring complexity report and defaults', async () => {
        const explicitNum = 5;
        mockFindComplexityReportPath.mockReturnValue(mockReportPath);
        mockFsExistsSync.mockReturnValue(true); // Report exists
        // Mock readJSON for complexity report to return something
        mockReadJSON.mockImplementation(filePath => {
            if (filePath === mockTasksPath) return { tasks: [{ ...mockTask }] };
            if (filePath === mockReportPath) return { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: 2, expansionPrompt: "Test Prompt" }] };
            return {};
        });

        await expandTask(mockTasksPath, 1, explicitNum, false, '', mockContext, false);

        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`Using explicitly provided subtask count: ${explicitNum}`));
        expect(mockGetDefaultSubtasks).not.toHaveBeenCalled();
        // Check if generateMainUserPrompt (implicitly called by generateTextService args) used explicitNum
        const generateTextServiceCallArgs = mockGenerateTextService.mock.calls[0][0];
        expect(generateTextServiceCallArgs.prompt).toContain(`Break down this task into exactly ${explicitNum} specific subtasks`);
    });

    it('should use subtask count from complexity report if numSubtasks is not explicit and report has recommendation', async () => {
        const reportRecommendedSubtasks = 4;
        mockFindComplexityReportPath.mockReturnValue(mockReportPath);
        mockFsExistsSync.mockReturnValue(true);
        mockReadJSON.mockImplementation(filePath => {
            if (filePath === mockTasksPath) return { tasks: [{ ...mockTask }] };
            if (filePath === mockReportPath) return { complexityAnalysis: [{ taskId: 1, recommendedSubtasks: reportRecommendedSubtasks, expansionPrompt: "Test Prompt" }] };
            return {};
        });

        await expandTask(mockTasksPath, 1, null, false, '', mockContext, false);

        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(`Using subtask count from complexity report: ${reportRecommendedSubtasks}`));
        expect(mockGetDefaultSubtasks).not.toHaveBeenCalled();
        const generateTextServiceCallArgs = mockGenerateTextService.mock.calls[0][0];
        expect(generateTextServiceCallArgs.prompt).toContain(`Generate exactly ${reportRecommendedSubtasks} subtasks`); // System prompt for report prompts
    });
});
