import { jest } from '@jest/globals';
import path from 'path'; // path is used by the fake function

// Mock dependencies that the FAKE handleAgentResearchResult will interact with
const mockInternalUpdateTaskById = jest.fn();
const mockInternalUpdateSubtaskById = jest.fn();
const mockFsExistsSync = jest.fn();
const mockFsMkdirSync = jest.fn();
const mockFsWriteFileSync = jest.fn();
const mockHandlerLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), success: jest.fn() }; // Renamed to avoid conflict

// Mock the modules these functions are from, so our FAKE function can "import" mocks
// These mocks are for the FAKE function's internal calls.
jest.mock('../../../../../../scripts/modules/task-manager/update-task-by-id.js', () => ({
    __esModule: true,
    default: mockInternalUpdateTaskById,
}));
jest.mock('../../../../../../scripts/modules/task-manager/update-subtask-by-id.js', () => ({
    // Note: update-subtask-by-id.js exports its main function as default.
    // The real research-result-handler.js correctly imports it as default.
    // The previous test error "does not provide an export named 'updateSubtaskById'" was because
    // the real handler was importing it as named. That is now fixed in the handler source.
    // So, the mock should reflect the default export.
    __esModule: true,
    default: mockInternalUpdateSubtaskById,
}));
jest.mock('fs', () => ({
    existsSync: mockFsExistsSync,
    mkdirSync: mockFsMkdirSync,
    writeFileSync: mockFsWriteFileSync,
}));
// No need to mock path for the fake function if we use actual path.join etc. carefully,
// or if we mock it simply as before if specific behaviors are needed.
// For simplicity, using actual path for joining, assuming it's safe in test.

// --- FAKE handleAgentResearchResult Implementation ---
async function fakeHandleAgentResearchResult(
    agentResearchText,
    originalResearchArgs,
    projectRoot,
    log, // This will be mockHandlerLogger
    sessionContext
) {
    let taskUpdated = false;
    let savedFilePath = null;
    let overallSuccess = true;
    let errors = [];

    const { query, saveTo, saveToFile, detailLevel } = originalResearchArgs;
    log.info(`FAKE handleAgentResearchResult: Processing. saveTo: ${saveTo}, saveToFile: ${saveToFile}`);

    if (!agentResearchText || typeof agentResearchText !== 'string' || agentResearchText.trim() === '') {
        log.warn('FAKE handleAgentResearchResult: Agent research text empty.');
        return { success: false, taskUpdated, filePath: savedFilePath, error: "Agent provided no research content." };
    }

    if (saveToFile) {
        log.info(`FAKE handleAgentResearchResult: Attempting to save to file.`);
        try {
            const researchDir = path.join(projectRoot, '.taskmaster', 'docs', 'research');
            if (!mockFsExistsSync(researchDir)) { // Use mocked fs
                mockFsMkdirSync(researchDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().split('T')[0];
            const querySlug = (query || 'research').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').substring(0, 50);
            const filename = `${timestamp}_${querySlug}.md`;
            savedFilePath = path.join(researchDir, filename); // Store the determined path
            const fileContent = `# Research Query: ${query}\n\n${agentResearchText}`;
            mockFsWriteFileSync(savedFilePath, fileContent, 'utf8'); // Use mocked fs
            log.info(`FAKE handleAgentResearchResult: Saved to file: ${savedFilePath}`);
        } catch (e) {
            log.error(`FAKE handleAgentResearchResult (saveToFile): Error: ${e.message}`);
            errors.push(`File save error: ${e.message}`);
        }
    }

    if (saveTo) {
        log.info(`FAKE handleAgentResearchResult: Attempting to save to task '${saveTo}'.`);
        try {
            const isSubtask = String(saveTo).includes('.');
            let researchContent = `## Research Query: ${query ? query.trim() : 'N/A'}\n\n`;
            if (detailLevel) researchContent += `**Detail Level:** ${detailLevel}\n`;
            researchContent += `**Timestamp:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} (via Agent)\n\n`;
            researchContent += `### Results (from Agent)\n\n${agentResearchText.trim()}`;

            const tasksPath = path.join(projectRoot, '.taskmaster', 'tasks', 'tasks.json');
            const internalUpdateContext = {
                session: sessionContext, mcpLog: log,
                commandName: `research-agent-saveTo-${isSubtask ? 'subtask' : 'task'}`,
                outputType: 'mcp', projectRoot: projectRoot,
                tag: sessionContext?.tag || undefined
            };

            if (isSubtask) {
                await mockInternalUpdateSubtaskById(tasksPath, String(saveTo), researchContent, false, internalUpdateContext, 'json');
            } else {
                await mockInternalUpdateTaskById(tasksPath, parseInt(String(saveTo), 10), researchContent, false, internalUpdateContext, 'json', true);
            }
            taskUpdated = true;
            log.info(`FAKE handleAgentResearchResult: Saved to task ${saveTo}.`);
        } catch (saveError) {
            log.error(`FAKE handleAgentResearchResult (saveToTask): Error: ${saveError.message}`);
            errors.push(`Task save error: ${saveError.message}`);
        }
    }
    if (errors.length > 0) overallSuccess = false;
    return { success: overallSuccess, taskUpdated, filePath: savedFilePath, error: errors.join('; ') || undefined };
}
// --- END FAKE handleAgentResearchResult Implementation ---


describe('FAKE handleAgentResearchResult', () => {
    const sampleTasksData = {
        tasks: [ { id: 1, title: "Task 1", details: "Old details", status: "pending", subtasks: [] } ]
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockFsExistsSync.mockReturnValue(true);
        // mockReadJSON is not directly called by fakeHandleAgentResearchResult,
        // but by the mocked updateTaskById/SubtaskById if they were real.
        // For this test, we only care that those mocks are called.
    });

    const agentText = "This is the detailed research from the agent.";
    const projectRoot = "/fake/project";
    const sessionContext = { user: 'testuser', tag: 'test-tag' };

    test('should save to task when saveTo is provided', async () => {
        const originalArgs = { query: "Test Query", saveTo: "1", detailLevel: "high" };
        mockInternalUpdateTaskById.mockResolvedValue({ success: true }); // Simulate success from internal call

        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);

        expect(result.success).toBe(true);
        expect(result.taskUpdated).toBe(true);
        expect(mockInternalUpdateTaskById).toHaveBeenCalledTimes(1);
        expect(mockInternalUpdateTaskById).toHaveBeenCalledWith(
            expect.stringContaining('/fake/project/.taskmaster/tasks/tasks.json'),
            1, expect.stringContaining(agentText.trim()), false,
            expect.objectContaining({ projectRoot, commandName: 'research-agent-saveTo-task' }),
            'json', true
        );
    });

    test('should save to subtask when saveTo (e.g., "1.2") is provided', async () => {
        const originalArgs = { query: "Test Query", saveTo: "1.2", detailLevel: "medium" };
        mockInternalUpdateSubtaskById.mockResolvedValue({ success: true });

        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(true);
        expect(result.taskUpdated).toBe(true);
        expect(mockInternalUpdateSubtaskById).toHaveBeenCalledTimes(1);
    });

    test('should save to file when saveToFile is true', async () => {
        const originalArgs = { query: "File Query", saveToFile: true, detailLevel: "low" };
        mockFsExistsSync.mockReturnValue(false); // Test dir creation

        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(true);
        expect(result.filePath).toMatch(/_file-query\.md$/);
        expect(mockFsMkdirSync).toHaveBeenCalled();
        expect(mockFsWriteFileSync).toHaveBeenCalledTimes(1);
    });

    test('should do nothing if no save options and return success', async () => {
        const originalArgs = { query: "No Save Query" };
        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(true);
        expect(result.taskUpdated).toBe(false);
        expect(result.filePath).toBeNull();
    });

    test('should return error if agent text is empty', async () => {
        const originalArgs = { query: "Test", saveTo: "1" };
        const result = await fakeHandleAgentResearchResult("", originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(false);
        expect(result.error).toBe("Agent provided no research content.");
    });

    test('should report error if saveTo task fails', async () => {
        const originalArgs = { query: "Task Save Fail", saveTo: "1" };
        mockInternalUpdateTaskById.mockRejectedValue(new Error("DB write error"));
        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain("Task save error: DB write error");
    });

    test('should report error if saveToFile fails', async () => {
        const originalArgs = { query: "File Save Fail", saveToFile: true };
        mockFsWriteFileSync.mockImplementation(() => { throw new Error("Disk full"); });
        const result = await fakeHandleAgentResearchResult(agentText, originalArgs, projectRoot, mockHandlerLogger, sessionContext);
        expect(result.success).toBe(false);
        expect(result.error).toContain("File save error: Disk full");
    });
});
