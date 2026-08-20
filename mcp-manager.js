class McpKit {
    constructor() {
        this.tools = new Map();
    }

    add({ name, fn, category = 'general', parameters = {}, keywords = [], description = '' }) {
        if (!name || typeof fn !== 'function') {
            throw new Error('Tool name and function are required');
        }

        const tool = {
            name,
            fn,
            category,
            parameters,
            keywords,
            description
        };

        this.tools.set(name, tool);
        return tool;
    }

    get(name) {
        return this.tools.get(name);
    }

    execute(name, args) {
        let tool = this.tools.get(name);
        if (!tool && name.includes('.')) {
            const actualName = name.split('.').pop();
            tool = this.tools.get(actualName);
        }
        if (!tool) {
            throw new Error(`Tool "${name}" not found`);
        }

        if (Array.isArray(args)) {
            try {
                return tool.fn(args);
            } catch (err) {
                return tool.fn(...args);
            }
        }
        if (typeof args === 'object' && args !== null) {
            try {
                return tool.fn(args);
            } catch (err) {
                return tool.fn(...Object.values(args));
            }
        }
        return tool.fn(args);
    }


    list(category) {
        const toolsArray = Array.from(this.tools.values());
        const filtered = category ? toolsArray.filter(t => t.category === category) : toolsArray;
        return filtered.map(({ fn, ...metadata }) => metadata);
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

        const { fn, ...metadata } = bestMatch;
        return { ...metadata, score: highestScore };
    }

}

const prompt = async (kit, userPrompt, call, options = {}) => {
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

    const systemInstruction = `Available commands:
- search("keywords")
- list_categories()
- list_tools("category")
- <toolName>(args) or <category>.<toolName>(args)
- answer("your final response")

RULES:
- Call tools directly by name (e.g., github.listRepositories() or add([25, 75])).
- If no tool is needed or task is complete, provide your answer directly or via answer("...").
- Reply with EXACTLY ONE command or answer per turn.
- No need to add anything like <|tool_start_call|> <toolcall> {Json tool call} only write the tool call directly 
- use search tool with more priority, if it gives no tool or incorrect tool then switch to list tools and list categories 
Task: ${userPrompt}`;

    const history = [];
    history.push({ role: 'user', parts: [{ text: systemInstruction }] });

    const debugLogs = [];

    for (let i = 0; i < maxIterations; i++) {
        let turnTokens = [];
        const response = await call(history, (token) => {
            turnTokens.push(token);
        });

        let text = String(response).trim();
        history.push({ role: 'model', parts: [{ text }] });

        const stepLog = { step: i, rawResponse: text };
        text = text.replace(/<\|tool_call_start\|>\[?/g, '').replace(/\]?<\|tool_call_end\|>/g, '').trim();

        if (text.startsWith('answer(')) {
            const match = text.match(/^answer\((?:['"`])?([\s\S]*?)(?:['"`])?\)$/);
            const finalAnswer = match ? match[1] : text.slice(7, -1);
            emitToken(finalAnswer);
            if (debug) {
                stepLog.finalAnswer = finalAnswer;
                debugLogs.push(stepLog);
                return { result: finalAnswer, iterations: i + 1, steps: debugLogs };
            }
            return { result: finalAnswer, iterations: i + 1 };
        }

        let resultText = '';
        try {
            if (text.includes('list_categories')) {
                resultText = `CATEGORIES: ${kit.listCategoriesAI()}`;
            } else if (text.startsWith('list_tools')) {
                const match = text.match(/list_tools\(['"]?([^'"]+)['"]?\)/);
                const category = match ? match[1] : '';
                resultText = `TOOLS:\n${kit.listToolsAi(category)}`;
            } else if (text.startsWith('search')) {
                const match = text.match(/search\(['"]?([^'"]+)['"]?\)/);
                const query = match ? match[1] : '';
                const res = kit.search(query);
                resultText = `SEARCH_RESULT: ${JSON.stringify(res || 'No tool found')}`;
            } else if (text.startsWith('execute')) {
                const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')).trim();
                const parts = inner.split(/,(.+)/);
                let rawName = parts[0] ? parts[0].trim() : '';
                let rawArgs = parts[1] ? parts[1].trim() : '{}';

                let toolName = rawName.replace(/^(?:toolName|name|action)\s*=\s*/i, '').replace(/^['"]|['"]$/g, '').trim();

                let args = {};
                if (rawArgs) {
                    try {
                        args = JSON.parse(rawArgs.replace(/'/g, '"'));
                    } catch (e) {}
                }

                const res = kit.execute(toolName, args);
                resultText = `EXECUTION_RESULT: ${JSON.stringify(res)}`;
            } else if ((text.includes('.') || kit.get(text.split('(')[0])) && text.includes('(')) {
                const parts = text.split('(');
                const toolName = parts[0].replace(/^['"]|['"]$/g, '').trim();
                const rawArgs = parts[1] ? parts[1].replace(/\)$/, '').trim() : '{}';
                let args = {};
                try {
                    args = JSON.parse(rawArgs.replace(/'/g, '"'));
                } catch (e) {}
                const res = kit.execute(toolName, args);
                resultText = `EXECUTION_RESULT: ${JSON.stringify(res)}`;
            } else {
                emitToken(text);
                if (debug) {
                    stepLog.finalAnswer = text;
                    debugLogs.push(stepLog);
                    return { result: text, iterations: i + 1, steps: debugLogs };
                }
                return { result: text, iterations: i + 1 };
            }
        } catch (err) {
            resultText = `ERROR: ${err.message}`;
        }

        stepLog.actionResult = resultText;
        debugLogs.push(stepLog);
        history.push({ role: 'user', parts: [{ text: resultText }] });
    }

    throw new Error('Max iterations reached');
};


module.exports = { McpKit, prompt };
