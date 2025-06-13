import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

import { log as cliLog, readJSON } from '../utils.js';
import { formatDependenciesWithStatus } from '../ui.js';
import { validateAndFixDependencies } from '../dependency-manager.js';
import { getDebugFlag } from '../config-manager.js';

function dispatchLog(level, options, ...args) {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : arg)).join(' ');
    if (options && options.mcpLog) {
        const mcpLogger = options.mcpLog;
        if (typeof mcpLogger[level] === 'function') {
            mcpLogger[level](message);
        } else if (level === 'success' && typeof mcpLogger.info === 'function') {
            // Map 'success' to 'info' if mcpLog.success doesn't exist but info does
            mcpLogger.info(message);
        } else if (typeof mcpLogger.info === 'function') {
            // Default to info if specific level method not found on mcpLogger
            mcpLogger.info(`[${level.toUpperCase()}] ${message}`);
        } else {
            // Fallback if mcpLogger is very basic or unrecognised
            cliLog('info', `[MCP FALLBACK - ${level.toUpperCase()}] ${message}`);
        }
    } else {
        // Fallback to original CLI logging if mcpLog is not provided
        cliLog(level, ...args); // Spread original args here for cliLog's formatting
    }
}

/**
 * Generate individual task files from tasks.json
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} outputDir - Output directory for task files
 * @param {Object} options - Additional options (mcpLog for MCP mode)
 * @returns {Object|undefined} Result object in MCP mode, undefined in CLI mode
 */
function generateTaskFiles(tasksPath, outputDir, options = {}) {
	try {
		// Determine if we're in MCP mode by checking for mcpLog
		const isMcpMode = !!options?.mcpLog;

		const data = readJSON(tasksPath);
		if (!data || !data.tasks) {
			throw new Error(`No valid tasks found in ${tasksPath}`);
		}

		// Create the output directory if it doesn't exist
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		dispatchLog('info', options, `Preparing to regenerate ${data.tasks.length} task files`);

		// Validate and fix dependencies before generating files
		dispatchLog('info', options, `Validating and fixing dependencies`);
		validateAndFixDependencies(data, tasksPath);

		// Get valid task IDs from tasks.json
		const validTaskIds = data.tasks.map((task) => task.id);

		// Cleanup orphaned task files
		dispatchLog('info', options, 'Checking for orphaned task files to clean up...');
		try {
			// Get all task files in the output directory
			const files = fs.readdirSync(outputDir);
			const taskFilePattern = /^task_(\d+)\.txt$/;

			// Filter for task files and check if they match a valid task ID
			const orphanedFiles = files.filter((file) => {
				const match = file.match(taskFilePattern);
				if (match) {
					const fileTaskId = parseInt(match[1], 10);
					return !validTaskIds.includes(fileTaskId);
				}
				return false;
			});

			// Delete orphaned files
			if (orphanedFiles.length > 0) {
				dispatchLog(
					'info',
					options,
					`Found ${orphanedFiles.length} orphaned task files to remove`
				);

				orphanedFiles.forEach((file) => {
					const filePath = path.join(outputDir, file);
					try {
						fs.unlinkSync(filePath);
						dispatchLog('info', options, `Removed orphaned task file: ${file}`);
					} catch (err) {
						dispatchLog(
							'warn',
							options,
							`Failed to remove orphaned task file ${file}: ${err.message}`
						);
					}
				});
			} else {
				dispatchLog('info', options, 'No orphaned task files found');
			}
		} catch (err) {
			dispatchLog('warn', options, `Error cleaning up orphaned task files: ${err.message}`);
			// Continue with file generation even if cleanup fails
		}

		// Generate task files
		dispatchLog('info', options, 'Generating individual task files...');
		data.tasks.forEach((task) => {
			const taskPath = path.join(
				outputDir,
				`task_${task.id.toString().padStart(3, '0')}.txt`
			);

			// Format the content
			let content = `# Task ID: ${task.id}\n`;
			content += `# Title: ${task.title}\n`;
			content += `# Status: ${task.status || 'pending'}\n`;

			// Format dependencies with their status
			if (task.dependencies && task.dependencies.length > 0) {
				content += `# Dependencies: ${formatDependenciesWithStatus(task.dependencies, data.tasks, false)}\n`;
			} else {
				content += '# Dependencies: None\n';
			}

			content += `# Priority: ${task.priority || 'medium'}\n`;
			content += `# Description: ${task.description || ''}\n`;

			// Add more detailed sections
			content += '# Details:\n';
			content += (task.details || '')
				.split('\n')
				.map((line) => line)
				.join('\n');
			content += '\n\n';

			content += '# Test Strategy:\n';
			content += (task.testStrategy || '')
				.split('\n')
				.map((line) => line)
				.join('\n');
			content += '\n';

			// Add subtasks if they exist
			if (task.subtasks && task.subtasks.length > 0) {
				content += '\n# Subtasks:\n';

				task.subtasks.forEach((subtask) => {
					content += `## ${subtask.id}. ${subtask.title} [${subtask.status || 'pending'}]\n`;

					if (subtask.dependencies && subtask.dependencies.length > 0) {
						// Format subtask dependencies
						let subtaskDeps = subtask.dependencies
							.map((depId) => {
								if (typeof depId === 'number') {
									// Handle numeric dependencies to other subtasks
									const foundSubtask = task.subtasks.find(
										(st) => st.id === depId
									);
									if (foundSubtask) {
										// Just return the plain ID format without any color formatting
										return `${task.id}.${depId}`;
									}
								}
								return depId.toString();
							})
							.join(', ');

						content += `### Dependencies: ${subtaskDeps}\n`;
					} else {
						content += '### Dependencies: None\n';
					}

					content += `### Description: ${subtask.description || ''}\n`;
					content += '### Details:\n';
					content += (subtask.details || '')
						.split('\n')
						.map((line) => line)
						.join('\n');
					content += '\n\n';
				});
			}

			// Write the file
			fs.writeFileSync(taskPath, content);
			// dispatchLog('info', options, `Generated: task_${task.id.toString().padStart(3, '0')}.txt`); // Pollutes the CLI output
		});

		dispatchLog(
			'success',
			options,
			`All ${data.tasks.length} tasks have been generated into '${outputDir}'.`
		);

		// Return success data in MCP mode
		if (isMcpMode) {
			return {
				success: true,
				count: data.tasks.length,
				directory: outputDir
			};
		}
	} catch (error) {
		// Use dispatchLog for the main error message
		dispatchLog('error', options, `Error generating task files: ${error.message}`);

		// Only show error UI in CLI mode
		if (!options?.mcpLog) { // This condition is key
			console.error(chalk.red(`Error generating task files: ${error.message}`));

			if (getDebugFlag()) {
				// Use getter
				console.error(error);
			}

			process.exit(1);
		} else {
			// In MCP mode, throw the error for the caller to handle
			throw error;
		}
	}
}

export default generateTaskFiles;
