import { FastMCP } from 'fastmcp';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import fs from 'fs';
import logger from './logger.js';
import { registerTaskMasterTools } from './tools/index.js';
import { createErrorResponse } from './tools/utils.js'; // Added for error responses
// import { v4 as uuidv4 } from 'uuid'; // Already in agent_llm.js and agent-llm.js, not directly needed here yet unless core generates IDs

// Load environment variables
dotenv.config();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main MCP server class that integrates with Task Master
 */
class TaskMasterMCPServer {
	constructor() {
		// Get version from package.json using synchronous fs
		const packagePath = path.join(__dirname, '../../package.json');
		const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

		this.options = {
			name: 'Task Master MCP Server',
			version: packageJson.version
		};

		this.server = new FastMCP(this.options);
		this.initialized = false;
		this.pendingAgentLLMInteractions = new Map(); // For managing paused states
		this.registeredTools = new Map(); // Internal tool registry

		this.server.addResource({});

		this.server.addResourceTemplate({});

		// Bind methods
		this.init = this.init.bind(this);
		this.start = this.start.bind(this);
		this.stop = this.stop.bind(this);

		// Setup logging
		this.logger = logger;
	}

	/**
	 * Initialize the MCP server with necessary tools and routes
	 */
	async init() {
		if (this.initialized) return;

		// Create a custom tool registrar that wraps execute methods
		// AND populates our internal registry
		const customToolRegistrar = {
			addTool: ({ name, description, parameters, execute }) => {
				const wrappedExecute = this._getWrappedToolExecutor(name, execute);

				// Add to FastMCP's registry (as before)
				this.server.addTool({
					name,
					description,
					parameters,
					execute: wrappedExecute,
				});

				// Add to our internal registry
				this.registeredTools.set(name, { name, description, parameters, execute: wrappedExecute });
				this.logger.info(`TaskMasterMCPServer: Tool '${name}' registered internally and with FastMCP.`);
			},
		};

		// Pass the custom registrar to the tool registration function
		registerTaskMasterTools(customToolRegistrar, this.asyncManager);

		this.initialized = true;

		return this;
	}

	/**
	 * Start the MCP server
	 */
	async start() {
		if (!this.initialized) {
			await this.init();
		}

		// Start the FastMCP server with increased timeout
		await this.server.start({
			transportType: 'stdio',
			timeout: 120000 // 2 minutes timeout (in milliseconds)
		});

		return this;
	}

	/**
	 * Stop the MCP server
	 */
	async stop() {
		if (this.server) {
			await this.server.stop();
		}
	}

	_getWrappedToolExecutor(toolName, originalExecute) {
		return async (toolArgs, context) => {
			const { log, session } = context; // context provided by FastMCP

			// Normal tool execution
			const toolResult = await originalExecute(toolArgs, context);

			if (toolResult && toolResult.pendingInteraction && toolResult.pendingInteraction.type === 'agent_llm') {
				const { interactionId, delegatedCallDetails } = toolResult.pendingInteraction;

				if (!interactionId) {
					log.error(`TaskMasterMCPServer: pendingInteraction for '${toolName}' is missing interactionId.`);
					return createErrorResponse(`Internal error: pendingInteraction missing interactionId for ${toolName}`);
				}

				const agentLLMTool = this.registeredTools.get('agent_llm');
				// Check for agentLLMTool *before* creating and storing a promise
				if (!agentLLMTool) {
					log.error("TaskMasterMCPServer: Critical error - 'agent_llm' tool not found in internal registry. Cannot delegate for tool '" + toolName + "'.");
					// Note: No pendingData to reject here yet, as the promise hasn't been created.
					return createErrorResponse("Internal server error: 'agent_llm' tool not found, cannot delegate for " + toolName);
				}

				log.info(`TaskMasterMCPServer: Detected pendingInteraction for '${toolName}'. Interaction ID: ${interactionId}. Delegating to agent_llm tool.`);
				const promiseForAgentResponse = new Promise((resolve, reject) => {
					this.pendingAgentLLMInteractions.set(interactionId, {
						originalToolName: toolName,
						originalToolArgs: toolArgs,
						session,
						resolve,
						reject,
						timestamp: Date.now(),
					});
				});

				const projectRoot = toolArgs.projectRoot || session?.roots?.[0]?.uri || '.';
				agentLLMTool.execute({ interactionId, delegatedCallDetails, projectRoot }, { log, session })
					.then(agentDirectiveResult => {
						log.info(`TaskMasterMCPServer: agent_llm directive to agent for ID ${interactionId} sent. Agent response: ${JSON.stringify(agentDirectiveResult)}`);
					})
					.catch(error => {
						log.error(`TaskMasterMCPServer: Error calling agent_llm for initial delegation (ID ${interactionId}): ${error.message}`);
						const pendingData = this.pendingAgentLLMInteractions.get(interactionId);
						if (pendingData) {
							pendingData.reject(new Error(`Failed to delegate to agent_llm: ${error.message}`));
							this.pendingAgentLLMInteractions.delete(interactionId);
						}
					});
				return promiseForAgentResponse;

			} else if (toolName === 'agent_llm' && toolResult && toolResult.interactionId && toolResult.hasOwnProperty('finalLLMOutput')) {
				const { interactionId, finalLLMOutput, error, status: agentLLMStatus } = toolResult;
				const pendingData = this.pendingAgentLLMInteractions.get(interactionId);

				if (pendingData) {
					log.info(`TaskMasterMCPServer: Received agent_llm response for ID ${interactionId}. Resuming original command: ${pendingData.originalToolName}`);
					if (agentLLMStatus === 'llm_response_error' || error) {
						const agentError = error || (typeof finalLLMOutput === 'string' ? new Error(finalLLMOutput) : new Error('Agent LLM call failed'));
						pendingData.reject(agentError);
					} else {
						pendingData.resolve(finalLLMOutput);
					}
					this.pendingAgentLLMInteractions.delete(interactionId);
					return { status: "agent_response_processed_by_taskmaster", interactionId };
				} else {
					log.warn(`TaskMasterMCPServer: Received agent_llm response for unknown or expired interaction ID: ${interactionId}`);
					return createErrorResponse(`Agent response for unknown/expired interaction ID: ${interactionId}`);
				}
			}

			// Default case: return the original tool result if no special handling applies
			return toolResult;
		};
	}
}

export default TaskMasterMCPServer;
