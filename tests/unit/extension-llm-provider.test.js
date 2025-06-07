import { ExtensionLlmProvider } from '../../src/ai-providers/extension-llm-provider.js';
import { BaseAIProvider } from '../../src/ai-providers/base-provider.js'; // For spyOn super methods

// Mock the logger to prevent console output during tests
jest.mock('../../scripts/modules/index.js', () => ({
  log: jest.fn(),
}));

describe('ExtensionLlmProvider', () => {
  let provider;
  const mockParams = {
    modelId: 'delegated-model',
    messages: [{ role: 'user', content: 'Hello' }],
    temperature: 0.5,
    maxTokens: 100,
    schema: { type: 'object', properties: { message: { type: 'string' } } },
    objectName: 'greeting',
  };

  beforeEach(() => {
    provider = new ExtensionLlmProvider();
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  test('constructor sets the name correctly', () => {
    expect(provider.name).toBe('ExtensionLlmProvider');
  });

  describe('validateAuth', () => {
    test('should not throw an error even if apiKey is missing', () => {
      const params = { modelId: 'test-model' }; // No apiKey
      expect(() => provider.validateAuth(params)).not.toThrow();
    });

    test('should log a debug message', () => {
      provider.validateAuth({ modelId: 'test-model' });
      expect(require('../../scripts/modules/index.js').log).toHaveBeenCalledWith(
        'debug',
        'ExtensionLlmProvider: Skipping API key validation.'
      );
    });
  });

  describe('getClient', () => {
    test('should return a placeholder client object', () => {
      const client = provider.getClient({ modelId: 'delegated-model' });
      expect(client).toBeInstanceOf(Object);
      expect(client.provider).toBe('extension-llm');
      expect(client.modelId).toBe('delegated-model');
      expect(client.call).toBeInstanceOf(Function);
    });

    test('placeholder client call method should throw error', async () => {
      const client = provider.getClient({ modelId: 'delegated-model' });
      await expect(client.call({})).rejects.toThrow(
        'ExtensionLlmProvider dummy client method should not be called.'
      );
    });
  });

  describe('generateText', () => {
    let spyValidateMessages;
    let spyValidateOptionalParams;

    beforeEach(() => {
      spyValidateMessages = jest.spyOn(BaseAIProvider.prototype, 'validateMessages');
      spyValidateOptionalParams = jest.spyOn(BaseAIProvider.prototype, 'validateOptionalParams');
    });

    afterEach(() => {
      spyValidateMessages.mockRestore();
      spyValidateOptionalParams.mockRestore();
    });

    test('should call super.validateMessages and super.validateOptionalParams', async () => {
      await expect(provider.generateText(mockParams)).rejects.toThrow(); // Expecting not implemented error
      expect(spyValidateMessages).toHaveBeenCalledWith(mockParams.messages);
      expect(spyValidateOptionalParams).toHaveBeenCalledWith(mockParams);
    });

    test('should throw NotImplementedError', async () => {
      await expect(provider.generateText(mockParams)).rejects.toThrow(
        `ExtensionLlmProvider.generateText not fully implemented. Needs MCP SDK integration to call extension for model ${mockParams.modelId}.`
      );
    });
  });

  describe('streamText', () => {
    let spyValidateMessages;
    let spyValidateOptionalParams;

    beforeEach(() => {
      spyValidateMessages = jest.spyOn(BaseAIProvider.prototype, 'validateMessages');
      spyValidateOptionalParams = jest.spyOn(BaseAIProvider.prototype, 'validateOptionalParams');
    });

    afterEach(() => {
      spyValidateMessages.mockRestore();
      spyValidateOptionalParams.mockRestore();
    });

    test('should call super.validateMessages and super.validateOptionalParams', async () => {
      await expect(provider.streamText(mockParams)).rejects.toThrow();
      expect(spyValidateMessages).toHaveBeenCalledWith(mockParams.messages);
      expect(spyValidateOptionalParams).toHaveBeenCalledWith(mockParams);
    });

    test('should throw NotImplementedError', async () => {
      await expect(provider.streamText(mockParams)).rejects.toThrow(
        `ExtensionLlmProvider.streamText not fully implemented. Needs MCP SDK integration for model ${mockParams.modelId}.`
      );
    });
  });

  describe('generateObject', () => {
    let spyValidateMessages;
    let spyValidateOptionalParams;

    beforeEach(() => {
      spyValidateMessages = jest.spyOn(BaseAIProvider.prototype, 'validateMessages');
      spyValidateOptionalParams = jest.spyOn(BaseAIProvider.prototype, 'validateOptionalParams');
    });

    afterEach(() => {
      spyValidateMessages.mockRestore();
      spyValidateOptionalParams.mockRestore();
    });

    test('should call super.validateMessages and super.validateOptionalParams', async () => {
      await expect(provider.generateObject(mockParams)).rejects.toThrow();
      expect(spyValidateMessages).toHaveBeenCalledWith(mockParams.messages);
      expect(spyValidateOptionalParams).toHaveBeenCalledWith(mockParams);
    });

    test('should throw error if schema is missing', async () => {
      const paramsWithoutSchema = { ...mockParams, schema: undefined };
      await expect(provider.generateObject(paramsWithoutSchema)).rejects.toThrow(
        'Schema is required for object generation'
      );
    });

    test('should throw NotImplementedError if schema is provided', async () => {
      await expect(provider.generateObject(mockParams)).rejects.toThrow(
        `ExtensionLlmProvider.generateObject not fully implemented. Needs MCP SDK integration for model ${mockParams.modelId}.`
      );
    });
  });
});
