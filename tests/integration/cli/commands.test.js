import { jest } from '@jest/globals';

// --- Define mock functions ---
const mockGetMainModelId = jest.fn().mockReturnValue('claude-3-opus');
const mockGetResearchModelId = jest.fn().mockReturnValue('gpt-4-turbo');
const mockGetFallbackModelId = jest.fn().mockReturnValue('claude-3-haiku');
const mockSetMainModel = jest.fn().mockResolvedValue(true);
const mockSetResearchModel = jest.fn().mockResolvedValue(true);
const mockSetFallbackModel = jest.fn().mockResolvedValue(true);
const mockGetAvailableModels = jest.fn().mockReturnValue([
	{ id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic' },
	{ id: 'gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'openai' },
	{ id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'anthropic' },
	{ id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', provider: 'anthropic' }
]);

// Mock UI related functions
const mockDisplayHelp = jest.fn();
const mockDisplayBanner = jest.fn();
const mockLog = jest.fn();
const mockStartLoadingIndicator = jest.fn(() => ({ stop: jest.fn() }));
const mockStopLoadingIndicator = jest.fn();

// --- Setup mocks using unstable_mockModule (recommended for ES modules) ---

// Mock for ai-services-unified
jest.unstable_mockModule('../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: jest.fn().mockResolvedValue({
		mainResult: {
			object: {
				tasks: [{ id: 1, text: "mock task from ai-service" }],
				metadata: { originalEstimate: 1, confidence: 1, quality: 1 }
			}
		},
		telemetryData: { tokens: 100, cost: 0.01, provider: 'mock-fallback', model: 'mock-fallback-model' }
	})
}));

// Mock for task-manager/utils
jest.unstable_mockModule('../../../scripts/modules/task-manager/utils.js', () => ({
	readJSON: jest.fn().mockReturnValue({ tasks: [] }), // Default mock for readJSON
	writeJSON: jest.fn().mockResolvedValue(true) // Default mock for writeJSON
}));

// Mock for config-manager
jest.unstable_mockModule('../../../scripts/modules/config-manager.js', () => ({
	getMainModelId: mockGetMainModelId,
	getResearchModelId: mockGetResearchModelId,
	getFallbackModelId: mockGetFallbackModelId,
	setMainModel: mockSetMainModel,
	setResearchModel: mockSetResearchModel,
	setFallbackModel: mockSetFallbackModel,
	getAvailableModels: mockGetAvailableModels,
	VALID_PROVIDERS: ['anthropic', 'openai', 'agentllm'], // Ensure agentllm is valid
	// Mocks for API key status
	isApiKeySet: jest.fn(),
	getMcpApiKeyStatus: jest.fn(),
	getAllProviders: jest.fn().mockReturnValue(['agentllm', 'openai', 'anthropic', 'perplexity']),
	// Mocks for fallback logic
	getMainProvider: jest.fn(),
	getFallbackProvider: jest.fn(),
	getFallbackModelId: jest.fn()
}));

jest.unstable_mockModule('../../../scripts/modules/ui.js', () => ({
	displayHelp: mockDisplayHelp,
	displayBanner: mockDisplayBanner,
	log: mockLog,
	startLoadingIndicator: mockStartLoadingIndicator,
	stopLoadingIndicator: mockStopLoadingIndicator
	// displayApiKeyStatus is NOT mocked here, so we can import the actual one
}));

// --- Mock chalk for consistent output formatting ---
const mockChalk = {
	red: jest.fn((text) => text),
	yellow: jest.fn((text) => text),
	blue: jest.fn((text) => text),
	green: jest.fn((text) => text),
	gray: jest.fn((text) => text),
	dim: jest.fn((text) => text),
	bold: {
		cyan: jest.fn((text) => text),
		white: jest.fn((text) => text),
		red: jest.fn((text) => text)
	},
	cyan: {
		bold: jest.fn((text) => text)
	},
	white: {
		bold: jest.fn((text) => text)
	}
};
// Default function for chalk itself
mockChalk.default = jest.fn((text) => text);
// Add the methods to the function itself for dual usage
Object.keys(mockChalk).forEach((key) => {
	if (key !== 'default') mockChalk.default[key] = mockChalk[key];
});

jest.unstable_mockModule('chalk', () => ({
	default: mockChalk.default
}));

// --- Import modules (AFTER mock setup) ---
let configManager, ui, chalk;
// Import the actual function we want to test from ui.js
import { displayApiKeyStatus as actualDisplayApiKeyStatus } from '../../../scripts/modules/ui.js';
// Import the actual parsePRD function and mocked aiServicesUnified
const parsePRDModule = (await import('../../../scripts/modules/task-manager/parse-prd.js')).default;
const actualParsePRD = parsePRDModule.default || parsePRDModule; // Handle potential default export wrapping
import * as aiServicesUnifiedMocks from '../../../scripts/modules/ai-services-unified.js';
import fs from 'fs'; // Import fs to spy on its methods for specific tests

describe('CLI Models Command (Action Handler Test)', () => {
	// Setup dynamic imports before tests run
	beforeAll(async () => {
		configManager = await import('../../../scripts/modules/config-manager.js');
		ui = await import('../../../scripts/modules/ui.js');
		chalk = (await import('chalk')).default;
	});

	// --- Replicate the action handler logic from commands.js ---
	async function modelsAction(options) {
		options = options || {}; // Ensure options object exists
		const availableModels = configManager.getAvailableModels();

		const findProvider = (modelId) => {
			const modelInfo = availableModels.find((m) => m.id === modelId);
			return modelInfo?.provider;
		};

		let modelSetAction = false;

		try {
			if (options.setMain) {
				const modelId = options.setMain;
				if (typeof modelId !== 'string' || modelId.trim() === '') {
					console.error(
						chalk.red('Error: --set-main flag requires a valid model ID.')
					);
					process.exit(1);
				}
				const provider = findProvider(modelId);
				if (!provider) {
					console.error(
						chalk.red(
							`Error: Model ID "${modelId}" not found in available models.`
						)
					);
					process.exit(1);
				}
				if (await configManager.setMainModel(provider, modelId)) {
					console.log(
						chalk.green(`Main model set to: ${modelId} (Provider: ${provider})`)
					);
					modelSetAction = true;
				} else {
					console.error(chalk.red(`Failed to set main model.`));
					process.exit(1);
				}
			}

			if (options.setResearch) {
				const modelId = options.setResearch;
				if (typeof modelId !== 'string' || modelId.trim() === '') {
					console.error(
						chalk.red('Error: --set-research flag requires a valid model ID.')
					);
					process.exit(1);
				}
				const provider = findProvider(modelId);
				if (!provider) {
					console.error(
						chalk.red(
							`Error: Model ID "${modelId}" not found in available models.`
						)
					);
					process.exit(1);
				}
				if (await configManager.setResearchModel(provider, modelId)) {
					console.log(
						chalk.green(
							`Research model set to: ${modelId} (Provider: ${provider})`
						)
					);
					modelSetAction = true;
				} else {
					console.error(chalk.red(`Failed to set research model.`));
					process.exit(1);
				}
			}

			if (options.setFallback) {
				const modelId = options.setFallback;
				if (typeof modelId !== 'string' || modelId.trim() === '') {
					console.error(
						chalk.red('Error: --set-fallback flag requires a valid model ID.')
					);
					process.exit(1);
				}
				const provider = findProvider(modelId);
				if (!provider) {
					console.error(
						chalk.red(
							`Error: Model ID "${modelId}" not found in available models.`
						)
					);
					process.exit(1);
				}
				if (await configManager.setFallbackModel(provider, modelId)) {
					console.log(
						chalk.green(
							`Fallback model set to: ${modelId} (Provider: ${provider})`
						)
					);
					modelSetAction = true;
				} else {
					console.error(chalk.red(`Failed to set fallback model.`));
					process.exit(1);
				}
			}

			if (!modelSetAction) {
				const currentMain = configManager.getMainModelId();
				const currentResearch = configManager.getResearchModelId();
				const currentFallback = configManager.getFallbackModelId();

				if (!availableModels || availableModels.length === 0) {
					console.log(chalk.yellow('No models defined in configuration.'));
					return;
				}

				// Create a mock table for testing - avoid using Table constructor
				const mockTableData = [];
				availableModels.forEach((model) => {
					if (model.id.startsWith('[') && model.id.endsWith(']')) return;
					mockTableData.push([
						model.id,
						model.name || 'N/A',
						model.provider || 'N/A',
						model.id === currentMain ? chalk.green('   ✓') : '',
						model.id === currentResearch ? chalk.green('     ✓') : '',
						model.id === currentFallback ? chalk.green('     ✓') : ''
					]);
				});

				// In a real implementation, we would use cli-table3, but for testing
				// we'll just log 'Mock Table Output'
				console.log('Mock Table Output');
			}
		} catch (error) {
			// Use ui.log mock if available, otherwise console.error
			(ui.log || console.error)(
				`Error processing models command: ${error.message}`,
				'error'
			);
			if (error.stack) {
				(ui.log || console.error)(error.stack, 'debug');
			}
			throw error; // Re-throw for test failure
		}
	}
	// --- End of Action Handler Logic ---

	let originalConsoleLog;
	let originalConsoleError;
	let originalProcessExit;

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks();

		// Save original console methods
		originalConsoleLog = console.log;
		originalConsoleError = console.error;
		originalProcessExit = process.exit;

		// Mock console and process.exit
		console.log = jest.fn();
		console.error = jest.fn();
		process.exit = jest.fn((code) => {
			throw new Error(`process.exit(${code}) called`);
		});
	});

	afterEach(() => {
		// Restore original console methods
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		process.exit = originalProcessExit;
	});

	// --- Test Cases (Calling modelsAction directly) ---

	it('should call setMainModel with correct provider and ID', async () => {
		const modelId = 'claude-3-opus';
		const expectedProvider = 'anthropic';
		await modelsAction({ setMain: modelId });
		expect(mockSetMainModel).toHaveBeenCalledWith(expectedProvider, modelId);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`Main model set to: ${modelId}`)
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`(Provider: ${expectedProvider})`)
		);
	});

	it('should show an error if --set-main model ID is not found', async () => {
		await expect(
			modelsAction({ setMain: 'non-existent-model' })
		).rejects.toThrow(/process.exit/); // Expect exit call
		expect(mockSetMainModel).not.toHaveBeenCalled();
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('Model ID "non-existent-model" not found')
		);
	});

	it('should call setResearchModel with correct provider and ID', async () => {
		const modelId = 'gpt-4-turbo';
		const expectedProvider = 'openai';
		await modelsAction({ setResearch: modelId });
		expect(mockSetResearchModel).toHaveBeenCalledWith(
			expectedProvider,
			modelId
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`Research model set to: ${modelId}`)
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`(Provider: ${expectedProvider})`)
		);
	});

	it('should call setFallbackModel with correct provider and ID', async () => {
		const modelId = 'claude-3-haiku';
		const expectedProvider = 'anthropic';
		await modelsAction({ setFallback: modelId });
		expect(mockSetFallbackModel).toHaveBeenCalledWith(
			expectedProvider,
			modelId
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`Fallback model set to: ${modelId}`)
		);
		expect(console.log).toHaveBeenCalledWith(
			expect.stringContaining(`(Provider: ${expectedProvider})`)
		);
	});

	it('should call all set*Model functions when all flags are used', async () => {
		const mainModelId = 'claude-3-opus';
		const researchModelId = 'gpt-4-turbo';
		const fallbackModelId = 'claude-3-haiku';
		const mainProvider = 'anthropic';
		const researchProvider = 'openai';
		const fallbackProvider = 'anthropic';

		await modelsAction({
			setMain: mainModelId,
			setResearch: researchModelId,
			setFallback: fallbackModelId
		});
		expect(mockSetMainModel).toHaveBeenCalledWith(mainProvider, mainModelId);
		expect(mockSetResearchModel).toHaveBeenCalledWith(
			researchProvider,
			researchModelId
		);
		expect(mockSetFallbackModel).toHaveBeenCalledWith(
			fallbackProvider,
			fallbackModelId
		);
	});

	it('should call specific get*ModelId and getAvailableModels and log table when run without flags', async () => {
		await modelsAction({}); // Call with empty options

		expect(mockGetMainModelId).toHaveBeenCalled();
		expect(mockGetResearchModelId).toHaveBeenCalled();
		expect(mockGetFallbackModelId).toHaveBeenCalled();
		expect(mockGetAvailableModels).toHaveBeenCalled();

		expect(console.log).toHaveBeenCalled();
		// Check the mocked Table.toString() was used via console.log
		expect(console.log).toHaveBeenCalledWith('Mock Table Output');
	});
});

// --- API Key Status Display Tests ---
describe('API Key Status Display', () => {
	let consoleLogSpy;
	let configManagerMocks; // To access the mocked configManager

	beforeAll(async () => {
		// Import the mocked configManager to access its jest.fn() mocks
		configManagerMocks = await import('../../../scripts/modules/config-manager.js');
	});

	beforeEach(() => {
		consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		// Clear mocks before each test
		if (configManagerMocks && configManagerMocks.isApiKeySet) {
			configManagerMocks.isApiKeySet.mockClear();
		}
		if (configManagerMocks && configManagerMocks.getMcpApiKeyStatus) {
			configManagerMocks.getMcpApiKeyStatus.mockClear();
		}
		// getAllProviders is typically not cleared if its mockReturnValue is static
	});

	afterEach(() => {
		if (consoleLogSpy) {
			consoleLogSpy.mockRestore();
		}
	});

	it('should display AgentLLM CLI key as Missing and MCP key as Missing in the status table', () => {
		// Setup mocks for this specific test case
		configManagerMocks.isApiKeySet.mockImplementation((providerName) => {
			if (providerName.toLowerCase() === 'agentllm') return false;
			if (providerName.toLowerCase() === 'openai') return true;
			if (providerName.toLowerCase() === 'anthropic') return true;
			if (providerName.toLowerCase() === 'perplexity') return false; // Example
			return false;
		});

		configManagerMocks.getMcpApiKeyStatus.mockImplementation((providerName) => {
			if (providerName.toLowerCase() === 'agentllm') return false;
			if (providerName.toLowerCase() === 'openai') return true;
			if (providerName.toLowerCase() === 'anthropic') return false; // Example
			if (providerName.toLowerCase() === 'perplexity') return true; // Example
			return false;
		});

		// Construct the statusReport array as the models command would
		const providers = configManagerMocks.getAllProviders(); // Uses the mockReturnValue
		const statusReport = providers.map(provider => ({
			provider: provider,
			cliKeySet: configManagerMocks.isApiKeySet(provider),
			mcpKeySet: configManagerMocks.getMcpApiKeyStatus(provider)
		}));

		actualDisplayApiKeyStatus(statusReport); // Call the actual UI function

		const output = consoleLogSpy.mock.calls.map(args => args.join(' ')).join('\n');

		// Check for table header
		expect(output).toMatch(/Provider\s+│\s*CLI Key \(.env\)\s*│\s*MCP Key \(mcp\.json\)/);
		// Check for AgentLLM row
		expect(output).toMatch(/Agentllm\s+│\s*❌ Missing\s+│\s*❌ Missing/);
		// Check for OpenAI row (as a control)
		expect(output).toMatch(/Openai\s+│\s*✅ Found\s+│\s*✅ Found/);
		// Check for Anthropic row (as another control with mixed status)
		expect(output).toMatch(/Anthropic\s+│\s*✅ Found\s+│\s*❌ Missing/);
		// Check for Perplexity row (as another control with mixed status)
		expect(output).toMatch(/Perplexity\s+│\s*❌ Missing\s+│\s*✅ Found/);
	});
});

// --- Parse PRD Command Fallback Logic Tests ---
describe('Parse PRD Command Fallback Logic', () => {
	let configManagerMocksFromImport;
	let readFileSyncSpy, existsSyncSpy;

	beforeAll(async () => {
		configManagerMocksFromImport = await import('../../../scripts/modules/config-manager.js');
	});

	beforeEach(() => {
		// Clear mocks
		if (configManagerMocksFromImport) {
			configManagerMocksFromImport.getMainProvider?.mockClear();
			configManagerMocksFromImport.getFallbackProvider?.mockClear();
			configManagerMocksFromImport.getFallbackModelId?.mockClear();
			configManagerMocksFromImport.isApiKeySet?.mockClear();
		}
		aiServicesUnifiedMocks.generateObjectService.mockClear();

		// Setup default mock implementations for this suite
		if (configManagerMocksFromImport && configManagerMocksFromImport.isApiKeySet) {
			configManagerMocksFromImport.isApiKeySet.mockImplementation((provider) => {
				return provider.toLowerCase() !== 'agentllm'; // AgentLLM key not set, others are
			});
		}

		// Spy on fs methods and provide default implementations for this suite
		readFileSyncSpy = jest.spyOn(fs, 'readFileSync');
		existsSyncSpy = jest.spyOn(fs, 'existsSync');

		// Default behavior for fs mocks in this suite
		readFileSyncSpy.mockImplementation((filepath) => {
			if (filepath === 'mock/prd.txt') {
				return "This is a mock PRD content.";
			}
			return ""; // Default for other files
		});
		existsSyncSpy.mockReturnValue(false); // Default to file not existing
	});

	afterEach(() => {
		// Restore fs spies
		readFileSyncSpy.mockRestore();
		existsSyncSpy.mockRestore();
	});

	it('should use fallback provider for parse-prd if AgentLLM is main and context is CLI', async () => {
		// Arrange: Configure mocks for this specific test case
		configManagerMocksFromImport.getMainProvider.mockReturnValue('agentllm');
		configManagerMocksFromImport.getFallbackProvider.mockReturnValue('anthropic');
		configManagerMocksFromImport.getFallbackModelId.mockReturnValue('claude-3-haiku');

		// Ensure tasks.json does not exist for a clean parse
		existsSyncSpy.mockImplementation(filePath => {
			if (filePath === 'mock/tasks.json') return false;
			return true; // Or some other default
		});

		// Act
		await actualParsePRD('mock/prd.txt', 'mock/tasks.json', 10, { research: false, projectRoot: '/mock/project' });

		// Assert
		expect(aiServicesUnifiedMocks.generateObjectService).toHaveBeenCalledTimes(1);
		const generateObjectServiceArgs = aiServicesUnifiedMocks.generateObjectService.mock.calls[0][0];

		expect(generateObjectServiceArgs.provider).toBe('anthropic');
		expect(generateObjectServiceArgs.modelId).toBe('claude-3-haiku');
		// Depending on implementation, role might be explicitly 'fallback' or just not 'main'
		// For now, checking provider and modelId is the key.
		// Add expect(generateObjectServiceArgs.role).toBe('fallback'); if applicable.
		expect(generateObjectServiceArgs.role).not.toBe('main');
	});
});
