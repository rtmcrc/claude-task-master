/**
 * openai.js
 * AI provider implementation for OpenAI models using Vercel AI SDK.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { BaseAIProvider } from './base-provider.js';

export class OpenAIProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'OpenAI';
	}

	/**
	 * Creates and returns an OpenAI client instance.
	 * @param {object} params - Parameters for client initialization
	 * @param {string} params.apiKey - OpenAI API key
	 * @param {string} [params.baseUrl] - Optional custom API endpoint
	 * @returns {Function} OpenAI client function
	 * @throws {Error} If API key is missing or initialization fails
	 */
	async getClient(params) {
		try {
			const { apiKey, baseUrl } = params;

			if (!apiKey) {
				throw new Error('OpenAI API key is required.');
			}

			return createOpenAI({
				apiKey,
				...(baseUrl && { baseURL: baseUrl })
			});
		} catch (error) {
			this.handleError('client initialization', error);
		}
	}
}
