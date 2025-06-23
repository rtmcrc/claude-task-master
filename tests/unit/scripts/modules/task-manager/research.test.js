import { jest } from '@jest/globals';

// Mock only the critical dependencies needed to test the delegation logic branch
const mockGenerateTextService = jest.fn();
const mockLogFn = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), success: jest.fn() };

// Minimal mock for ContextGatherer to avoid errors if it's instantiated
const mockContextGathererGather = jest.fn().mockResolvedValue({
    context: 'Mocked context',
    tokenBreakdown: { total: 50 },
});
const mockCountTokens = jest.fn(text => text ? Math.ceil(text.length / 4) : 0);

jest.mock('../../../../../scripts/modules/ai-services-unified.js', () => ({
    generateTextService: mockGenerateTextService,
}));

jest.mock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
    ContextGatherer: jest.fn().mockImplementation(() => ({
        gather: mockContextGathererGather,
        countTokens: mockCountTokens,
    })),
}));

// Mock utils enough to prevent errors
jest.mock('../../../../../scripts/modules/utils.js', () => ({
    findProjectRoot: jest.fn(() => '/fake/project/root'),
    readJSON: jest.fn().mockResolvedValue({ tasks: [] }), // Default empty tasks
    log: (level, ...args) => (mockLogFn[level] ? mockLogFn[level](...args) : console.log(level, ...args)),
    flattenTasksWithSubtasks: jest.fn(tasks => tasks),
    getCurrentTag: jest.fn(() => 'master'),
    isSilentMode: jest.fn(() => true), // Assume silent mode to reduce console noise from real code
    enableSilentMode: jest.fn(),
    disableSilentMode: jest.fn(),
}));

// Mock ui.js to prevent errors from UI calls
jest.mock('../../../../../scripts/modules/ui.js', () => ({
    displayAiUsageSummary: jest.fn(),
    startLoadingIndicator: jest.fn(() => ({ stop: jest.fn() })), // Mock the indicator object
    stopLoadingIndicator: jest.fn(),
    displayDetailedTokenBreakdown: jest.fn(),
    displayResearchResults: jest.fn(),
}));

jest.mock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
    FuzzyTaskSearch: jest.fn().mockImplementation(() => ({
        findRelevantTasks: jest.fn(() => []),
        getTaskIds: jest.fn(() => []),
    })),
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    existsSync: jest.fn().mockReturnValue(false), // Default to no existing files to simplify paths
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn(),
}));


// Dynamically import performResearch
let performResearch;

describe('performResearch - Focused Delegation Test', () => {
    beforeEach(async () => {
        jest.clearAllMocks(); // Clear all mocks

        // Dynamically import performResearch for each test to use fresh mocks if top-level jest.mock was used.
        // For jest.doMock, this ensures the module is loaded after doMock is configured for that test run.
        // However, since we are now using top-level jest.mock again for simplicity, this ensures it's fresh.
        jest.resetModules(); // Essential

        // Re-require mocks that are defined with jest.mock (if they need to be fresh per test, though usually not)
        // For this simplified test, we rely on the top-level mocks.

        const researchModule = await import('../../../../../scripts/modules/task-manager/research.js');
        performResearch = researchModule.performResearch;
    });

    const baseQuery = 'Test research query';
    // Provide minimal options, assuming other parts of performResearch are robust or out of scope for this focused test
    const baseOptions = {
        projectRoot: '/fake/project/root',
        detailLevel: 'medium', // Provide a default
    };
    const baseContext = { mcpLog: mockLogFn, outputType: 'mcp' };

    test('should return standard result when generateTextService provides text', async () => {
        mockGenerateTextService.mockResolvedValue({
            mainResult: 'Standard research result text.',
            telemetryData: { usage: { inputTokens: 10, outputTokens: 20 } },
            tagInfo: { currentTag: 'master', availableTags: ['master'] },
        });

        const result = await performResearch(baseQuery, baseOptions, baseContext);

        expect(mockGenerateTextService).toHaveBeenCalled();
        expect(result.needsAgentDelegation).toBeUndefined();
        expect(result.result).toBe('Standard research result text.');
        expect(result.query).toBe(baseQuery);
    });

    test('should return delegation signal when generateTextService signals AgentLLM delegation', async () => {
        const agentDelegationSignalFromService = {
            type: 'agent_llm_delegation',
            interactionId: 'agent-interaction-123',
            details: {
                modelId: 'claude-agent-model',
                messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }],
                originalSaveTo: 'task1',
                originalSaveToFile: true,
                originalDetailLevel: 'high'
            }
        };
        mockGenerateTextService.mockResolvedValue({
            mainResult: agentDelegationSignalFromService,
            telemetryData: null,
            tagInfo: { currentTag: 'master', availableTags: ['master'] },
        });

        const optionsWithSave = { ...baseOptions, saveTo: 'task1', saveToFile: true, detailLevel: 'high' };
        const result = await performResearch(baseQuery, optionsWithSave, baseContext);

        expect(mockGenerateTextService).toHaveBeenCalledWith(expect.objectContaining({
            originalSaveTo: 'task1',
            originalSaveToFile: true,
            originalDetailLevel: 'high'
        }));
        expect(result.needsAgentDelegation).toBe(true);
        expect(result.pendingInteraction).toEqual(agentDelegationSignalFromService);
        expect(result.result).toBeNull();
        expect(result.query).toBe(baseQuery);
        expect(result.telemetryData).toBeNull();
        expect(mockLogFn.info).toHaveBeenCalledWith('AgentLLM delegation signal received from AI service for research. Propagating.');
    });
});
