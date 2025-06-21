/**
 * Tests for the research MCP tool (Simplified, following add-task.test.js pattern)
 *
 * This test ensures:
 * 1. The tool registration (simulated) uses the correct parameters.
 * 2. Arguments are passed correctly to a mocked researchDirect.
 * 3. The agent LLM delegation signal is handled correctly by the simulated execute logic.
 * 4. Error handling works as expected within the simulated execute logic.
 *
 * The actual research.js tool file is NOT imported or tested directly.
 */
import { jest } from '@jest/globals';

// Mock researchDirect from its actual source file (or task-master-core)
// This mock will be called by our *fake* tool implementation below.
const mockResearchDirectFn = jest.fn();
jest.mock('../../../../mcp-server/src/core/direct-functions/research.js', () => ({
    researchDirect: mockResearchDirectFn,
}));
jest.mock('../../../../mcp-server/src/core/task-master-core.js', () => ({
    researchDirect: mockResearchDirectFn,
}));


// Mock utility functions from tools/utils.js
const mockHandleApiResult = jest.fn((result) => result);
const mockCreateErrorResponse = jest.fn((msg) => ({
    isError: true,
    error: { code: 'TOOL_ERROR', message: msg }
}));
// withNormalizedProjectRoot is part of the real tool's structure.
// Our fake tool below will simulate its effect if necessary, or bypass it.
// For this pattern, we often don't need to mock it as we control the fake execute function.
const mockWithNormalizedProjectRoot = jest.fn(fn => fn);


jest.mock('../../../../mcp-server/src/tools/utils.js', () => ({
    handleApiResult: mockHandleApiResult,
    createErrorResponse: mockCreateErrorResponse,
    withNormalizedProjectRoot: mockWithNormalizedProjectRoot, // Will be used by the real tool if we were importing it
}));

// Simplified Zod mock for parameter definition, similar to add-task.test.js
const mockZodParam = { describe: jest.fn(() => mockZodParam), optional: jest.fn(() => mockZodParam), enum: jest.fn(() => mockZodParam) };
const mockZodObject = {
    object: jest.fn(() => mockZodObject),
    string: jest.fn(() => mockZodParam),
    boolean: jest.fn(() => mockZodParam),
    optional: jest.fn(() => mockZodObject),
    describe: jest.fn(() => mockZodObject),
    enum: jest.fn(() => mockZodParam),
    // Add dummy _def.shape for basic compatibility if any test code introspects it (though unlikely for this pattern)
    _def: { shape: () => ({
        query: {}, taskIds: {}, filePaths: {}, customContext: {},
        includeProjectTree: {}, detailLevel: {}, saveTo: {},
        saveToFile: {}, projectRoot: {}
    })}
};
jest.mock('zod', () => ({
    z: mockZodObject,
}));


// --- FAKE Tool Implementation ---
// This is a simplified, local version of registerResearchTool and its execute logic
const registerResearchTool = (server) => {
    const toolConfig = {
        name: 'research',
        description: 'Perform AI-powered research queries with project context',
        parameters: mockZodObject.object({ // Simulate Zod schema definition
            query: mockZodObject.string().describe('Research query/prompt (required)'),
            taskIds: mockZodObject.string().optional().describe('Comma-separated list of task/subtask IDs'),
            filePaths: mockZodObject.string().optional().describe('Comma-separated list of file paths'),
            customContext: mockZodObject.string().optional().describe('Additional custom context text'),
            includeProjectTree: mockZodObject.boolean().optional().describe('Include project file tree structure'),
            detailLevel: mockZodObject.enum(['low', 'medium', 'high']).optional().describe('Detail level for the research response'),
            saveTo: mockZodObject.string().optional().describe('Automatically save research results to task/subtask ID'),
            saveToFile: mockZodObject.boolean().optional().describe('Save research results to .taskmaster/docs/research/'),
            projectRoot: mockZodObject.string().describe('The directory of the project.')
        }),
        // Our FAKE execute function
        execute: async (args, { log, session }) => {
            // This logic simulates the real tool's execute function, including the new delegation handling.
            // It calls the mockResearchDirectFn directly.
            try {
                log.info(`Executing FAKE research tool with args: ${JSON.stringify(args)}`);

                // Simulate projectRoot normalization if it were done by withNormalizedProjectRoot
                // For this fake tool, we assume args.projectRoot is already correct as passed in.

                const result = await mockResearchDirectFn(
                    {
                        query: args.query,
                        taskIds: args.taskIds,
                        filePaths: args.filePaths,
                        customContext: args.customContext,
                        includeProjectTree: args.includeProjectTree || false,
                        detailLevel: args.detailLevel || 'medium',
                        saveTo: args.saveTo,
                        saveToFile: args.saveToFile || false,
                        projectRoot: args.projectRoot // Assume projectRoot is correctly provided
                    },
                    log,
                    { session }
                );

                // === BEGIN AGENT_LLM_DELEGATION SIGNAL HANDLING (copied from real tool) ===
                if (result && result.needsAgentDelegation === true && result.pendingInteraction) {
                    log.info("FAKE research tool: Agent delegation signaled. Returning EmbeddedResource structure.");
                    const pendingInteractionDetailsForAgent = result.pendingInteraction;
                    return {
                        content: [{
                            type: "resource",
                            resource: {
                                uri: "agent-llm://pending-interaction",
                                mimeType: "application/json",
                                text: JSON.stringify({
                                    isAgentLLMPendingInteraction: true,
                                    details: pendingInteractionDetailsForAgent
                                })
                            }
                        }],
                        isError: false
                    };
                }
                // === END AGENT_LLM_DELEGATION SIGNAL HANDLING ===

                return mockHandleApiResult(
                    result,
                    log,
                    'Error performing research',
                    undefined,
                    args.projectRoot
                );
            } catch (error) {
                log.error(`Error in FAKE research tool: ${error.message}`);
                return mockCreateErrorResponse(error.message);
            }
        }
    };
    server.addTool(toolConfig);
};
// --- END FAKE Tool Implementation ---


// Test data
const baseArgs = {
    query: 'Test query about project structure',
    projectRoot: '/mock/project/root' // Crucial: ensure this is provided
};
const researchSuccessData = {
    query: 'Test query about project structure',
    result: 'The project is structured well.',
    contextSize: 1000,
};
const successResponseFromDirect = { success: true, data: researchSuccessData };
const delegationDetails = {
    interactionId: 'test-interaction-id',
    llmRequest: { model: 'test-model', prompt: 'delegated_prompt' }
};
const delegationSignalFromDirect = {
    needsAgentDelegation: true,
    pendingInteraction: delegationDetails
};


describe('MCP Tool: research (Simplified Pattern)', () => {
    let mockServer;
    let executeFunction;

    const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };

    beforeEach(() => {
        jest.clearAllMocks(); // Clear all mocks, including mockResearchDirectFn

        mockResearchDirectFn.mockResolvedValue(successResponseFromDirect); // Default mock behavior

        mockServer = {
            addTool: jest.fn((config) => {
                executeFunction = config.execute;
            })
        };
        registerResearchTool(mockServer); // Register our FAKE tool
    });

    test('should register the FAKE tool correctly', () => {
        expect(mockServer.addTool).toHaveBeenCalledTimes(1);
        const toolConfig = mockServer.addTool.mock.calls[0][0];
        expect(toolConfig.name).toBe('research');
        expect(toolConfig.description).toBe('Perform AI-powered research queries with project context');
        // Check that the parameters object matches our Zod mock structure
        expect(toolConfig.parameters).toEqual(expect.objectContaining({
            _def: expect.any(Object), // Basic check for Zod-like structure
        }));
        expect(typeof toolConfig.execute).toBe('function');
    });

    test('FAKE tool should call researchDirectFn and handleApiResult on successful execution', async () => {
        const mockContext = { log: mockLogger, session: { /* session data if needed */ } };

        const result = await executeFunction(baseArgs, mockContext);

        expect(mockResearchDirectFn).toHaveBeenCalledWith(
            {
                ...baseArgs,
                includeProjectTree: false,
                detailLevel: 'medium',
                saveToFile: false,
            },
            mockLogger,
            { session: mockContext.session }
        );
        expect(mockHandleApiResult).toHaveBeenCalledWith(
            successResponseFromDirect,
            mockLogger,
            'Error performing research',
            undefined,
            baseArgs.projectRoot
        );
        expect(result).toEqual(successResponseFromDirect);
    });

    test('FAKE tool should return agent delegation structure when researchDirectFn signals delegation', async () => {
        mockResearchDirectFn.mockResolvedValue(delegationSignalFromDirect);
        const mockContext = { log: mockLogger, session: {} };

        const result = await executeFunction(baseArgs, mockContext);

        expect(mockResearchDirectFn).toHaveBeenCalledWith(
            expect.objectContaining(baseArgs), // Ensure projectRoot is included
            mockLogger,
            { session: mockContext.session }
        );
        expect(mockHandleApiResult).not.toHaveBeenCalled();
        expect(result).toEqual({
            content: [{
                type: "resource",
                resource: {
                    uri: "agent-llm://pending-interaction",
                    mimeType: "application/json",
                    text: JSON.stringify({
                        isAgentLLMPendingInteraction: true,
                        details: delegationDetails
                    })
                }
            }],
            isError: false
        });
        expect(mockLogger.info).toHaveBeenCalledWith("FAKE research tool: Agent delegation signaled. Returning EmbeddedResource structure.");
    });

    test('FAKE tool should handle errors from researchDirectFn using createErrorResponse', async () => {
        const errorFromDirect = { success: false, error: { code: 'DIRECT_ERROR', message: 'Direct function failed' } };
        mockResearchDirectFn.mockResolvedValue(errorFromDirect);
        mockHandleApiResult.mockReturnValueOnce({ isError: true, error: errorFromDirect.error }); // Simulate handleApiResult processing

        const mockContext = { log: mockLogger, session: {} };
        const result = await executeFunction(baseArgs, mockContext);

        expect(mockResearchDirectFn).toHaveBeenCalled();
        expect(mockHandleApiResult).toHaveBeenCalledWith(
            errorFromDirect,
            mockLogger,
            'Error performing research',
            undefined,
            baseArgs.projectRoot
        );
        expect(result.isError).toBe(true);
        expect(result.error).toEqual(errorFromDirect.error);
    });

    test('FAKE tool should handle thrown errors from researchDirectFn using createErrorResponse', async () => {
        const thrownError = new Error('Critical failure in direct function');
        mockResearchDirectFn.mockRejectedValue(thrownError);

        const mockContext = { log: mockLogger, session: {} };
        const result = await executeFunction(baseArgs, mockContext);

        expect(mockResearchDirectFn).toHaveBeenCalled();
        expect(mockLogger.error).toHaveBeenCalledWith(`Error in FAKE research tool: ${thrownError.message}`);
        expect(mockCreateErrorResponse).toHaveBeenCalledWith(thrownError.message);
        expect(result).toEqual({
            isError: true,
            error: { code: 'TOOL_ERROR', message: thrownError.message }
        });
    });

    test('FAKE tool should pass all optional parameters to researchDirectFn', async () => {
        const fullArgs = {
            ...baseArgs,
            taskIds: "1,2",
            filePaths: "src/index.js,docs/readme.md",
            customContext: "This is custom context.",
            includeProjectTree: true,
            detailLevel: 'high',
            saveTo: "task1",
            saveToFile: true,
        };
        mockResearchDirectFn.mockResolvedValue(successResponseFromDirect);
        const mockContext = { log: mockLogger, session: {} };

        await executeFunction(fullArgs, mockContext);

        expect(mockResearchDirectFn).toHaveBeenCalledWith(
            { ...fullArgs }, // The fake execute function passes these through
            mockLogger,
            { session: mockContext.session }
        );
    });
});
