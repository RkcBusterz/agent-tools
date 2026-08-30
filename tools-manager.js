const { MemoryContext, FileContext } = require('./context_manager.js');
const { LlmRouter } = require('./router.js');

class ToolKit {
    constructor() {
        this.tools = new Map();
    }

    add({ name, fn, category = 'general', parameters = {}, keywords = [], description = '', key = [], keys = [] }) {
        if (!name || typeof fn !== 'function') {
            throw new Error('Tool name and function are required');
        }

        const keyList = Array.isArray(key) && key.length > 0 ? key : (typeof key === 'string' ? [key] : (Array.isArray(keys) ? keys : []));

        const tool = {
            name,
            fn,
            category,
            parameters,
            keywords,
            description,
            key: keyList
        };

        this.tools.set(name, tool);
        return tool;
    }

    get(name) {
        return this.tools.get(name);
    }

    async execute(name, args, keys = {}) {
        let tool = this.tools.get(name);
        if (!tool && name.includes('.')) {
            const actualName = name.split('.').pop();
            tool = this.tools.get(actualName);
        }
        if (!tool) {
            throw new Error(`Tool "${name}" not found`);
        }

        let finalArgs = typeof args === 'object' && args !== null && !Array.isArray(args) ? { ...args } : {};

        const keyCtx = (typeof keys === 'object' && keys !== null) ? (keys.keys || keys.key || keys) : {};

        if (Array.isArray(tool.key)) {
            for (const k of tool.key) {
                if (keyCtx && Object.prototype.hasOwnProperty.call(keyCtx, k)) {
                    finalArgs[k] = keyCtx[k];
                } else {
                    delete finalArgs[k];
                }
            }
        }

        try {
            if (Array.isArray(args)) {
                return await tool.fn(...args);
            }
            return await tool.fn(finalArgs);
        } catch (err) {
            throw new Error(`Execution error in tool "${tool.name}": ${err.message}`);
        }
    }


    getToolMetadata(tool) {
        if (!tool) return null;
        const { fn, key, ...metadata } = tool;
        let cleanParams = metadata.parameters;

        if (cleanParams && typeof cleanParams === 'object' && Array.isArray(key) && key.length > 0) {
            if (cleanParams.properties && typeof cleanParams.properties === 'object') {
                const props = { ...cleanParams.properties };
                for (const k of key) {
                    delete props[k];
                }
                cleanParams = {
                    ...cleanParams,
                    properties: props
                };
                if (Array.isArray(cleanParams.required)) {
                    cleanParams.required = cleanParams.required.filter(r => !key.includes(r));
                }
            } else if (!Array.isArray(cleanParams)) {
                cleanParams = { ...cleanParams };
                for (const k of key) {
                    delete cleanParams[k];
                }
            }
        }

        return {
            ...metadata,
            parameters: cleanParams
        };
    }

    list(category) {
        const toolsArray = Array.from(this.tools.values());
        const filtered = category ? toolsArray.filter(t => t.category === category) : toolsArray;
        return filtered.map(t => this.getToolMetadata(t));
    }

    listCategoriesAI() {
        const categories = new Set(Array.from(this.tools.values()).map(t => t.category));
        return Array.from(categories).join(', ');
    }

    listToolsAi(category) {
        const toolsArray = Array.from(this.tools.values());
        const filtered = category ? toolsArray.filter(t => t.category === category) : toolsArray;
        return filtered.map(t => `${t.category}.${t.name}`).join('\n');
    }

    search(query) {
        if (!query) {
            return null;
        }

        let words = [];
        if (Array.isArray(query)) {
            words = query.map(w => String(w).toLowerCase().trim()).filter(Boolean);
        } else if (typeof query === 'string') {
            words = query.toLowerCase().split(/\s+/).filter(Boolean);
        } else {
            return null;
        }

        if (words.length === 0) {
            return null;
        }

        let bestMatch = null;
        let highestScore = 0;

        for (const tool of this.tools.values()) {
            let score = 0;
            const nameLower = tool.name.toLowerCase();
            const categoryLower = tool.category.toLowerCase();
            const descLower = tool.description.toLowerCase();
            const keywordsLower = tool.keywords.map(k => k.toLowerCase());

            for (const word of words) {
                if (nameLower === word) {
                    score += 10;
                } else if (nameLower.includes(word)) {
                    score += 5;
                }

                if (keywordsLower.includes(word)) {
                    score += 8;
                } else if (keywordsLower.some(k => k.includes(word))) {
                    score += 4;
                }

                if (categoryLower === word) {
                    score += 6;
                } else if (categoryLower.includes(word)) {
                    score += 3;
                }

                if (descLower.includes(word)) {
                    score += 2;
                }
            }

            if (score > highestScore) {
                highestScore = score;
                bestMatch = tool;
            }
        }

        if (!bestMatch) {
            return null;
        }

        const metadata = this.getToolMetadata(bestMatch);
        return { ...metadata, score: highestScore };
    }

}

function parseJsonResponse(text) {
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
        return JSON.parse(cleaned);
    } catch (e) {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (err) { }
        }
        return null;
    }
}

async function resolveContextHelper(options) {
    if (!options || typeof options !== 'object') return { text: '', instance: null, target: null };
    const limit = typeof options.contextLimit === 'number' ? options.contextLimit : (typeof options.limit === 'number' ? options.limit : null);

    let instance = null;
    let target = null;
    let text = '';

    if (options.contextManager && typeof options.contextManager.getForAi === 'function') {
        instance = options.contextManager;
        target = options.contextId || options.contextFile || options.contextPath || options.context || options.file || options.id;
    } else if (options.context && typeof options.context.getForAi === 'function') {
        instance = options.context;
        target = options.contextId || options.contextFile || options.contextPath || options.id || options.file;
    } else if (typeof options.context === 'string') {
        target = options.context;
        if (options.context.endsWith('.json') || options.context.includes('/') || options.context.includes('\\')) {
            instance = new FileContext();
        } else {
            instance = new MemoryContext();
        }
    } else if (options.contextFile || options.contextPath) {
        instance = new FileContext();
        target = options.contextFile || options.contextPath;
    } else if (options.contextId) {
        instance = new MemoryContext();
        target = options.contextId;
    }

    if (instance && target && typeof instance.getForAi === 'function') {
        try {
            text = await instance.getForAi(target, limit);
        } catch (e) { }
    } else if (typeof options.context === 'string') {
        text = options.context;
    }

    return { text, instance, target };
}

const prompt = async (kit, userPrompt, call, options = {}) => {
    const promptStartTime = Date.now();
    let timeToFirstStepMs = null;

    const maxIterations = typeof options === 'number' ? options : (options.maxIterations || 10);
    const debug = typeof options === 'object' && options.debug === true;
    const stream = typeof options === 'object' && (options.stream === true || typeof options.onToken === 'function' || typeof options.onChunk === 'function');
    const onToken = typeof options === 'object' && (options.onToken || options.onChunk);

    const emitToken = (token) => {
        if (onToken) {
            onToken(token);
        } else if (stream) {
            process.stdout.write(token);
        }
    };

    const { text: contextText, instance: ctxInstance, target: ctxTarget } = await resolveContextHelper(options);
    const autoSave = options.autoSave !== false;

    if (autoSave && ctxInstance && ctxTarget && typeof ctxInstance.add === 'function') {
        try {
            await ctxInstance.add(ctxTarget, 'user', userPrompt);
        } catch (err) { }
    }

    const saveAssistantMessage = async (msg) => {
        if (autoSave && ctxInstance && ctxTarget && typeof ctxInstance.add === 'function') {
            try {
                await ctxInstance.add(ctxTarget, 'AI Model(You)', msg);
            } catch (err) { }
        }
    };

    const contextHeader = contextText ? `\n\nCONVERSATION CONTEXT:\n${contextText}` : '';

    const systemInstruction = `You are an AI model operating via JSON tool execution. Always respond with EXACTLY ONE valid JSON object in one of the following formats:

1. Search tools:
{"action": "search", "query": "keywords to search", "requiresContext": true}

2. List categories:
{"action": "list_categories", "requiresContext": true}

3. List tools in a category:
{"action": "list_tools", "category": "category_name", "requiresContext": true}

4. Execute a tool:
{"action": "execute", "name": "tool_name", "args": { "param": "value" }, "requiresContext": false}

5. Final answer:
{"action": "answer", "content": "your final response here", "requiresContext": false}

RULES:
- Respond strictly with valid JSON.
- Include "requiresContext": true or false in your JSON output. Set "requiresContext": false if you have extracted all needed details from CONVERSATION CONTEXT or if past context is no longer needed for subsequent steps.
- Start by using "search" to look for tools relevant to the user request.
- After receiving search results, analyze whether the tool returned is useful for the task:
  a. If the tool IS useful: execute it immediately using "execute". Use empty args {} if parameters are optional or have defaults.
  b. If the tool IS NOT useful or no tool was found: use "list_categories" and "list_tools" to explore categories and find the right tool.
- Only return "answer" after executing the necessary tools and getting execution results, or if no tool exists for the task.${contextHeader}

Task: ${userPrompt}`;

    const history = [];
    history.push({ role: 'user', parts: [{ text: systemInstruction }] });

    const debugLogs = [];

    for (let i = 0; i < maxIterations; i++) {
        const stepStartTime = Date.now();
        let turnTokens = [];
        const response = await call(history, (token) => {
            turnTokens.push(token);
        });
        const stepDurationMs = Date.now() - stepStartTime;

        if (i === 0) {
            timeToFirstStepMs = Date.now() - promptStartTime;
        }

        let text = String(response).trim();
        history.push({ role: 'model', parts: [{ text }] });

        const stepLog = { step: i, rawResponse: text, durationMs: stepDurationMs };
        const parsed = parseJsonResponse(text);

        if (parsed && typeof parsed === 'object') {
            if (parsed.requiresContext === false && history[0] && history[0].parts && history[0].parts[0]) {
                history[0].parts[0].text = history[0].parts[0].text.replace(/\n\nCONVERSATION CONTEXT:[\s\S]*?(?=\n\nTask:)/, '');
            }
            const action = (parsed.action && parsed.action.trim()) || (parsed.query ? 'search' : (parsed.name ? 'execute' : (parsed.category ? 'list_tools' : null)));

            if (action === 'answer') {
                const finalAnswer = parsed.content || parsed.result || text;
                await saveAssistantMessage(finalAnswer);
                emitToken(finalAnswer);
                if (debug) {
                    stepLog.finalAnswer = finalAnswer;
                    debugLogs.push(stepLog);
                    return {
                        result: finalAnswer,
                        iterations: i + 1,
                        totalDurationMs: Date.now() - promptStartTime,
                        timeToFirstStepMs,
                        steps: debugLogs
                    };
                }
                return { result: finalAnswer, iterations: i + 1 };
            }

            let resultText = '';
            try {
                if (action === 'search') {
                    const query = parsed.query || parsed.keywords || '';
                    const res = kit.search(query);
                    resultText = `SEARCH_RESULT: ${JSON.stringify(res || 'No tool found')}`;
                } else if (action === 'list_categories') {
                    resultText = `CATEGORIES: ${kit.listCategoriesAI()}`;
                } else if (action === 'list_tools') {
                    const category = parsed.category || '';
                    resultText = `TOOLS:\n${kit.listToolsAi(category)}`;
                } else if (action === 'execute' || kit.get(action) || kit.get(parsed.name)) {
                    const toolName = parsed.name || action;
                    const args = parsed.args !== undefined ? parsed.args : (parsed[""] !== undefined ? parsed[""] : {});
                    const sysCtx = (typeof options === 'object' && (options.keys || options.key || options.systemContext || options.reservedArgs)) || {};
                    const res = await kit.execute(toolName, args, sysCtx);
                    resultText = `EXECUTION_RESULT: ${JSON.stringify(res)}`;
                } else {
                    await saveAssistantMessage(text);
                    emitToken(text);
                    if (debug) {
                        stepLog.finalAnswer = text;
                        debugLogs.push(stepLog);
                        return {
                            result: text,
                            iterations: i + 1,
                            totalDurationMs: Date.now() - promptStartTime,
                            timeToFirstStepMs,
                            steps: debugLogs
                        };
                    }
                    return { result: text, iterations: i + 1 };
                }
            } catch (err) {
                resultText = `ERROR: ${err.message}`;
            }

            stepLog.actionResult = resultText;
            debugLogs.push(stepLog);
            history.push({ role: 'user', parts: [{ text: resultText }] });
        } else {
            await saveAssistantMessage(text);
            emitToken(text);
            if (debug) {
                stepLog.finalAnswer = text;
                debugLogs.push(stepLog);
                return {
                    result: text,
                    iterations: i + 1,
                    totalDurationMs: Date.now() - promptStartTime,
                    timeToFirstStepMs,
                    steps: debugLogs
                };
            }
            return { result: text, iterations: i + 1 };
        }
    }

    throw new Error('Max iterations reached');
};


module.exports = { ToolKit, McpKit: ToolKit, prompt };
