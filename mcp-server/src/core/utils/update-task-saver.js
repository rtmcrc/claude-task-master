import path from 'path';
import fs from 'fs';
import { readJSON, writeJSON } from '../../../../scripts/modules/utils.js'; // Path relative to new file
import generateTaskFiles from '../../../../scripts/modules/task-manager/generate-task-files.js'; // Path relative to new file
import { TASKMASTER_TASKS_FILE } from '../../../../src/constants/paths.js'; // Path relative to new file
// Import the parser from the core updateTaskById script
import { parseUpdatedTaskFromText } from '../../../../scripts/modules/task-manager/update-task-by-id.js';

/**
 * Saves updated task data (typically from an agent) to tasks.json.
 * This includes parsing the agent's output and applying updates carefully,
 * especially preserving completed subtasks.
 *
 * @param {any} agentOutput - The data received from the agent (finalLLMOutput).
 *                            Expected to be a JSON string of the updated task object.
 * @param {string|number} taskIdToUpdate - The ID of the task being updated (can be "parent.sub" string or number).
 * @param {string} projectRoot - The absolute path to the project root.
 * @param {Object} logWrapper - Logger object (e.g., from MCP context).
 * @param {Object} originalToolArgs - Original arguments passed to the 'update_task' tool. (Currently not used here but good for future if needed for context)
 * @returns {Promise<Object>} Result object with { success: true, updatedTask } or { success: false, error: string }.
 */
async function saveUpdatedTaskFromAgent(agentOutput, taskIdToUpdate, projectRoot, logWrapper, originalToolArgs) {
    logWrapper.info(`saveUpdatedTaskFromAgent: Saving updated task data for ID ${taskIdToUpdate}.`);

    const tasksJsonPath = path.resolve(projectRoot, TASKMASTER_TASKS_FILE);

    try {
        const allTasksData = readJSON(tasksJsonPath);
        if (!allTasksData || !Array.isArray(allTasksData.tasks)) {
            const errorMsg = `Invalid or missing tasks data in ${tasksJsonPath}.`;
            logWrapper.error(`saveUpdatedTaskFromAgent: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        let parsedAgentTask;
        if (typeof agentOutput === 'string') {
            logWrapper.info("saveUpdatedTaskFromAgent: Agent output is a string, attempting to parse with parseUpdatedTaskFromText.");
            // Ensure taskIdToUpdate is a number if it's not a subtask string ID for parseUpdatedTaskFromText
            const idForParser = (typeof taskIdToUpdate === 'string' && taskIdToUpdate.includes('.'))
                                ? taskIdToUpdate // Keep as string like "1.2"
                                : parseInt(String(taskIdToUpdate), 10);

            parsedAgentTask = parseUpdatedTaskFromText(agentOutput, idForParser, logWrapper, true /* isMCP */);
        } else if (typeof agentOutput === 'object' && agentOutput !== null) {
            logWrapper.info("saveUpdatedTaskFromAgent: Agent output is already an object. Validating and using directly.");
            // If agent returns an object, we might still want to run it through a Zod schema or similar validation.
            // For now, assuming it matches the structure `parseUpdatedTaskFromText` would produce.
            // The `parseUpdatedTaskFromText` itself does Zod validation.
            // We'd need to replicate that validation or trust the agent / have the agent use the Zod schema.
            // Let's assume for now the agent provides a valid task object as per schema if not string.
            // TODO: Add Zod validation here if agentOutput is an object.
            // For simplicity, if it's an object, we'll assume it's the task object directly.
            // This part might need refinement based on how agents will actually return structured objects.
            parsedAgentTask = agentOutput;
            if (parsedAgentTask.id !== taskIdToUpdate) { // Ensure ID consistency
                 logWrapper.warn(`Agent output object had ID ${parsedAgentTask.id}, expected ${taskIdToUpdate}. Overwriting ID.`);
                 parsedAgentTask.id = taskIdToUpdate;
            }
        } else {
            const errorMsg = "Invalid agentOutput format. Expected a JSON string or a task object.";
            logWrapper.error(`saveUpdatedTaskFromAgent: ${errorMsg} Received type: ${typeof agentOutput}`);
            return { success: false, error: errorMsg };
        }

        if (!parsedAgentTask || typeof parsedAgentTask !== 'object') {
            const errorMsg = `Task data from agent is invalid after parsing/processing: ${JSON.stringify(parsedAgentTask)}`;
            logWrapper.error(`saveUpdatedTaskFromAgent: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        // Logic to find and update the task (main task or subtask)
        let taskUpdated = false;
        let finalUpdatedTaskForReturn = null;

        if (typeof taskIdToUpdate === 'string' && taskIdToUpdate.includes('.')) {
            // Handling subtask update
            const [parentIdStr, subIdStr] = taskIdToUpdate.split('.');
            const parentId = parseInt(parentIdStr, 10);
            const subId = parseInt(subIdStr, 10);

            const parentTaskIndex = allTasksData.tasks.findIndex(t => t.id === parentId);
            if (parentTaskIndex === -1) {
                throw new Error(`Parent task ${parentId} for subtask ${taskIdToUpdate} not found.`);
            }
            if (!allTasksData.tasks[parentTaskIndex].subtasks) {
                 throw new Error(`Parent task ${parentId} has no subtasks array for subtask ${taskIdToUpdate}.`);
            }
            const subtaskIndex = allTasksData.tasks[parentTaskIndex].subtasks.findIndex(st => st.id === subId);
            if (subtaskIndex === -1) {
                throw new Error(`Subtask ${taskIdToUpdate} not found.`);
            }

            const originalSubtask = allTasksData.tasks[parentTaskIndex].subtasks[subtaskIndex];
            if (originalSubtask.status === 'done' || originalSubtask.status === 'completed') {
                 logWrapper.warn(`saveUpdatedTaskFromAgent: Subtask ${taskIdToUpdate} is completed and was not updated by agent.`);
                 finalUpdatedTaskForReturn = originalSubtask; // Return original
                 // No actual update, but not an error from saver's perspective if agent respected this.
            } else {
                // Apply updates, preserving completed sub-subtasks (if subtasks could have sub-subtasks - current model doesn't)
                // For subtasks, direct replacement is usually fine unless they have their own "completed children" concept.
                // The prompt for update_task already tells AI to preserve completed subtasks.
                // Here, parsedAgentTask is the subtask.
                allTasksData.tasks[parentTaskIndex].subtasks[subtaskIndex] = { ...originalSubtask, ...parsedAgentTask, id: subId }; // Ensure ID is correct
                finalUpdatedTaskForReturn = allTasksData.tasks[parentTaskIndex].subtasks[subtaskIndex];
                taskUpdated = true;
            }
        } else {
            // Handling main task update
            const taskIdNum = parseInt(String(taskIdToUpdate), 10);
            const taskIndex = allTasksData.tasks.findIndex(t => t.id === taskIdNum);
            if (taskIndex === -1) {
                throw new Error(`Task with ID ${taskIdNum} not found.`);
            }

            const originalTask = allTasksData.tasks[taskIndex];
            if (originalTask.status === 'done' || originalTask.status === 'completed') {
                logWrapper.warn(`saveUpdatedTaskFromAgent: Task ${taskIdNum} is completed and was not updated by agent.`);
                finalUpdatedTaskForReturn = originalTask; // Return original
            } else {
                // Preserve completed subtasks from originalTask if agent's task doesn't have them or mishandles them
                let finalSubtasks = parsedAgentTask.subtasks || [];
                if (originalTask.subtasks && originalTask.subtasks.length > 0) {
                    const completedOriginalSubtasks = originalTask.subtasks.filter(
                        st => st.status === 'done' || st.status === 'completed'
                    );
                    completedOriginalSubtasks.forEach(compSub => {
                        const updatedVersion = finalSubtasks.find(st => st.id === compSub.id);
                        if (!updatedVersion || JSON.stringify(updatedVersion) !== JSON.stringify(compSub)) {
                            logWrapper.warn(`saveUpdatedTaskFromAgent: Restoring completed subtask ${originalTask.id}.${compSub.id} as agent modified/removed it.`);
                            finalSubtasks = finalSubtasks.filter(st => st.id !== compSub.id); // Remove agent's version
                            finalSubtasks.push(compSub); // Add original completed one
                        }
                    });
                    // Deduplicate just in case & sort
                    const subtaskIds = new Set();
                    finalSubtasks = finalSubtasks.filter(st => {
                        if (!subtaskIds.has(st.id)) { subtaskIds.add(st.id); return true; }
                        return false;
                    }).sort((a,b) => a.id - b.id);
                }

                allTasksData.tasks[taskIndex] = {
                    ...originalTask,
                    ...parsedAgentTask,
                    id: taskIdNum, // Ensure ID
                    subtasks: finalSubtasks // Use merged subtasks
                };
                finalUpdatedTaskForReturn = allTasksData.tasks[taskIndex];
                taskUpdated = true;
            }
        }

        if (taskUpdated) {
            writeJSON(tasksJsonPath, allTasksData);
            logWrapper.info(`saveUpdatedTaskFromAgent: Successfully updated tasks.json for task/subtask ID ${taskIdToUpdate}.`);

            const outputDir = path.dirname(tasksJsonPath);
            await generateTaskFiles(tasksJsonPath, outputDir, { mcpLog: logWrapper });
            logWrapper.info(`saveUpdatedTaskFromAgent: Markdown task files regenerated after update.`);
        }

        return { success: true, updatedTask: finalUpdatedTaskForReturn, wasActuallyUpdated: taskUpdated };

    } catch (error) {
        logWrapper.error(`saveUpdatedTaskFromAgent: Error processing update for ID ${taskIdToUpdate}: ${error.message}`);
        logWrapper.error(`saveUpdatedTaskFromAgent: Error stack: ${error.stack}`);
        return { success: false, error: error.message };
    }
}

export { saveUpdatedTaskFromAgent };
