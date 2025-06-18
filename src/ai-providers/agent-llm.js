import { BaseAIProvider } from './base-provider.js';
import { v4 as uuidv4 } from 'uuid';

class AgentLLMProvider extends BaseAIProvider {
  constructor() {
    super();
    this.name = 'AgentLLM';
  }

  validateAuth(params) {
    // AgentLLM does not use traditional API keys
    return true;
  }

  getClient(params) {
    // Return this, as we are not calling a traditional LLM client directly
    return this;
  }

  generateText(params) {
    const { modelId, messages, maxTokens, temperature, role, outputType, ...restApiParams } = params;
    if (outputType === 'cli') {
        throw new Error("AgentLLM provider is not supported in CLI mode and requires an MCP context.");
    }
    const interactionId = uuidv4();
    const packagedParams = {
      apiKey: null,
      modelId,
      messages,
      maxTokens,
      temperature,
      role, // Explicitly add role here
      baseURL: params.baseURL,
      ...restApiParams,
    };
    return { type: 'agent_llm_delegation', interactionId, details: packagedParams };
  }

  streamText(params) {
    const { modelId, messages, maxTokens, temperature, role, outputType, ...restApiParams } = params;
    if (outputType === 'cli') {
        throw new Error("AgentLLM provider is not supported in CLI mode and requires an MCP context.");
    }
    const interactionId = uuidv4();
    const packagedParams = {
      apiKey: null,
      modelId,
      messages,
      maxTokens,
      temperature,
      role, // Explicitly add role here
      baseURL: params.baseURL,
      ...restApiParams,
    };
    return { type: 'agent_llm_delegation', interactionId, details: packagedParams };
  }

  generateObject(params) {
    const { modelId, messages, maxTokens, temperature, schema, objectName, role, outputType, ...restApiParams } = params;
    if (outputType === 'cli') {
        throw new Error("AgentLLM provider is not supported in CLI mode and requires an MCP context.");
    }
    const interactionId = uuidv4();
    const packagedParams = {
      apiKey: null,
      modelId,
      messages,
      maxTokens,
      temperature,
      schema,
      objectName,
      role, // Explicitly add role here
      baseURL: params.baseURL,
      ...restApiParams,
    };
    return { type: 'agent_llm_delegation', interactionId, details: packagedParams };
  }
}

export { AgentLLMProvider };
