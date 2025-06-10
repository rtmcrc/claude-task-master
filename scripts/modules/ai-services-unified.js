/**
 * ai-services-unified.js
 * Centralized AI service layer using provider modules and config-manager.
 */

import crypto from 'crypto'; // For generating interactionId

// Vercel AI SDK functions are NOT called directly anymore.
// import { generateText, streamText, generateObject } from 'ai';

// --- State Management for Delegated Interactions ---
const pendingInteractions = new Map();
const INTERACTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Retrieves context for a pending interaction and checks its TTL.
 * @param {string} interactionId - The ID of the interaction.
 * @returns {object|null} The interaction context or null if not found or expired.
 */
function getInteractionContext(interactionId) {
	const context = pendingInteractions.get(interactionId);
	if (!context) {
		log('warn', `Interaction context not found for ID: ${interactionId}`);
		return null;
	}
	if ((Date.now() - context.timestamp) > INTERACTION_TTL_MS) {
		log('warn', `Interaction context expired for ID: ${interactionId}`);
		pendingInteractions.delete(interactionId); // Cleanup expired entry
		return null;
	}
	return context;
}

// Optional: Function to periodically cleanup all expired interactions
// function cleanupExpiredInteractions() {
//   const now = Date.now();
//   for (const [id, context] of pendingInteractions.entries()) {
//     if ((now - context.timestamp) > INTERACTION_TTL_MS) {
//       pendingInteractions.delete(id);
//       log('info', `Cleaned up expired interaction ID: ${id}`);
//     }
//   }
// }

// --- Core Dependencies ---
import {
	getMainProvider,
	getMainModelId,
	getResearchProvider,
	getResearchModelId,
	getFallbackProvider,
	getFallbackModelId,
	getParametersForRole,
	getUserId,
	MODEL_MAP,
	getDebugFlag,
	getBaseUrlForRole,
	isApiKeySet,
	getOllamaBaseURL,
	getAzureBaseURL,
	getBedrockBaseURL,
	getVertexProjectId,
	getVertexLocation
} from './config-manager.js';
import { log, findProjectRoot, resolveEnvVariable } from './utils.js';

// Import provider classes
import {
	AnthropicAIProvider,
	PerplexityAIProvider,
	GoogleAIProvider,
	OpenAIProvider,
	XAIProvider,
	OpenRouterAIProvider,
	OllamaAIProvider,
	BedrockAIProvider,
	AzureProvider,
	VertexAIProvider
} from '../../src/ai-providers/index.js';

// Create provider instances
const PROVIDERS = {
	anthropic: new AnthropicAIProvider(),
	perplexity: new PerplexityAIProvider(),
	google: new GoogleAIProvider(),
	openai: new OpenAIProvider(),
	xai: new XAIProvider(),
	openrouter: new OpenRouterAIProvider(),
	ollama: new OllamaAIProvider(),
	bedrock: new BedrockAIProvider(),
	azure: new AzureProvider(),
	vertex: new VertexAIProvider()
};

// Helper function to get cost for a specific model
function _getCostForModel(providerName, modelId) {
	if (!MODEL_MAP || !MODEL_MAP[providerName]) {
		log(
			'warn',
			`Provider "${providerName}" not found in MODEL_MAP. Cannot determine cost for model ${modelId}.`
		);
		return { inputCost: 0, outputCost: 0, currency: 'USD' };
	}

	const modelData = MODEL_MAP[providerName].find((m) => m.id === modelId);

	if (!modelData || !modelData.cost_per_1m_tokens) {
		log(
			'debug',
			`Cost data not found for model "${modelId}" under provider "${providerName}". Assuming zero cost.`
		);
		return { inputCost: 0, outputCost: 0, currency: 'USD' };
	}
	const currency = modelData.cost_per_1m_tokens.currency || 'USD';
	return {
		inputCost: modelData.cost_per_1m_tokens.input || 0,
		outputCost: modelData.cost_per_1m_tokens.output || 0,
		currency: currency
	};
}

const MAX_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 1000;

function isRetryableError(error) {
	const errorMessage = error.message?.toLowerCase() || '';
	return (
		errorMessage.includes('rate limit') ||
		errorMessage.includes('overloaded') ||
		errorMessage.includes('service temporarily unavailable') ||
		errorMessage.includes('timeout') ||
		errorMessage.includes('network error') ||
		error.status === 429 ||
		error.status >= 500
	);
}

function _extractErrorMessage(error) {
	try {
		if (error?.data?.error?.message) return error.data.error.message;
		if (error?.error?.message) return error.error.message;
		if (typeof error?.responseBody === 'string') {
			try {
				const body = JSON.parse(error.responseBody);
				if (body?.error?.message) return body.error.message;
			} catch (parseError) { /* Ignore */ }
		}
		if (typeof error?.message === 'string' && error.message) return error.message;
		if (typeof error === 'string') return error;
		return 'An unknown AI service error occurred.';
	} catch (e) {
		return 'Failed to extract error message.';
	}
}

function _resolveApiKey(providerName, session, projectRoot = null) {
	const keyMap = {
		openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_API_KEY',
		perplexity: 'PERPLEXITY_API_KEY', mistral: 'MISTRAL_API_KEY', azure: 'AZURE_OPENAI_API_KEY',
		openrouter: 'OPENROUTER_API_KEY', xai: 'XAI_API_KEY', ollama: 'OLLAMA_API_KEY',
		bedrock: 'AWS_ACCESS_KEY_ID', vertex: 'GOOGLE_API_KEY'
	};
	const envVarName = keyMap[providerName];
	if (!envVarName) throw new Error(`Unknown provider '${providerName}' for API key resolution.`);
	const apiKey = resolveEnvVariable(envVarName, session, projectRoot);
	if (providerName === 'ollama' || providerName === 'bedrock') return apiKey || null;
	if (!apiKey) throw new Error(`Required API key ${envVarName} for provider '${providerName}' is not set.`);
	return apiKey;
}

async function _attemptProviderCallWithRetries(provider, serviceType, callParams, providerName, modelId, attemptRole) {
	let retries = 0;
	while (retries <= MAX_RETRIES) {
		try {
			if (getDebugFlag()) log('info', `Attempt ${retries + 1}/${MAX_RETRIES + 1} calling ${serviceType} (Provider: ${providerName}, Model: ${modelId}, Role: ${attemptRole})`);
			const result = await provider[serviceType](callParams);
			if (getDebugFlag()) log('info', `${serviceType} succeeded for role ${attemptRole} (Provider: ${providerName}) on attempt ${retries + 1}`);
			return result;
		} catch (error) {
			log('warn', `Attempt ${retries + 1} failed for role ${attemptRole} (${serviceType} / ${providerName}): ${error.message}`);
			if (isRetryableError(error) && retries < MAX_RETRIES) {
				retries++;
				const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, retries - 1);
				log('info', `Something went wrong on the provider side. Retrying in ${delay / 1000}s...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				log('error', `Something went wrong on the provider side. Max retries reached for role ${attemptRole} (${serviceType} / ${providerName}).`);
				throw error;
			}
		}
	}
	throw new Error(`Exhausted all retries for role ${attemptRole} (${serviceType} / ${providerName})`);
}

async function _unifiedServiceRunner(serviceType, params) {
	const {
		role: initialRole, session, projectRoot, systemPrompt, prompt, schema, objectName,
		commandName, outputType, delegationPhase, clientContext, ...restApiParams
	} = params;

	if (getDebugFlag()) log('info', `${serviceType}Service called`, { role: initialRole, commandName, outputType, projectRoot, delegationPhase });

	const effectiveProjectRoot = projectRoot || findProjectRoot();
	const userId = getUserId(effectiveProjectRoot);

	if (delegationPhase === 'initiate') {
		let intendedProviderName, intendedModelId, intendedRoleParams, generatedSystemPrompt;
		let currentRoleForInitiate = initialRole;
		const sequenceForInitiate = initialRole === 'main' ? ['main', 'research', 'fallback'] :
		                       initialRole === 'research' ? ['research', 'main', 'fallback'] :
		                       ['fallback', 'main', 'research'];
		let foundValidConfigForInitiate = false;

		for (const role of sequenceForInitiate) {
			currentRoleForInitiate = role;
			if (role === 'main') { intendedProviderName = getMainProvider(effectiveProjectRoot); intendedModelId = getMainModelId(effectiveProjectRoot); }
			else if (role === 'research') { intendedProviderName = getResearchProvider(effectiveProjectRoot); intendedModelId = getResearchModelId(effectiveProjectRoot); }
			else { intendedProviderName = getFallbackProvider(effectiveProjectRoot); intendedModelId = getFallbackModelId(effectiveProjectRoot); }

			if (intendedProviderName && intendedModelId) {
				intendedRoleParams = getParametersForRole(role, effectiveProjectRoot);
				const providerNeedsApiKey = !['ollama', 'bedrock'].includes(intendedProviderName?.toLowerCase());
				if (providerNeedsApiKey && !isApiKeySet(intendedProviderName, session, effectiveProjectRoot)) {
					log('warn', `Intended provider ${intendedProviderName} for role ${role} has no API key set. Skipping for 'initiate' phase.`);
					continue;
				}
				foundValidConfigForInitiate = true;
				break;
			}
		}
		if (!foundValidConfigForInitiate) throw new Error(`Could not find a valid provider/model configuration for any role in sequence to initiate delegated call for role ${initialRole}.`);

		generatedSystemPrompt = systemPrompt || `System prompt for ${serviceType} for model ${intendedModelId}`;

		const interactionId = crypto.randomUUID();
		const interactionContext = {
			serviceType, schemaToValidateWith: serviceType === 'generateObject' ? schema : undefined,
			objectName: serviceType === 'generateObject' ? objectName : undefined,
			originalRole: currentRoleForInitiate, projectRoot: effectiveProjectRoot, commandName, outputType, userId,
			timestamp: Date.now(), intendedProviderName, intendedModelId,
		};
		pendingInteractions.set(interactionId, interactionContext);
		log('info', `Delegated interaction ${interactionId} initiated for service ${serviceType}. Context stored.`);

		return {
			interactionId: interactionId,
			aiServiceRequest: {
				serviceType: serviceType, systemPrompt: generatedSystemPrompt, userPrompt: prompt,
				schemaDefinition: serviceType === 'generateObject' && schema ? JSON.stringify(schema.description || schema._def || schema) : undefined,
				objectName: serviceType === 'generateObject' ? objectName : undefined,
				targetModelInfo: { provider: intendedProviderName, modelId: intendedModelId, maxTokens: intendedRoleParams?.maxTokens, temperature: intendedRoleParams?.temperature }
			},
			clientContext: clientContext
		};
	}

	let sequence;
	if (initialRole === 'main') sequence = ['main', 'fallback', 'research'];
	else if (initialRole === 'research') sequence = ['research', 'fallback', 'main'];
	else if (initialRole === 'fallback') sequence = ['fallback', 'main', 'research'];
	else { log('warn', `Unknown initial role: ${initialRole}. Defaulting to main -> fallback -> research sequence.`); sequence = ['main', 'fallback', 'research']; }

	let lastError = null;
	let lastCleanErrorMessage = 'AI service call failed for all configured roles.';

	for (const currentRole of sequence) {
		let providerName, modelId, apiKey, roleParams, provider, baseURL, providerResponse, telemetryData = null;
		try {
			log('info', `New AI service call with role: ${currentRole}`);
			if (currentRole === 'main') { providerName = getMainProvider(effectiveProjectRoot); modelId = getMainModelId(effectiveProjectRoot); }
			else if (currentRole === 'research') { providerName = getResearchProvider(effectiveProjectRoot); modelId = getResearchModelId(effectiveProjectRoot); }
			else if (currentRole === 'fallback') { providerName = getFallbackProvider(effectiveProjectRoot); modelId = getFallbackModelId(effectiveProjectRoot); }
			else { log('error', `Unknown role encountered: ${currentRole}`); lastError = lastError || new Error(`Unknown AI role: ${currentRole}`); continue; }

			if (!providerName || !modelId) { log('warn', `Skipping role '${currentRole}': Config missing.`); lastError = lastError || new Error(`Config missing for role '${currentRole}'.`); continue; }
			provider = PROVIDERS[providerName?.toLowerCase()];
			if (!provider) { log('warn', `Skipping role '${currentRole}': Provider '${providerName}' not supported.`); lastError = lastError || new Error(`Unsupported provider: ${providerName}`); continue; }

			if (providerName?.toLowerCase() !== 'ollama' && !isApiKeySet(providerName, session, effectiveProjectRoot)) {
				log('warn', `Skipping role '${currentRole}' (Provider: ${providerName}): API key not set.`);
				lastError = lastError || new Error(`API key for ${providerName} (role: ${currentRole}) not set.`);
				continue;
			}

			baseURL = getBaseUrlForRole(currentRole, effectiveProjectRoot);
			if (providerName?.toLowerCase() === 'azure' && !baseURL) baseURL = getAzureBaseURL(effectiveProjectRoot);
			else if (providerName?.toLowerCase() === 'ollama' && !baseURL) baseURL = getOllamaBaseURL(effectiveProjectRoot);
			else if (providerName?.toLowerCase() === 'bedrock' && !baseURL) baseURL = getBedrockBaseURL(effectiveProjectRoot);

			roleParams = getParametersForRole(currentRole, effectiveProjectRoot);
			apiKey = _resolveApiKey(providerName?.toLowerCase(), session, effectiveProjectRoot);
			let providerSpecificParams = {};
			if (providerName?.toLowerCase() === 'vertex') {
				const projectId = getVertexProjectId(effectiveProjectRoot) || resolveEnvVariable('VERTEX_PROJECT_ID', session, effectiveProjectRoot);
				const location = getVertexLocation(effectiveProjectRoot) || resolveEnvVariable('VERTEX_LOCATION', session, effectiveProjectRoot) || 'us-central1';
				const credentialsPath = resolveEnvVariable('GOOGLE_APPLICATION_CREDENTIALS', session, effectiveProjectRoot);
				providerSpecificParams = { projectId, location, ...(credentialsPath && { credentials: { credentialsFromEnv: true } }) };
				log('debug', `Vertex AI config: Project ID=${projectId}, Location=${location}`);
			}

			const messages = [];
			if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
			if (prompt) messages.push({ role: 'user', content: prompt });
			else throw new Error('User prompt content is missing.');

			const callParams = {
				apiKey, modelId, maxTokens: roleParams.maxTokens, temperature: roleParams.temperature, messages,
				...(baseURL && { baseURL }), ...(serviceType === 'generateObject' && { schema, objectName }),
				...providerSpecificParams, ...restApiParams
			};
			providerResponse = await _attemptProviderCallWithRetries(provider, serviceType, callParams, providerName, modelId, currentRole);

			if (userId && providerResponse && providerResponse.usage) {
				try {
					telemetryData = await logAiUsage({
						userId, commandName, providerName, modelId,
						inputTokens: providerResponse.usage.inputTokens, outputTokens: providerResponse.usage.outputTokens, outputType
					});
				} catch (telemetryError) { /* Already logged by logAiUsage */ }
			} else if (userId && providerResponse && !providerResponse.usage) {
				log('warn', `Cannot log telemetry for ${commandName} (${providerName}/${modelId}): AI result missing 'usage' data.`);
			}

			let finalMainResult;
			if (serviceType === 'generateText') finalMainResult = providerResponse.text;
			else if (serviceType === 'generateObject') finalMainResult = providerResponse.object;
			else if (serviceType === 'streamText') finalMainResult = providerResponse;
			else { log('error', `Unknown serviceType: ${serviceType}`); finalMainResult = providerResponse; }

			return { mainResult: finalMainResult, telemetryData: telemetryData };
		} catch (error) {
			const cleanMessage = _extractErrorMessage(error);
			log('error', `Service call failed for role ${currentRole} (Provider: ${providerName || 'unknown'}, Model: ${modelId || 'unknown'}): ${cleanMessage}`);
			lastError = error; lastCleanErrorMessage = cleanMessage;
			if (serviceType === 'generateObject' && (cleanMessage.toLowerCase().includes('tool use') || cleanMessage.toLowerCase().includes('function calling'))) {
				const specificErrorMsg = `Model '${modelId || 'unknown'}' via provider '${providerName || 'unknown'}' does not support 'tool use' for generateObjectService.`;
				log('error', `[Tool Support Error] ${specificErrorMsg}`); throw new Error(specificErrorMsg);
			}
		}
	}
	log('error', `All roles in sequence [${sequence.join(', ')}] failed.`);
	throw new Error(lastCleanErrorMessage);
}

function _processDelegatedTextInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext) {
	if (typeof rawLLMResponse !== 'string') log('warn', `Delegated text response for ${interactionId} is not a string.`);
	return { text: rawLLMResponse };
}

function _processDelegatedObjectInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext) {
	log('debug', `Processing delegated object for ${interactionId}. Raw type: ${typeof rawLLMResponse}`);
	if (!interactionContext.schemaToValidateWith) throw new Error(`Missing schema for validation in interaction ${interactionId}.`);
	let parsedObject;
	if (typeof rawLLMResponse === 'string') {
		try { parsedObject = JSON.parse(rawLLMResponse); }
		catch (e) { throw new Error(`Invalid JSON response from delegated LLM: ${e.message}`); }
	} else if (typeof rawLLMResponse === 'object' && rawLLMResponse !== null) parsedObject = rawLLMResponse;
	else throw new Error('Invalid format for rawLLMResponse in delegated object processing.');
	const validationResult = interactionContext.schemaToValidateWith.safeParse(parsedObject);
	if (!validationResult.success) throw new Error(`Delegated LLM response failed schema validation: ${validationResult.error.toString()}`);
	return { object: validationResult.data };
}

function _processDelegatedStreamInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext) {
	async function* generateStream() {
		if (typeof rawLLMResponse === 'string') yield rawLLMResponse;
		else log('warn', `Delegated stream response for ${interactionId} is not a string. Stream will be empty.`);
	}
	return { textStream: generateStream() };
}

async function generateTextService(params) {
	const defaults = { outputType: 'cli' };
	return _unifiedServiceRunner('generateText', { ...defaults, ...params });
}

async function streamTextService(params) {
	const defaults = { outputType: 'cli' };
	return _unifiedServiceRunner('streamText', { ...defaults, ...params });
}

async function generateObjectService(params) {
	const defaults = { objectName: 'generated_object', maxRetries: 3, outputType: 'cli' };
	return _unifiedServiceRunner('generateObject', { ...defaults, ...params });
}

async function logAiUsage({ userId, commandName, providerName, modelId, inputTokens, outputTokens, outputType }) {
	try {
		const timestamp = new Date().toISOString();
		const totalTokens = (inputTokens || 0) + (outputTokens || 0);
		const { inputCost, outputCost, currency } = _getCostForModel(providerName, modelId);
		const totalCost = ((inputTokens || 0) / 1000000) * inputCost + ((outputTokens || 0) / 1000000) * outputCost;
		const telemetryData = {
			timestamp, userId, commandName, modelUsed: modelId, providerName,
			inputTokens: inputTokens || 0, outputTokens: outputTokens || 0, totalTokens,
			totalCost: parseFloat(totalCost.toFixed(6)), currency
		};
		if (getDebugFlag()) log('info', 'AI Usage Telemetry:', telemetryData);
		return telemetryData;
	} catch (error) {
		log('error', `Failed to log AI usage telemetry: ${error.message}`, { error });
		return null;
	}
}

async function submitDelegatedTextResponseService(params) {
  const { interactionId, rawLLMResponse, llmUsageData = {}, session, projectRoot } = params;
  const interactionContext = getInteractionContext(interactionId);

  if (!interactionContext) {
    throw new Error(`Invalid or expired interactionId: ${interactionId}`);
  }
  if (interactionContext.serviceType !== 'generateText') {
    pendingInteractions.delete(interactionId);
    throw new Error(`Interaction ID ${interactionId} is for a '${interactionContext.serviceType}' service, not 'generateText'.`);
  }

  try {
    const result = _processDelegatedTextInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext);
    const telemetry = await logAiUsage({
      userId: interactionContext.userId,
      commandName: interactionContext.commandName,
      providerName: 'delegated_agent',
      modelId: 'agent_provided',
      inputTokens: llmUsageData?.inputTokens,
      outputTokens: llmUsageData?.outputTokens,
      outputType: interactionContext.outputType
    });
    pendingInteractions.delete(interactionId);
    return { text: result.text, usage: llmUsageData, telemetryData: telemetry };
  } catch (error) {
    log('error', `Error processing delegated text response for ${interactionId}: ${error.message}`);
    throw error;
  }
}

async function submitDelegatedObjectResponseService(params) {
  const { interactionId, rawLLMResponse, llmUsageData = {}, session, projectRoot } = params;
  const interactionContext = getInteractionContext(interactionId);

  if (!interactionContext) {
    throw new Error(`Invalid or expired interactionId: ${interactionId}`);
  }
  if (interactionContext.serviceType !== 'generateObject') {
    pendingInteractions.delete(interactionId);
    throw new Error(`Interaction ID ${interactionId} is for a '${interactionContext.serviceType}' service, not 'generateObject'.`);
  }

  try {
    const result = _processDelegatedObjectInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext);
    const telemetry = await logAiUsage({
      userId: interactionContext.userId,
      commandName: interactionContext.commandName,
      providerName: 'delegated_agent',
      modelId: 'agent_provided',
      inputTokens: llmUsageData?.inputTokens,
      outputTokens: llmUsageData?.outputTokens,
      outputType: interactionContext.outputType
    });
    pendingInteractions.delete(interactionId);
    return { object: result.object, usage: llmUsageData, telemetryData: telemetry };
  } catch (error) {
    log('error', `Error processing delegated object response for ${interactionId}: ${error.message}`);
    throw error;
  }
}

async function submitDelegatedStreamResponseService(params) {
  const { interactionId, rawLLMResponse, llmUsageData = {}, session, projectRoot } = params;
  const interactionContext = getInteractionContext(interactionId);

  if (!interactionContext) {
    throw new Error(`Invalid or expired interactionId: ${interactionId}`);
  }
  if (interactionContext.serviceType !== 'streamText') {
    pendingInteractions.delete(interactionId);
    throw new Error(`Interaction ID ${interactionId} is for a '${interactionContext.serviceType}' service, not 'streamText'.`);
  }

  try {
    const result = _processDelegatedStreamInternal(interactionId, rawLLMResponse, llmUsageData, interactionContext);
    const telemetry = await logAiUsage({
      userId: interactionContext.userId,
      commandName: interactionContext.commandName,
      providerName: 'delegated_agent',
      modelId: 'agent_provided',
      inputTokens: llmUsageData?.inputTokens,
      outputTokens: llmUsageData?.outputTokens,
      outputType: interactionContext.outputType
    });
    pendingInteractions.delete(interactionId);
    return { textStream: result.textStream, usagePromise: Promise.resolve(llmUsageData), telemetryData: telemetry };
  } catch (error) {
    log('error', `Error processing delegated stream response for ${interactionId}: ${error.message}`);
    throw error;
  }
}

export {
	generateTextService,
	streamTextService,
	generateObjectService,
	logAiUsage,
	// Ensure these are cleanly exported
	submitDelegatedTextResponseService,
	submitDelegatedObjectResponseService,
	submitDelegatedStreamResponseService
};
