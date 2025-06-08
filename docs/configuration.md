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

### AI Behavior Mode (`MCP_AI_MODE`)

This environment variable controls how Taskmaster's AI services behave, particularly when integrated into larger systems where an external agent might provide AI outputs.

-   **Purpose:** Allows `mcp-server` (and underlying Taskmaster functions) to use AI outputs provided by an external agent or process, instead of making direct calls to LLM providers.
-   **Possible Values:**
    -   `direct` (Default): This is the standard behavior. The server calls the configured LLM providers directly to generate text, objects, or stream text. If `MCP_AI_MODE` is unset, it defaults to `direct`.
    -   `agent_driven`: In this mode, the server expects AI outputs (like generated text or structured objects) to be provided directly in the parameters of API calls or tool invocations. It will bypass making its own calls to LLM providers.
-   **Setting the Variable:**
    You can set this variable in your environment or in a `.env` file at your project root:
    ```env
    MCP_AI_MODE=agent_driven
    ```

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

## Using Agent-Driven Mode with Tools

When `MCP_AI_MODE` is set to `agent_driven`, several tools and their corresponding API endpoints can accept pre-generated AI outputs. This is useful for scenarios where an external AI agent or a custom workflow prepares the AI-generated content, and Taskmaster is used to integrate this content into its task management and file generation processes.

**General Pattern:**

If `MCP_AI_MODE=agent_driven`, tools that normally invoke an AI service (like `generateTextService` or `generateObjectService`) will look for specific parameters in their input arguments. If these parameters are provided, the tool will use them directly instead of calling an AI model.

**Key Parameters:**

-   `agentTextOutput` (string): Pre-generated text output that would normally come from an LLM (e.g., for task expansion, analysis reasoning).
-   `agentObjectOutput` (object): Pre-generated JSON object that would normally come from an LLM (e.g., for PRD parsing resulting in a task list).
-   `agentUsageData` (object, optional): An object representing token usage data for the provided agent output. Example: `{ "inputTokens": 100, "outputTokens": 500 }`. This is used for telemetry.

**Important Considerations:**

-   These `agent...Output` parameters are **only processed if `MCP_AI_MODE` is set to `agent_driven`**. If the mode is `direct`, these parameters will be ignored.
-   If `MCP_AI_MODE` is `agent_driven` and a tool expects AI-generated data but the relevant `agent...Output` parameter is *not* supplied, an error will occur. The system expects the agent to provide the necessary data in this mode.
-   The structure of `agentTextOutput` or `agentObjectOutput` must match what the tool's internal parsing logic expects (i.e., it should be the same format the AI service would have returned).

**Affected Tools and API Parameters:**

The following tools (and their corresponding direct functions used by `mcp-server`) are refactored to support this mode:

1.  **Expand Task (e.g., `expandTaskDirect`, API endpoint like `POST /api/expand-task`):**
    *   Accepts: `agentTextOutput` (JSON string representing subtasks), `agentUsageData`.
    *   Example API Body Snippet:
        ```json
        {
          "tasksJsonPath": ".taskmaster/tasks.json",
          "id": "1",
          "projectRoot": "/path/to/project",
          "agentTextOutput": "{\"subtasks\": [{\"id\": 1, \"title\": \"Subtask 1 from agent\", ...}]}",
          "agentUsageData": { "inputTokens": 50, "outputTokens": 150 }
        }
        ```

2.  **Analyze Task Complexity (e.g., `analyzeTaskComplexityDirect`, API endpoint like `POST /api/analyze-task-complexity`):**
    *   Accepts: `agentTextOutput` (JSON string representing the complexity analysis array), `agentUsageData`.
    *   Example API Body Snippet:
        ```json
        {
          "tasksJsonPath": ".taskmaster/tasks.json",
          "outputPath": ".taskmaster/reports/task-complexity-report.json",
          "projectRoot": "/path/to/project",
          "agentTextOutput": "[{\"taskId\": 1, \"complexityScore\": 7, ...}]",
          "agentUsageData": { "inputTokens": 200, "outputTokens": 300 }
        }
        ```

3.  **Parse PRD (e.g., `parsePRDDirect`, API endpoint like `POST /api/parse-prd`):**
    *   Accepts: `agentObjectOutput` (a JavaScript object, typically parsed from JSON by the server, representing the structured tasks and metadata), `agentUsageData`.
    *   Example API Body Snippet:
        ```json
        {
          "input": ".taskmaster/docs/prd.txt",
          "output": ".taskmaster/tasks.json",
          "projectRoot": "/path/to/project",
          "agentObjectOutput": {
            "tasks": [{ "id": 1, "title": "Task from agent PRD parse", ... }],
            "metadata": { ... }
          },
          "agentUsageData": { "inputTokens": 1000, "outputTokens": 800 }
        }
        ```

**Note on API Endpoint Integration:**
For the `agentTextOutput`, `agentObjectOutput`, and `agentUsageData` parameters to be usable via the HTTP API endpoints (e.g., `POST /api/expand-task`), the Zod schemas defined in the respective `mcp-server/src/tools/*.js` files must be updated to include these new optional fields. This documentation update assumes that development task will be handled separately. If you are calling the `direct-functions` programmatically (not via HTTP API), these parameters are available as described.
