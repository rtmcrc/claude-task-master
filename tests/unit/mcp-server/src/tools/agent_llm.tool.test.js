import { registerAgentLLMTool } from '../../../../../mcp-server/src/tools/agent_llm.js';
import { createErrorResponse as actualCreateErrorResponse, withNormalizedProjectRoot as actualWithNormalizedProjectRoot } from '../../../../../mcp-server/src/tools/utils.js';
import { jest } from '@jest/globals';
// Mock uuid to return a fixed value for predictable interactionId testing
jest.mock('uuid', () => ({
    v4: () => 'fixed-uuid-for-test',
}));

// Mock parts of the utils module
jest.mock('../../../../../mcp-server/src/tools/utils.js', () => {
    const originalModule = jest.requireActual('../../../../../mcp-server/src/tools/utils.js');
    return {
        ...originalModule,
        withNormalizedProjectRoot: jest.fn((fn) => fn), // Pass-through for HOF
        createErrorResponse: jest.fn((message, options) => ({ // Simplified mock for createErrorResponse
            content: [{ type: 'text', text: `Error: ${message}` }],
            isError: true,
            mcpToolError: options?.mcpToolError || false,
            errorDetails: message, // Store message for easier assertion
        })),
    };
});


describe('agent_llm MCP Tool', () => {
    let execute;
    let mockLog;
    let mockSession;

    beforeEach(() => {
        // Reset mocks for each test
        jest.clearAllMocks();

        const mockServer = {
            addTool: jest.fn((tool) => {
                if (tool.name === 'agent_llm') {
                    // The 'execute' function here is the one that would be registered,
                    // which includes the withNormalizedProjectRoot wrapper.
                    // Our mock for withNormalizedProjectRoot makes it a pass-through,
                    // so we are effectively testing the core logic.
                    execute = tool.execute;
                }
            }),
        };
        registerAgentLLMTool(mockServer);

        mockLog = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };
        mockSession = {
            // projectRoot will be passed in args directly as per withNormalizedProjectRoot's effect
        };
    });

    test('Taskmaster-to-Agent flow: should generate interactionId if not provided', async () => {
        const args = {
            delegatedCallDetails: {
                originalCommand: 'testCmd',
                role: 'main',
                serviceType: 'generateText',
                requestParameters: { prompt: 'test' },
            },
            projectRoot: '/test/root', // projectRoot is expected in args by the tool's execute
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        expect(result.toolResponseSource).toBe("taskmaster_to_agent");
        expect(result.status).toBe("pending_agent_llm_action");
        expect(result.interactionId).toBe('fixed-uuid-for-test'); // uuid is mocked
        expect(result.llmRequestForAgent).toEqual({ prompt: 'test' });
        expect(result.pendingInteractionSignalToAgent).toBeDefined();
        expect(result.pendingInteractionSignalToAgent.interactionId).toBe('fixed-uuid-for-test');
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Taskmaster delegating LLM call for command 'testCmd' to agent. Interaction ID: fixed-uuid-for-test"));
    });

    test('Taskmaster-to-Agent flow: should use provided interactionId', async () => {
        const args = {
            interactionId: 'provided-id-123',
            delegatedCallDetails: {
                originalCommand: 'testCmdWithId',
                role: 'research',
                serviceType: 'generateObject',
                requestParameters: { prompt: 'test obj' },
            },
            projectRoot: '/test/root',
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        expect(result.interactionId).toBe('provided-id-123');
        expect(result.pendingInteractionSignalToAgent.interactionId).toBe('provided-id-123');
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("Interaction ID: provided-id-123"));
    });

    test('Agent-to-Taskmaster flow (success)', async () => {
        const args = {
            agentLLMResponse: {
                status: 'success',
                data: { text: 'llm output' },
            },
            interactionId: 'existing-uuid-success',
            projectRoot: '/test/root',
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        expect(result.toolResponseSource).toBe("agent_to_taskmaster");
        expect(result.status).toBe("llm_response_completed");
        expect(result.finalLLMOutput).toEqual({ text: 'llm output' });
        expect(result.interactionId).toBe('existing-uuid-success');
        expect(mockLog.info).toHaveBeenCalledWith("agent_llm: Agent providing LLM response for interaction ID: existing-uuid-success");
    });

    test('Agent-to-Taskmaster flow (error response from agent)', async () => {
        const args = {
            agentLLMResponse: {
                status: 'error',
                errorDetails: { message: 'agent LLM error' },
            },
            interactionId: 'existing-uuid-agent-error',
            projectRoot: '/test/root',
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        expect(result.toolResponseSource).toBe("agent_to_taskmaster");
        expect(result.status).toBe("llm_response_error");
        expect(result.error).toEqual({ message: 'agent LLM error' });
        expect(result.interactionId).toBe('existing-uuid-agent-error');
    });

    test('Error: Missing interactionId from Agent', async () => {
        const args = {
            agentLLMResponse: {
                status: 'success',
                data: 'output',
            },
            projectRoot: '/test/root',
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        // Check based on the mocked createErrorResponse
        expect(require('../../../../../mcp-server/src/tools/utils.js').createErrorResponse).toHaveBeenCalledWith(
            "agent_llm: Agent response is missing interactionId.",
            { mcpToolError: true }
        );
        expect(result.isError).toBe(true);
        expect(result.errorDetails).toContain("agent_llm: Agent response is missing interactionId.");
        expect(mockLog.warn).toHaveBeenCalledWith("agent_llm: Agent response is missing interactionId.");
    });

    test('Error: Invalid Parameters (neither delegatedCallDetails nor agentLLMResponse)', async () => {
        const args = {
            projectRoot: '/test/root', // Only projectRoot
        };
        const result = await execute(args, { log: mockLog, session: mockSession });

        expect(require('../../../../../mcp-server/src/tools/utils.js').createErrorResponse).toHaveBeenCalledWith(
            "Invalid parameters for agent_llm tool: Must provide either 'delegatedCallDetails' or 'agentLLMResponse'.",
            { mcpToolError: true }
        );
        expect(result.isError).toBe(true);
        expect(result.errorDetails).toContain("Invalid parameters for agent_llm tool");
        expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid parameters for agent_llm tool"));
    });
});
