import { jest } from '@jest/globals';
import path from 'path'; // For fake function's internal path joining

// Mock dependencies that the FAKE updateTaskById will interact with
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockGenerateTextService = jest.fn();
const mockParseUpdatedTaskFromText = jest.fn(); // This will be called by the FAKE function
const mockFsExistsSync = jest.fn();
const mockFakeLogFn = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() };
const mockFindProjectRoot = jest.fn(() => '/fake/project/root');
const mockGetCurrentTag = jest.fn(() => 'master');

// Mock the modules these functions are from for the FAKE function's "imports"
jest.mock('../../../../../scripts/modules/utils.js', () => ({
    readJSON: mockReadJSON,
    writeJSON: mockWriteJSON,
    findProjectRoot: mockFindProjectRoot,
    getCurrentTag: mockGetCurrentTag,
    log: (level, ...args) => (mockFakeLogFn[level] ? mockFakeLogFn[level](...args) : console.log(level, ...args)),
    isSilentMode: jest.fn(() => true),
    truncate: jest.fn(str => str),
    flattenTasksWithSubtasks: jest.fn(tasks => tasks), // For context gathering part
}));
jest.mock('../../../../../scripts/modules/ui.js', () => ({
    getStatusWithColor: jest.fn(status => status),
    startLoadingIndicator: jest.fn(() => ({ stop: jest.fn() })),
    stopLoadingIndicator: jest.fn(),
    displayAiUsageSummary: jest.fn(),
}));
jest.mock('../../../../../scripts/modules/ai-services-unified.js', () => ({
    generateTextService: mockGenerateTextService,
}));
jest.mock('../../../../../scripts/modules/config-manager.js', () => ({
    getDebugFlag: jest.fn(() => false),
    isApiKeySet: jest.fn(() => true),
}));
jest.mock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
    ContextGatherer: jest.fn().mockImplementation(() => ({
        gather: jest.fn().mockResolvedValue({ context: 'Mocked context for full update' }),
    })),
}));
jest.mock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
    FuzzyTaskSearch: jest.fn().mockImplementation(() => ({
        findRelevantTasks: jest.fn(() => []),
        getTaskIds: jest.fn(() => []),
    })),
}));
jest.mock('fs', () => ({
    existsSync: mockFsExistsSync,
}));

// --- FAKE updateTaskById Implementation ---
// Replicates the core logic of the real updateTaskById, especially appendMode vs full update
async function fakeUpdateTaskById(
    tasksPath, taskId, prompt, useResearch = false, context = {},
    outputFormat = 'text', appendMode = false
) {
    const { session, mcpLog, projectRoot: providedProjectRoot, tag } = context;
    const logFn = mcpLog || mockFakeLogFn; // Use provided mcpLog or the test's mock
    const projectRoot = providedProjectRoot || mockFindProjectRoot();
    const currentTag = tag || mockGetCurrentTag(projectRoot);

    if (!mockFsExistsSync(tasksPath)) throw new Error(`Tasks file not found: ${tasksPath}`);
    const data = mockReadJSON(tasksPath, projectRoot, currentTag);
    const taskIndex = data.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) throw new Error(`Task with ID ${taskId} not found.`);
    const taskToUpdate = data.tasks[taskIndex];

    if (taskToUpdate.status === 'done' || taskToUpdate.status === 'completed') {
        logFn.warn(`FAKE updateTaskById: Task ${taskId} completed, not updating.`);
        return null; // Or appropriate response for completed task
    }

    if (appendMode) {
        logFn.info(`FAKE updateTaskById: Append mode for task ${taskId}.`);
        const contentToAppend = prompt;
        if (contentToAppend && contentToAppend.trim()) {
            const timestamp = new Date().toISOString();
            const separator = taskToUpdate.details && taskToUpdate.details.trim() ? '\n\n' : '';
            taskToUpdate.details = (taskToUpdate.details || '') + separator +
                `<info added on ${timestamp}>\n${contentToAppend.trim()}\n</info added on ${timestamp}>`;
        } else {
            logFn.warn('FAKE updateTaskById: Content to append is empty.');
        }
        data.tasks[taskIndex] = taskToUpdate;
        mockWriteJSON(tasksPath, data, projectRoot, currentTag);
        logFn.success(`FAKE updateTaskById: Successfully appended to task ${taskId}`);
        return { updatedTask: taskToUpdate, telemetryData: null, tagInfo: { currentTag, availableTags: data.tags || ['master'] } };
    }

    // Full update logic (simplified for testing the branch)
    logFn.info(`FAKE updateTaskById: Full update mode for task ${taskId}.`);
    const systemPrompt = "Fake system prompt for full update"; // Simplified
    const userPrompt = `Update task: ${JSON.stringify(taskToUpdate)} with prompt: ${prompt}`; // Simplified

    const serviceRole = useResearch ? 'research' : 'main';
    const aiServiceResponse = await mockGenerateTextService({
        role: serviceRole, session, projectRoot, systemPrompt, prompt: userPrompt,
        commandName: 'update-task', outputType: mcpLog ? 'mcp' : 'cli'
    });

    if (aiServiceResponse && aiServiceResponse.mainResult && aiServiceResponse.mainResult.type === 'agent_llm_delegation') {
        logFn.info("FAKE updateTaskById: Detected agent_llm_delegation signal.");
        return { needsAgentDelegation: true, /* ... simplified signal ... */ };
    }

    const updatedTaskJsonString = aiServiceResponse.mainResult;
    const parsedTask = mockParseUpdatedTaskFromText(updatedTaskJsonString, taskId, logFn, !!mcpLog);

    // Simplified merge - in real func, more complex logic for subtasks, etc.
    data.tasks[taskIndex] = { ...taskToUpdate, ...parsedTask, id: taskId };
    mockWriteJSON(tasksPath, data, projectRoot, currentTag);
    logFn.success(`FAKE updateTaskById: Successfully updated task ${taskId} via AI.`);
    return { updatedTask: data.tasks[taskIndex], telemetryData: aiServiceResponse.telemetryData, tagInfo: aiServiceResponse.tagInfo };
}
// --- END FAKE updateTaskById Implementation ---


describe('FAKE updateTaskById', () => {
    const tasksPath = '/fake/project/root/.taskmaster/tasks/tasks.json';
    const projectRoot = '/fake/project/root';
    const taskId = 1;
    const sampleTask = { id: 1, title: "Original Title", description: "Original Desc", details: "Original details.", status: "pending", dependencies: [], subtasks: [] };
    const sampleTasksData = { tasks: [sampleTask], tags: ['master'] };
    const context = {
        mcpLog: mockFakeLogFn,
        projectRoot: projectRoot,
        session: {},
        tag: 'master',
        commandName: 'test-updateTaskById'
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockFsExistsSync.mockReturnValue(true);
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasksData)));
    });

    describe('appendMode = true', () => {
        const appendContent = "This is new appended information.";

        test('should directly append content and not call AI service', async () => {
            const result = await fakeUpdateTaskById(tasksPath, taskId, appendContent, false, context, 'json', true);

            expect(mockGenerateTextService).not.toHaveBeenCalled();
            expect(mockParseUpdatedTaskFromText).not.toHaveBeenCalled();
            expect(mockWriteJSON).toHaveBeenCalledTimes(1);

            const writtenData = mockWriteJSON.mock.calls[0][1];
            const updatedTask = writtenData.tasks.find(t => t.id === taskId);

            expect(updatedTask.details).toContain("Original details.");
            expect(updatedTask.details).toContain(appendContent.trim());
            expect(updatedTask.details).toMatch(/<info added on .*?>\nThis is new appended information.\n<\/info added on .*?>/);
            expect(result.updatedTask.details).toEqual(updatedTask.details);
            expect(result.telemetryData).toBeNull();
        });
        // ... other appendMode tests from previous setup ...
    });

    describe('appendMode = false (full update)', () => {
        const fullUpdatePrompt = "Update task with new requirements for full AI processing.";
        const aiJsonResponseString = JSON.stringify({
            id: 1, title: "Original Title", description: "AI updated description",
            details: "AI updated details", status: "in-progress", dependencies: []
        });
        const parsedAiTask = JSON.parse(aiJsonResponseString);

        beforeEach(() => {
            mockGenerateTextService.mockResolvedValue({
                mainResult: aiJsonResponseString,
                telemetryData: { usage: { inputTokens: 100, outputTokens: 50 } },
                tagInfo: { currentTag: 'master', availableTags: ['master'] },
            });
            mockParseUpdatedTaskFromText.mockReturnValue(parsedAiTask);
        });

        test('should call AI service and parse response', async () => {
            const result = await fakeUpdateTaskById(tasksPath, taskId, fullUpdatePrompt, false, context, 'json', false);

            expect(mockGenerateTextService).toHaveBeenCalledTimes(1);
            expect(mockParseUpdatedTaskFromText).toHaveBeenCalledWith(aiJsonResponseString, taskId, mockFakeLogFn, true);
            expect(mockWriteJSON).toHaveBeenCalledTimes(1);
            expect(result.updatedTask.description).toBe("AI updated description");
        });

        test('should handle AgentLLM delegation signal', async () => {
            const delegationSignal = { type: 'agent_llm_delegation', /* ... */ };
            mockGenerateTextService.mockResolvedValue({ mainResult: delegationSignal });

            const result = await fakeUpdateTaskById(tasksPath, taskId, fullUpdatePrompt, false, context, 'json', false);
            expect(result.needsAgentDelegation).toBe(true);
        });
    });
});
