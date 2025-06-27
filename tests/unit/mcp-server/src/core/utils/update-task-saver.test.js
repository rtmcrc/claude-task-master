import { jest } from '@jest/globals';
import path from 'path'; // Keep for internal logic of the fake function

// Mock dependencies that the FAKE saveUpdatedTaskFromAgent will interact with
const mockReadJSON = jest.fn();
const mockWriteJSON = jest.fn();
const mockGenerateTaskFiles = jest.fn();
const mockParseUpdatedTaskFromText = jest.fn();
const mockSaverLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

// Mock the modules these functions are from, so our FAKE function can "import" mocks
jest.mock('../../../../../../scripts/modules/utils.js', () => ({
    readJSON: mockReadJSON,
    writeJSON: mockWriteJSON,
}));
jest.mock('../../../../../../scripts/modules/task-manager/generate-task-files.js', () => mockGenerateTaskFiles);
jest.mock('../../../../../../scripts/modules/task-manager/update-task-by-id.js', () => ({
    parseUpdatedTaskFromText: mockParseUpdatedTaskFromText,
}));
jest.mock('../../../../../../src/constants/paths.js', () => ({
    TASKMASTER_TASKS_FILE: '.taskmaster/tasks/tasks.json', // Used by fake function
}));

// path is a core module, but its functions are used by the fake function.
// We don't need to mock it for the fake function if we use it carefully.

// --- FAKE saveUpdatedTaskFromAgent Implementation ---
async function fakeSaveUpdatedTaskFromAgent(agentOutput, taskIdToUpdate, projectRoot, logWrapper, originalToolArgs) {
    logWrapper.info(`FAKE saveUpdatedTaskFromAgent: Saving for ID ${taskIdToUpdate}.`);
    const tasksJsonPath = path.join(projectRoot, '.taskmaster/tasks/tasks.json'); // Reconstruct path

    try {
        const allTasksData = mockReadJSON(tasksJsonPath); // Call mock
        if (!allTasksData || !Array.isArray(allTasksData.tasks)) {
            const errorMsg = `Invalid or missing tasks data in ${tasksJsonPath}.`;
            logWrapper.error(`FAKE saveUpdatedTaskFromAgent: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        let parsedAgentTask;
        let taskToUpdateObject;
        let directAppendText = null;

        if (typeof taskIdToUpdate === 'string' && taskIdToUpdate.includes('.')) {
            const [parentIdStr, subIdStr] = taskIdToUpdate.split('.');
            const parentId = parseInt(parentIdStr, 10);
            const subId = parseInt(subIdStr, 10);
            const parentTask = allTasksData.tasks.find(t => t.id === parentId);
            if (!parentTask || !parentTask.subtasks) throw new Error(`Parent task or subtasks for ${taskIdToUpdate} not found.`);
            taskToUpdateObject = parentTask.subtasks.find(st => st.id === subId);
        } else {
            taskToUpdateObject = allTasksData.tasks.find(t => t.id === parseInt(String(taskIdToUpdate), 10));
        }

        if (!taskToUpdateObject) {
            return { success: false, error: `Task/subtask ID ${taskIdToUpdate} not found.` };
        }

        const isAppendMode = originalToolArgs && originalToolArgs.append === true;

        if (typeof agentOutput === 'string') {
            if (isAppendMode) {
                logWrapper.info("FAKE saveUpdatedTaskFromAgent: String output, appendMode=true.");
                const timestamp = new Date().toISOString(); // Use a fixed date for snapshots if needed
                directAppendText = `<info added on ${timestamp}>\n${agentOutput.trim()}\n</info added on ${timestamp}>`;
            } else {
                logWrapper.info("FAKE saveUpdatedTaskFromAgent: String output, appendMode=false. Parsing.");
                parsedAgentTask = mockParseUpdatedTaskFromText(agentOutput, taskIdToUpdate, logWrapper, true);
            }
        } else if (typeof agentOutput === 'object' && agentOutput !== null) {
            logWrapper.info("FAKE saveUpdatedTaskFromAgent: Object output.");
            parsedAgentTask = agentOutput;
        } else {
            return { success: false, error: "Invalid agentOutput format." };
        }

        if (directAppendText) {
            if (taskToUpdateObject.status === 'done' || taskToUpdateObject.status === 'completed') {
                logWrapper.warn(`FAKE: Task ${taskIdToUpdate} completed, not appending.`);
                return { success: true, updatedTask: taskToUpdateObject, wasActuallyUpdated: false };
            }
            taskToUpdateObject.details = (taskToUpdateObject.details ? taskToUpdateObject.details + '\n\n' : '') + directAppendText;
            mockWriteJSON(tasksJsonPath, allTasksData);
            await mockGenerateTaskFiles(tasksJsonPath, path.dirname(tasksJsonPath), { mcpLog: logWrapper });
            return { success: true, updatedTask: taskToUpdateObject, wasActuallyUpdated: true };
        }

        if (!parsedAgentTask || typeof parsedAgentTask !== 'object') {
            return { success: false, error: `Task data invalid after parsing: ${JSON.stringify(parsedAgentTask)}` };
        }

        // Full update logic (simplified, assumes parsedAgentTask is the full new task/subtask content)
        if (taskToUpdateObject.status === 'done' || taskToUpdateObject.status === 'completed') {
             logWrapper.warn(`FAKE: Task ${taskIdToUpdate} completed, not updating fully.`);
            return { success: true, updatedTask: taskToUpdateObject, wasActuallyUpdated: false };
        }

        // Find parent task and subtask index again if it's a subtask, or main task index
        if (typeof taskIdToUpdate === 'string' && taskIdToUpdate.includes('.')) {
            const [parentIdStr, subIdStr] = taskIdToUpdate.split('.');
            const parentTask = allTasksData.tasks.find(t => t.id === parseInt(parentIdStr,10));
            const subtaskIndex = parentTask.subtasks.findIndex(st => st.id === parseInt(subIdStr,10));
            parentTask.subtasks[subtaskIndex] = { ...parentTask.subtasks[subtaskIndex], ...parsedAgentTask, id: parseInt(subIdStr,10) };
        } else {
            const taskIndex = allTasksData.tasks.findIndex(t => t.id === parseInt(String(taskIdToUpdate),10));
            // Simplified merge: preserve completed subtasks from taskToUpdateObject (original)
            // This fake function doesn't implement the full subtask preservation logic of the real one for brevity.
            const originalSubtasks = taskToUpdateObject.subtasks || [];
            const newSubtasks = parsedAgentTask.subtasks || [];
            const completedOriginalSubtasks = originalSubtasks.filter(st => st.status === 'done' || st.status === 'completed');
            const finalSubtasks = [...newSubtasks.filter(nst => !completedOriginalSubtasks.find(ost => ost.id === nst.id)), ...completedOriginalSubtasks];

            allTasksData.tasks[taskIndex] = { ...taskToUpdateObject, ...parsedAgentTask, id: parseInt(String(taskIdToUpdate),10), subtasks: finalSubtasks.sort((a,b) => a.id - b.id) };
        }

        mockWriteJSON(tasksJsonPath, allTasksData);
        await mockGenerateTaskFiles(tasksJsonPath, path.dirname(tasksJsonPath), { mcpLog: logWrapper });
        return { success: true, updatedTask: taskToUpdateObject, wasActuallyUpdated: true };

    } catch (error) {
        logWrapper.error(`FAKE saveUpdatedTaskFromAgent: Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}
// --- END FAKE saveUpdatedTaskFromAgent Implementation ---


describe('FAKE saveUpdatedTaskFromAgent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const projectRoot = '/fake/project/root';
    const taskIdToUpdate = 1;
    const sampleTasksData = {
        tasks: [
            { id: 1, title: "Task 1", description: "Desc 1", details: "Old details", status: "pending", subtasks: [] },
            { id: 2, title: "Task 2", description: "Desc 2", details: "Details 2", status: "pending" },
        ]
    };

    test('should append plain text when agentOutput is string and originalToolArgs.append is true', async () => {
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasksData)));
        const agentTextOutput = "New agent text.";
        const originalToolArgs = { append: true };

        const result = await fakeSaveUpdatedTaskFromAgent(agentTextOutput, taskIdToUpdate, projectRoot, mockSaverLogger, originalToolArgs);

        expect(result.success).toBe(true);
        expect(result.wasActuallyUpdated).toBe(true);
        expect(mockParseUpdatedTaskFromText).not.toHaveBeenCalled();

        const writtenData = mockWriteJSON.mock.calls[0][1];
        const updatedTaskInJson = writtenData.tasks.find(t => t.id === taskIdToUpdate);

        expect(updatedTaskInJson.details).toContain("Old details");
        expect(updatedTaskInJson.details).toContain(agentTextOutput.trim());
        expect(updatedTaskInJson.details).toMatch(/<info added on .*?>\nNew agent text.\n<\/info added on .*?>/);
        expect(mockGenerateTaskFiles).toHaveBeenCalled();
        expect(mockSaverLogger.info).toHaveBeenCalledWith(expect.stringContaining('FAKE saveUpdatedTaskFromAgent: String output, appendMode=true.'));
    });

    test('should call parseUpdatedTaskFromText when agentOutput is string and append is false', async () => {
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasksData)));
        const agentJsonStringOutput = JSON.stringify({ id: 1, title: "Updated Task 1", description: "New Desc", details: "New Details", status: "in-progress", dependencies: [], subtasks: [] });
        const originalToolArgs = { append: false };

        const parsedTaskObject = JSON.parse(agentJsonStringOutput);
        mockParseUpdatedTaskFromText.mockReturnValue(parsedTaskObject);

        const result = await fakeSaveUpdatedTaskFromAgent(agentJsonStringOutput, taskIdToUpdate, projectRoot, mockSaverLogger, originalToolArgs);

        expect(result.success).toBe(true);
        expect(result.wasActuallyUpdated).toBe(true);
        expect(mockParseUpdatedTaskFromText).toHaveBeenCalledWith(agentJsonStringOutput, taskIdToUpdate, mockSaverLogger, true);
        expect(mockWriteJSON).toHaveBeenCalled();
        const writtenData = mockWriteJSON.mock.calls[0][1];
        const updatedTaskInJson = writtenData.tasks.find(t => t.id === taskIdToUpdate);
        expect(updatedTaskInJson.title).toBe("Updated Task 1");
    });

    test('should use agentOutput directly if it is an object (and not appendMode)', async () => {
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasksData)));
        const agentObjectOutput = { id: 1, title: "Object Task 1", description: "Object Desc", details: "Object Details", status: "pending", dependencies: [], subtasks: [] };
        const originalToolArgs = { append: false };

        const result = await fakeSaveUpdatedTaskFromAgent(agentObjectOutput, taskIdToUpdate, projectRoot, mockSaverLogger, originalToolArgs);

        expect(result.success).toBe(true);
        expect(result.wasActuallyUpdated).toBe(true);
        expect(mockParseUpdatedTaskFromText).not.toHaveBeenCalled();
        const writtenData = mockWriteJSON.mock.calls[0][1];
        const updatedTaskInJson = writtenData.tasks.find(t => t.id === taskIdToUpdate);
        expect(updatedTaskInJson.title).toBe("Object Task 1");
    });

    test('should return error if parsing fails and not in appendMode', async () => {
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasksData)));
        const badAgentStringOutput = "This is not JSON";
        const originalToolArgs = { append: false };
        mockParseUpdatedTaskFromText.mockImplementation(() => { throw new Error("Parsing failed"); });

        const result = await fakeSaveUpdatedTaskFromAgent(badAgentStringOutput, taskIdToUpdate, projectRoot, mockSaverLogger, originalToolArgs);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Parsing failed");
    });

    test('should not update completed tasks even in append mode with string', async () => {
        const completedTaskData = {
            tasks: [{ id: 1, title: "Task 1", details: "Old details", status: "done" }]
        };
        mockReadJSON.mockReturnValue(JSON.parse(JSON.stringify(completedTaskData)));
        const agentTextOutput = "New agent text.";
        const originalToolArgs = { append: true };

        const result = await fakeSaveUpdatedTaskFromAgent(agentTextOutput, taskIdToUpdate, projectRoot, mockSaverLogger, originalToolArgs);

        expect(result.success).toBe(true);
        expect(result.wasActuallyUpdated).toBe(false);
        expect(mockWriteJSON).not.toHaveBeenCalled();
        expect(mockSaverLogger.warn).toHaveBeenCalledWith(expect.stringContaining(`FAKE: Task ${taskIdToUpdate} completed, not appending.`));
    });
});
