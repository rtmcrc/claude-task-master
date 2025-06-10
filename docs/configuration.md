# Configuration

Taskmaster uses two primary methods for configuration:

1.  **`.taskmaster/config.json` File (Recommended - New Structure)**

    - This JSON file stores most configuration settings, including AI model selections, parameters, logging levels, and project defaults.
    - **Location:** This file is created in the `.taskmaster/` directory when you run the `task-master models --setup` interactive setup or initialize a new project with `task-master init`.
    - **Migration:** Existing projects with `.taskmasterconfig` in the root will continue to work, but should be migrated to the new structure using `task-master migrate`.
    - **Management:** Use the `task-master models --setup` command (or `models` MCP tool) to interactively create and manage this file. You can also set specific models directly using `task-master models --set-<role>=<model_id>`, adding `--ollama` or `--openrouter` flags for custom models. Manual editing is possible but not recommended unless you understand the structure.
    - **Example Structure:**
      ```json
      {
        "models": {
          "main": {
            "provider": "anthropic",
            "modelId": "claude-3-7-sonnet-20250219",
            "maxTokens": 64000,
            "temperature": 0.2,
            "baseURL": "https://api.anthropic.com/v1"
          },
          "research": {
            "provider": "perplexity",
            "modelId": "sonar-pro",
            "maxTokens": 8700,
            "temperature": 0.1,
            "baseURL": "https://api.perplexity.ai/v1"
          },
          "fallback": {
            "provider": "anthropic",
            "modelId": "claude-3-5-sonnet",
            "maxTokens": 64000,
            "temperature": 0.2
          }
        },
        "global": {
          "logLevel": "info",
          "debug": false,
          "defaultSubtasks": 5,
          "defaultPriority": "medium",
          "projectName": "Your Project Name",
          "ollamaBaseURL": "http://localhost:11434/api",
          "azureBaseURL": "https://your-endpoint.azure.com/",
          "vertexProjectId": "your-gcp-project-id",
          "vertexLocation": "us-central1"
        }
      }
      ```

2.  **Legacy `.taskmasterconfig` File (Backward Compatibility)**

    - For projects that haven't migrated to the new structure yet.
    - **Location:** Project root directory.
    - **Migration:** Use `task-master migrate` to move this to `.taskmaster/config.json`.
    - **Deprecation:** While still supported, you'll see warnings encouraging migration to the new structure.

## Environment Variables (`.env` file or MCP `env` block - For API Keys Only)

- Used **exclusively** for sensitive API keys and specific endpoint URLs.
- **Location:**
  - For CLI usage: Create a `.env` file in your project root.
  - For MCP/Cursor usage: Configure keys in the `env` section of your `.cursor/mcp.json` file.
- **Required API Keys (Depending on configured providers):**
  - `ANTHROPIC_API_KEY`: Your Anthropic API key.
  - `PERPLEXITY_API_KEY`: Your Perplexity API key.
  - `OPENAI_API_KEY`: Your OpenAI API key.
  - `GOOGLE_API_KEY`: Your Google API key (also used for Vertex AI provider).
  - `MISTRAL_API_KEY`: Your Mistral API key.
  - `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key (also requires `AZURE_OPENAI_ENDPOINT`).
  - `OPENROUTER_API_KEY`: Your OpenRouter API key.
  - `XAI_API_KEY`: Your X-AI API key.
- **Optional Endpoint Overrides:**
  - **Per-role `baseURL` in `.taskmasterconfig`:** You can add a `baseURL` property to any model role (`main`, `research`, `fallback`) to override the default API endpoint for that provider. If omitted, the provider's standard endpoint is used.
  - `AZURE_OPENAI_ENDPOINT`: Required if using Azure OpenAI key (can also be set as `baseURL` for the Azure model role).
  - `OLLAMA_BASE_URL`: Override the default Ollama API URL (Default: `http://localhost:11434/api`).
  - `VERTEX_PROJECT_ID`: Your Google Cloud project ID for Vertex AI. Required when using the 'vertex' provider.
  - `VERTEX_LOCATION`: Google Cloud region for Vertex AI (e.g., 'us-central1'). Default is 'us-central1'.
  - `GOOGLE_APPLICATION_CREDENTIALS`: Path to service account credentials JSON file for Google Cloud auth (alternative to API key for Vertex AI).

**Important:** Settings like model ID selections (`main`, `research`, `fallback`), `maxTokens`, `temperature`, `logLevel`, `defaultSubtasks`, `defaultPriority`, and `projectName` are **managed in `.taskmaster/config.json`** (or `.taskmasterconfig` for unmigrated projects), not environment variables.

## Example `.env` File (for API Keys)

```
# Required API keys for providers configured in .taskmasterconfig
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
PERPLEXITY_API_KEY=pplx-your-key-here
# OPENAI_API_KEY=sk-your-key-here
# GOOGLE_API_KEY=AIzaSy...
# etc.

# Optional Endpoint Overrides
# AZURE_OPENAI_ENDPOINT=https://your-azure-endpoint.openai.azure.com/
# OLLAMA_BASE_URL=http://custom-ollama-host:11434/api

# Google Vertex AI Configuration (Required if using 'vertex' provider)
# VERTEX_PROJECT_ID=your-gcp-project-id
# VERTEX_LOCATION=us-central1
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-credentials.json
```

## Troubleshooting

### Configuration Errors

- If Task Master reports errors about missing configuration or cannot find the config file, run `task-master models --setup` in your project root to create or repair the file.
- For new projects, config will be created at `.taskmaster/config.json`. For legacy projects, you may want to use `task-master migrate` to move to the new structure.
- Ensure API keys are correctly placed in your `.env` file (for CLI) or `.cursor/mcp.json` (for MCP) and are valid for the providers selected in your config file.

### If `task-master init` doesn't respond:

Try running it with Node directly:

```bash
node node_modules/claude-task-master/scripts/init.js
```

Or clone the repository and run:

```bash
git clone https://github.com/eyaltoledano/claude-task-master.git
cd claude-task-master
node scripts/init.js
```

## Provider-Specific Configuration

### Google Vertex AI Configuration

Google Vertex AI is Google Cloud's enterprise AI platform and requires specific configuration:

1. **Prerequisites**:
   - A Google Cloud account with Vertex AI API enabled
   - Either a Google API key with Vertex AI permissions OR a service account with appropriate roles
   - A Google Cloud project ID
2. **Authentication Options**:
   - **API Key**: Set the `GOOGLE_API_KEY` environment variable
   - **Service Account**: Set `GOOGLE_APPLICATION_CREDENTIALS` to point to your service account JSON file
3. **Required Configuration**:
   - Set `VERTEX_PROJECT_ID` to your Google Cloud project ID
   - Set `VERTEX_LOCATION` to your preferred Google Cloud region (default: us-central1)
4. **Example Setup**:

   ```bash
   # In .env file
   GOOGLE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXX
   VERTEX_PROJECT_ID=my-gcp-project-123
   VERTEX_LOCATION=us-central1
   ```

   Or using service account:

   ```bash
   # In .env file
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   VERTEX_PROJECT_ID=my-gcp-project-123
   VERTEX_LOCATION=us-central1
   ```

5. **In .taskmasterconfig**:
   ```json
   "global": {
     "vertexProjectId": "my-gcp-project-123",
     "vertexLocation": "us-central1"
   }
   ```

## Delegated LLM Call Mode

This mode allows an external agent or application (e.g., an AI-powered desktop client like Claude Desktop) to manage the execution of Large Language Model (LLM) calls, while Task Master remains responsible for generating the necessary prompts/schemas and processing the raw LLM responses. This is different from the now-reverted `MCP_AI_MODE=agent_driven` which was a global override; this delegated mode is accessed via new, specific API endpoints/tools.

**Overview:**

The Delegated LLM Call Mode enables a two-phase interaction for AI-powered operations:

1.  **Phase 1: Initiation:** The external agent calls a specialized `initiateDelegated<ToolName>` endpoint in Task Master (MCP Server). Task Master prepares all necessary information for an LLM call (like system prompts, user prompts, and JSON schemas for object generation) but does *not* make the LLM call itself. It returns this information along with a unique `interactionId` to the agent.
2.  **Phase 2: Submission:** The external agent takes the information from Phase 1, makes the actual call to an LLM provider of its choice, and receives a raw response (typically a JSON string or plain text). The agent then calls a corresponding `submitDelegated<ToolName>Response` endpoint in Task Master, providing the `interactionId` and the `rawLLMResponse`. Task Master then validates this raw response (e.g., parses JSON, validates against the original Zod schema for object generation), performs the rest of the tool's logic (e.g., creating tasks, generating files), and returns the final result, similar to how the original direct tool would.

**Interaction ID:**
The `interactionId` generated in Phase 1 is a temporary identifier for the pending operation. It has a Time-To-Live (TTL) of 10 minutes. If the submission in Phase 2 is not made within this TTL, the interaction context will expire and be removed.

**General Interaction Flow:**

1.  **Agent to Task Master (Phase 1):** `POST /api/initiateDelegated<ToolName>`
    *   Request: Contains initial parameters required by the tool (e.g., `projectRoot`, PRD content for `parse-prd`, task ID for `expand-task`). May also include an optional `clientContext` object which will be echoed back in the response.
    *   Response: `{ success: true, data: { interactionId: "...", aiServiceRequest: { serviceType: "...", systemPrompt: "...", userPrompt: "...", schemaDefinition: "...", objectName: "...", targetModelInfo: {...} }, clientContext: ... } }`
        *   `interactionId`: Unique ID for this transaction.
        *   `aiServiceRequest`: Contains all data the agent needs to make the LLM call.
            *   `serviceType`: e.g., 'generateObject', 'generateText'.
            *   `systemPrompt`: The system prompt Task Master would have used. This prompt will include instructions about the expected JSON structure if `serviceType` is `generateObject`.
            *   `userPrompt`: The user prompt Task Master would have used.
            *   `objectName`: For `generateObject`, the name of the object/tool being requested.
            *   `targetModelInfo`: Information about the provider/model Task Master would have targeted (e.g., `provider`, `modelId`, `maxTokens`).
        *   `clientContext`: The `clientContext` object passed in the request, echoed back for the agent's use.
    *   **Note on Object Generation:** For `serviceType: 'generateObject'`, the `aiServiceRequest` will *not* include a `schemaDefinition` field. The agent should instruct its LLM to produce a JSON output that conforms to the structure described textually within the `systemPrompt` and/or `userPrompt`. Task Master will perform strict validation of the `rawLLMResponse` (submitted by the agent in Phase 2) against its internal Zod schema, which was originally used to generate the textual prompt descriptions.

2.  **Agent:** Makes the LLM call using the details from `aiServiceRequest`.

3.  **Agent to Task Master (Phase 2):** `POST /api/submitDelegated<ToolName>Response`
    *   Request: `{ interactionId: "...", rawLLMResponse: "...", llmUsageData: { inputTokens: ..., outputTokens: ... } (optional), ...any_other_params_needed_for_final_processing }`
        *   `rawLLMResponse`: The raw string response from the LLM. For object generation, this should be a JSON string.
        *   `llmUsageData`: Optional token usage data for telemetry.
    *   Response: The standard final output of the original tool (e.g., `{ success: true, data: { outputPath: "...", ... } }`).

---

**Detailed API Endpoints for Refactored Tools:**

The following toolchains have been refactored to support this two-phase delegated mode. Each has a corresponding pair of `initiate` and `submit` tools/endpoints.

### 1. Parse PRD (`parse-prd`)

*   **`initiateDelegatedParsePRD`**
    *   **Description:** Initiates a delegated PRD parsing operation. Task Master reads the PRD, prepares prompts and the expected JSON schema, and returns these along with an `interactionId`.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `input: z.string().optional()` (path to PRD file)
        *   `prdContent: z.string().optional()` (direct PRD content; one of `input` or `prdContent` required)
        *   `numTasks: z.number().int().positive().optional()`
        *   `research: z.boolean().optional().default(false)`
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateObject", systemPrompt, userPrompt, objectName: "tasks_data", targetModelInfo }, clientContext }` (Note: `schemaDefinition` is not included; the agent should rely on prompts for JSON structure guidance.)

*   **`submitDelegatedParsePRDResponse`**
    *   **Description:** Submits the raw LLM JSON string response for a previously initiated PRD parsing. Task Master validates the JSON against the schema, processes it into tasks, and saves `tasks.json` and individual task files.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()` (Needed for file writing)
        *   `output: z.string().optional()` (Path to save `tasks.json`)
        *   `force: z.boolean().optional().default(false)`
        *   `append: z.boolean().optional().default(false)`
    *   **Response Body (Success Data):** `{ message: "Successfully processed...", outputPath: "...", telemetryData: ... }` (Similar to the original `parse_prd` tool output).

**Example Workflow for `parse-prd`:**

1.  **Agent Request to `initiateDelegatedParsePRD`:**
    ```json
    // POST /api/mcp/tools/initiateDelegatedParsePRD
    {
      "projectRoot": "/path/to/my/project",
      "input": ".taskmaster/docs/prd.txt",
      "numTasks": 15,
      "research": false,
      "clientContext": { "agentSessionId": "agent-session-xyz" }
    }
    ```

2.  **Task Master Response:**
    ```json
    {
      "success": true,
      "data": {
        "interactionId": "abcdef-1234-5678-fedcba",
        "aiServiceRequest": {
          "serviceType": "generateObject",
          "systemPrompt": "You are an AI assistant specialized in analyzing PRDs... Ensure the output is a JSON object with a 'tasks' array and a 'metadata' object...",
          "userPrompt": "Here's the Product Requirements Document (PRD) to break down... Adhere to the JSON structure described in the system prompt.",
          "objectName": "tasks_data",
          "targetModelInfo": { "provider": "anthropic", "modelId": "claude-3-opus-20240229", "maxTokens": 200000 }
        },
        "clientContext": { "agentSessionId": "agent-session-xyz" }
      }
    }
    ```
    The agent then uses the `systemPrompt` and `userPrompt` to instruct the LLM to generate a JSON object conforming to the structure described in the prompts. Task Master will validate the submitted raw JSON against its internally stored schema during Phase 2.

3.  **Agent:** Uses `aiServiceRequest` to make an LLM call (e.g., to Anthropic Claude API). Receives `rawLLMResponseString` from the LLM.

4.  **Agent Request to `submitDelegatedParsePRDResponse`:**
    ```json
    // POST /api/mcp/tools/submitDelegatedParsePRDResponse
    {
      "interactionId": "abcdef-1234-5678-fedcba",
      "rawLLMResponse": "{\"tasks\": [{\"id\": 1, \"title\": \"Setup Project\", ...}, ...], \"metadata\": {...}}",
      "llmUsageData": { "inputTokens": 1200, "outputTokens": 3500 },
      "projectRoot": "/path/to/my/project",
      "output": ".taskmaster/tasks.json"
    }
    ```

5.  **Task Master Response:**
    ```json
    {
      "success": true,
      "data": {
        "message": "Successfully processed delegated PRD response and generated tasks in /path/to/my/project/.taskmaster/tasks.json",
        "outputPath": "/path/to/my/project/.taskmaster/tasks.json",
        "telemetryData": { ... }
      }
    }
    ```

---

### 2. Expand Task (`expand-task`)

*   **`initiateDelegatedExpandTask`**
    *   **Description:** Initiates a delegated task expansion. Task Master prepares prompts for subtask generation.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json)
        *   `id: z.string()` (ID of the task to expand)
        *   `num: z.string().optional()` (number of subtasks)
        *   `research: z.boolean().optional().default(false)`
        *   `prompt: z.string().optional()` (additional context for expansion)
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateText", systemPrompt, userPrompt, targetModelInfo }, clientContext }` (Note: `schemaDefinition` and `objectName` are not typically used for plain text generation).

*   **`submitDelegatedExpandTaskResponse`**
    *   **Description:** Submits the raw LLM JSON string response (containing subtasks) for a previously initiated task expansion.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM, expected to be parsable into subtask structure)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json for writing)
        *   `id: z.string()` (Parent task ID for context)
        *   `force: z.boolean().optional().default(false)`
    *   **Response Body (Success Data):** `{ task: { ...updated_parent_task... }, subtasksAdded: ..., telemetryData: ... }` (Similar to original `expand_task` tool).

---

### 3. Analyze Task Complexity (`analyze-task-complexity`)

*   **`initiateDelegatedAnalyzeTaskComplexity`**
    *   **Description:** Initiates a delegated task complexity analysis. Task Master prepares prompts for analyzing tasks.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json)
        *   `ids: z.string().optional()` (comma-separated task IDs)
        *   `from: z.coerce.number().int().positive().optional()`
        *   `to: z.coerce.number().int().positive().optional()`
        *   `research: z.boolean().optional().default(false)`
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateText", systemPrompt, userPrompt, targetModelInfo }, clientContext }`

*   **`submitDelegatedAnalyzeTaskComplexityResponse`**
    *   **Description:** Submits the raw LLM JSON string response (containing complexity analysis array) for a previously initiated analysis.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()`
        *   `tasksJsonPath: z.string().optional()` (Path to tasks.json for context if needed by the processing logic)
        *   `outputPath: z.string().optional()` (Path to save the complexity report)
        *   `threshold: z.coerce.number().int().min(1).max(10).optional().default(5)`
    *   **Response Body (Success Data):** `{ message: "...", reportPath: "...", reportSummary: {...}, fullReport: {...}, telemetryData: ... }` (Similar to original `analyze_project_complexity` tool).

---

## Delegated LLM Call Mode

This mode allows an external agent or application (e.g., an AI-powered desktop client like Claude Desktop) to manage the execution of Large Language Model (LLM) calls, while Task Master remains responsible for generating the necessary prompts/schemas and processing the raw LLM responses. This is different from the now-reverted `MCP_AI_MODE=agent_driven` which was a global override; this delegated mode is accessed via new, specific API endpoints/tools.

**Overview:**

The Delegated LLM Call Mode enables a two-phase interaction for AI-powered operations:

1.  **Phase 1: Initiation:** The external agent calls a specialized `initiateDelegated<ToolName>` endpoint in Task Master (MCP Server). Task Master prepares all necessary information for an LLM call (like system prompts, user prompts, and JSON schemas for object generation) but does *not* make the LLM call itself. It returns this information along with a unique `interactionId` to the agent.
2.  **Phase 2: Submission:** The external agent takes the information from Phase 1, makes the actual call to an LLM provider of its choice, and receives a raw response (typically a JSON string or plain text). The agent then calls a corresponding `submitDelegated<ToolName>Response` endpoint in Task Master, providing the `interactionId` and the `rawLLMResponse`. Task Master then validates this raw response (e.g., parses JSON, validates against the original Zod schema for object generation), performs the rest of the tool's logic (e.g., creating tasks, generating files), and returns the final result, similar to how the original direct tool would.

**Interaction ID:**
The `interactionId` generated in Phase 1 is a temporary identifier for the pending operation. It has a Time-To-Live (TTL) of 10 minutes. If the submission in Phase 2 is not made within this TTL, the interaction context will expire and be removed.

**General Interaction Flow:**

1.  **Agent to Task Master (Phase 1):** `POST /api/initiateDelegated<ToolName>`
    *   Request: Contains initial parameters required by the tool (e.g., `projectRoot`, PRD content for `parse-prd`, task ID for `expand-task`). May also include an optional `clientContext` object which will be echoed back in the response.
    *   Response: `{ success: true, data: { interactionId: "...", aiServiceRequest: { serviceType: "...", systemPrompt: "...", userPrompt: "...", schemaDefinition: "...", objectName: "...", targetModelInfo: {...} }, clientContext: ... } }`
        *   `interactionId`: Unique ID for this transaction.
        *   `aiServiceRequest`: Contains all data the agent needs to make the LLM call.
            *   `serviceType`: e.g., 'generateObject', 'generateText'.
            *   `systemPrompt`: The system prompt Task Master would have used.
            *   `userPrompt`: The user prompt Task Master would have used.
            *   `schemaDefinition`: For `generateObject` service type, a stringified JSON representation of the expected Zod schema's structure. The agent can use this to guide the LLM.
            *   `objectName`: For `generateObject`, the name of the object/tool being requested.
            *   `targetModelInfo`: Information about the provider/model Task Master would have targeted (e.g., `provider`, `modelId`, `maxTokens`).
        *   `clientContext`: The `clientContext` object passed in the request, echoed back for the agent's use.

2.  **Agent:** Makes the LLM call using the details from `aiServiceRequest`.

3.  **Agent to Task Master (Phase 2):** `POST /api/submitDelegated<ToolName>Response`
    *   Request: `{ interactionId: "...", rawLLMResponse: "...", llmUsageData: { inputTokens: ..., outputTokens: ... } (optional), ...any_other_params_needed_for_final_processing }`
        *   `rawLLMResponse`: The raw string response from the LLM. For object generation, this should be a JSON string.
        *   `llmUsageData`: Optional token usage data for telemetry.
    *   Response: The standard final output of the original tool (e.g., `{ success: true, data: { outputPath: "...", ... } }`).

---

**Detailed API Endpoints for Refactored Tools:**

The following toolchains have been refactored to support this two-phase delegated mode. Each has a corresponding pair of `initiate` and `submit` tools/endpoints.

### 1. Parse PRD (`parse-prd`)

*   **`initiateDelegatedParsePRD`**
    *   **Description:** Initiates a delegated PRD parsing operation. Task Master reads the PRD, prepares prompts and the expected JSON schema, and returns these along with an `interactionId`.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `input: z.string().optional()` (path to PRD file)
        *   `prdContent: z.string().optional()` (direct PRD content; one of `input` or `prdContent` required)
        *   `numTasks: z.number().int().positive().optional()`
        *   `research: z.boolean().optional().default(false)`
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateObject", systemPrompt, userPrompt, schemaDefinition, objectName: "tasks_data", targetModelInfo }, clientContext }`

*   **`submitDelegatedParsePRDResponse`**
    *   **Description:** Submits the raw LLM JSON string response for a previously initiated PRD parsing. Task Master validates the JSON against the schema, processes it into tasks, and saves `tasks.json` and individual task files.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()` (Needed for file writing)
        *   `output: z.string().optional()` (Path to save `tasks.json`)
        *   `force: z.boolean().optional().default(false)`
        *   `append: z.boolean().optional().default(false)`
    *   **Response Body (Success Data):** `{ message: "Successfully processed...", outputPath: "...", telemetryData: ... }` (Similar to the original `parse_prd` tool output).

**Example Workflow for `parse-prd`:**

1.  **Agent Request to `initiateDelegatedParsePRD`:**
    ```json
    // POST /api/mcp/tools/initiateDelegatedParsePRD
    {
      "projectRoot": "/path/to/my/project",
      "input": ".taskmaster/docs/prd.txt",
      "numTasks": 15,
      "research": false,
      "clientContext": { "agentSessionId": "agent-session-xyz" }
    }
    ```

2.  **Task Master Response:**
    ```json
    {
      "success": true,
      "data": {
        "interactionId": "abcdef-1234-5678-fedcba",
        "aiServiceRequest": {
          "serviceType": "generateObject",
          "systemPrompt": "You are an AI assistant specialized in analyzing PRDs...",
          "userPrompt": "Here's the Product Requirements Document (PRD) to break down...",
          "schemaDefinition": "{\\"type\\":\\"object\\",\\"properties\\":{\\"tasks\\":{\\"type\\":\\"array\\",\\"items\\":{...}}, ...}}",
          "objectName": "tasks_data",
          "targetModelInfo": { "provider": "anthropic", "modelId": "claude-3-opus-20240229", "maxTokens": 200000 }
        },
        "clientContext": { "agentSessionId": "agent-session-xyz" }
      }
    }
    ```

3.  **Agent:** Uses `aiServiceRequest` to make an LLM call (e.g., to Anthropic Claude API). Receives `rawLLMResponseString` from the LLM.

4.  **Agent Request to `submitDelegatedParsePRDResponse`:**
    ```json
    // POST /api/mcp/tools/submitDelegatedParsePRDResponse
    {
      "interactionId": "abcdef-1234-5678-fedcba",
      "rawLLMResponse": "{\"tasks\": [{\"id\": 1, \"title\": \"Setup Project\", ...}, ...], \"metadata\": {...}}",
      "llmUsageData": { "inputTokens": 1200, "outputTokens": 3500 },
      "projectRoot": "/path/to/my/project",
      "output": ".taskmaster/tasks.json"
    }
    ```

5.  **Task Master Response:**
    ```json
    {
      "success": true,
      "data": {
        "message": "Successfully processed delegated PRD response and generated tasks in /path/to/my/project/.taskmaster/tasks.json",
        "outputPath": "/path/to/my/project/.taskmaster/tasks.json",
        "telemetryData": { ... }
      }
    }
    ```

---

### 2. Expand Task (`expand-task`)

*   **`initiateDelegatedExpandTask`**
    *   **Description:** Initiates a delegated task expansion. Task Master prepares prompts for subtask generation.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json)
        *   `id: z.string()` (ID of the task to expand)
        *   `num: z.string().optional()` (number of subtasks)
        *   `research: z.boolean().optional().default(false)`
        *   `prompt: z.string().optional()` (additional context for expansion)
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateText", systemPrompt, userPrompt, targetModelInfo }, clientContext }` (Note: `schemaDefinition` and `objectName` are not typically used for plain text generation).

*   **`submitDelegatedExpandTaskResponse`**
    *   **Description:** Submits the raw LLM JSON string response (containing subtasks) for a previously initiated task expansion.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM, expected to be parsable into subtask structure)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json for writing)
        *   `id: z.string()` (Parent task ID for context)
        *   `force: z.boolean().optional().default(false)`
    *   **Response Body (Success Data):** `{ task: { ...updated_parent_task... }, subtasksAdded: ..., telemetryData: ... }` (Similar to original `expand_task` tool).

---

### 3. Analyze Task Complexity (`analyze-task-complexity`)

*   **`initiateDelegatedAnalyzeTaskComplexity`**
    *   **Description:** Initiates a delegated task complexity analysis. Task Master prepares prompts for analyzing tasks.
    *   **Request Parameters (Zod Schema):**
        *   `projectRoot: z.string()`
        *   `file: z.string().optional()` (path to tasks.json)
        *   `ids: z.string().optional()` (comma-separated task IDs)
        *   `from: z.coerce.number().int().positive().optional()`
        *   `to: z.coerce.number().int().positive().optional()`
        *   `research: z.boolean().optional().default(false)`
        *   `clientContext: z.any().optional()`
    *   **Response Body (Success Data):** `{ interactionId, aiServiceRequest: { serviceType: "generateText", systemPrompt, userPrompt, targetModelInfo }, clientContext }`

*   **`submitDelegatedAnalyzeTaskComplexityResponse`**
    *   **Description:** Submits the raw LLM JSON string response (containing complexity analysis array) for a previously initiated analysis.
    *   **Request Parameters (Zod Schema):**
        *   `interactionId: z.string()`
        *   `rawLLMResponse: z.string()` (Raw JSON string from LLM)
        *   `llmUsageData: z.object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() }).optional()`
        *   `projectRoot: z.string()`
        *   `tasksJsonPath: z.string().optional()` (Path to tasks.json for context if needed by the processing logic)
        *   `outputPath: z.string().optional()` (Path to save the complexity report)
        *   `threshold: z.coerce.number().int().min(1).max(10).optional().default(5)`
    *   **Response Body (Success Data):** `{ message: "...", reportPath: "...", reportSummary: {...}, fullReport: {...}, telemetryData: ... }` (Similar to original `analyze_project_complexity` tool).

---
