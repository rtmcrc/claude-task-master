import path from 'path';
import fs from 'fs';
// Assuming updateTaskById and updateSubtaskById are accessible.
// They are in scripts/modules/task-manager/, so paths need to be relative from this new file's location.
import internalUpdateTaskById from '../../../../scripts/modules/task-manager/update-task-by-id.js'; // Default import
import internalUpdateSubtaskById from '../../../../scripts/modules/task-manager/update-subtask-by-id.js'; // Default import
// For handleSaveToFile, we might need to extract it from performResearch or replicate its core.
// For now, let's replicate a simplified version.

/**
 * Formats and saves research content to a file.
 * Simplified version of handleSaveToFile from performResearch.
 * @param {string} researchText - The main research text from the agent.
 * @param {string} query - The original research query.
 * @param {string} projectRoot - Absolute path to the project root.
 * @param {Object} log - Logger object.
 * @returns {Promise<string|null>} Path to saved file or null if error.
 */
async function saveResearchToFile(researchText, query, projectRoot, log) {
    try {
        const researchDir = path.join(projectRoot, '.taskmaster', 'docs', 'research');
        if (!fs.existsSync(researchDir)) {
            fs.mkdirSync(researchDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const querySlug = query
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .substring(0, 50)
            .replace(/^-+|-+$/g, '');

        const filename = `${timestamp}_${querySlug}.md`;
        const filePath = path.join(researchDir, filename);

        // Format content for file (simplified from performResearch's formatConversationForFile)
        const fileContent = `# Research Query: ${query}\n\n## Date: ${new Date().toLocaleDateString()}\n\n${researchText}`;

        fs.writeFileSync(filePath, fileContent, 'utf8');
        log.info(`handleAgentResearchResult (saveToFile): Research saved to: ${path.relative(projectRoot, filePath)}`);
        return filePath;
    } catch (error) {
        log.error(`handleAgentResearchResult (saveToFile): Error saving research file: ${error.message}`);
        return null;
    }
}


/**
 * Handles saving research output received from an agent to a task and/or file.
 * This is called by the MCP server core after an agent_llm callback for a 'research' tool delegation.
 *
 * @param {string} agentResearchText - The plain text research content from the agent.
 * @param {object} originalResearchArgs - The arguments from the initial 'research' tool call.
 *                                      Expected to contain: query, saveTo, saveToFile, detailLevel, projectRoot.
 * @param {string} projectRoot - Absolute path to the project root (can also be in originalResearchArgs).
 * @param {object} log - Logger object.
 * @param {object} sessionContext - The session context from the original MCP call (for internalUpdateContext).
 * @returns {Promise<{success: boolean, taskUpdated: boolean, filePath: string|null, error?: string}>}
 */
export async function handleAgentResearchResult(
    agentResearchText,
    originalResearchArgs,
    projectRoot, // Explicit projectRoot, also available in originalResearchArgs.projectRoot
    log,
    sessionContext
) {
    let taskUpdated = false;
    let savedFilePath = null;
    let overallSuccess = true;
    let errors = [];

    const {
        query,
        saveTo,
        saveToFile,
        detailLevel,
        // projectRoot is also in originalResearchArgs but passed separately for clarity
    } = originalResearchArgs;

    log.info(`handleAgentResearchResult: Processing agent research. saveTo: ${saveTo}, saveToFile: ${saveToFile}`);

    if (!agentResearchText || typeof agentResearchText !== 'string' || agentResearchText.trim() === '') {
        log.warn('handleAgentResearchResult: Agent research text is empty or invalid. Nothing to save.');
        return { success: false, taskUpdated, filePath: savedFilePath, error: "Agent provided no research content." };
    }

    // 1. Save to File if requested
    if (saveToFile) {
        log.info(`handleAgentResearchResult: Attempting to save research to file.`);
        try {
            savedFilePath = await saveResearchToFile(agentResearchText, query, projectRoot, log);
            if (!savedFilePath) {
                errors.push("Failed to save research to file.");
            }
        } catch (e) {
            log.error(`handleAgentResearchResult: Error in saveResearchToFile: ${e.message}`);
            errors.push(`File save error: ${e.message}`);
        }
    }

    // 2. Save to Task if requested
    if (saveTo) {
        log.info(`handleAgentResearchResult: Attempting to save research to task/subtask ID '${saveTo}'.`);
        try {
            const isSubtask = String(saveTo).includes('.');
            let researchContent = `## Research Query: ${query ? query.trim() : 'N/A'}\n\n`;
            if (detailLevel) researchContent += `**Detail Level:** ${detailLevel}\n`;
            // Add context size if available from originalResearchArgs.contextSize (would require passing it)
            researchContent += `**Timestamp:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()} (via Agent)\n\n`;
            researchContent += `### Results (from Agent)\n\n${agentResearchText.trim()}`;

            const tasksPath = path.join(projectRoot, '.taskmaster', 'tasks', 'tasks.json');
            log.debug(`handleAgentResearchResult: tasksPath for saveTo: ${tasksPath}`);

            const internalUpdateContext = {
                session: sessionContext,
                mcpLog: log,
                commandName: `research-agent-saveTo-${isSubtask ? 'subtask' : 'task'}`,
                outputType: 'mcp', // Assuming MCP context for logging within updateTaskById
                projectRoot: projectRoot,
                tag: sessionContext?.tag || undefined // Pass tag if available in session
            };
            log.debug(`handleAgentResearchResult: internalUpdateContext for saveTo: ${JSON.stringify(internalUpdateContext)}`);

            if (isSubtask) {
                await internalUpdateSubtaskById(
                    tasksPath,
                    String(saveTo),
                    researchContent, // This is the content to append
                    false,           // useResearch for this internal update = false
                    internalUpdateContext,
                    'json',          // outputFormat for internal call
                                     // appendMode is implicit in how updateSubtaskById handles string content
                );
            } else {
                const taskIdNum = parseInt(String(saveTo), 10);
                await internalUpdateTaskById(
                    tasksPath,
                    taskIdNum,
                    researchContent, // This is the content for updateTaskById's 'prompt'
                    false,           // useResearch for this internal update = false
                    internalUpdateContext,
                    'json',          // outputFormat for internal call
                    true             // appendMode = true
                );
            }
            taskUpdated = true;
            log.info(`handleAgentResearchResult: Research successfully saved/appended to task/subtask ${saveTo}.`);
        } catch (saveError) {
            log.error(`handleAgentResearchResult: Error saving research to task/subtask ${saveTo}: ${saveError.message}`);
            log.error(`handleAgentResearchResult: Save error stack: ${saveError.stack}`);
            errors.push(`Task save error: ${saveError.message}`);
        }
    }

    if (errors.length > 0) {
        overallSuccess = false;
    }

    return {
        success: overallSuccess,
        taskUpdated,
        filePath: savedFilePath,
        error: errors.length > 0 ? errors.join('; ') : undefined
    };
}
