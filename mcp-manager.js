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

const prompt = async (kit, userPrompt, call, maxIterations = 10) => {
    const systemInstruction = `You are a strict tool execution agent. You MUST respond ONLY with a single command starting with one of these exact prefixes:
- SEARCH: <keywords>
- LIST_CATEGORIES
- LIST_TOOLS: <category>
- EXECUTE: <toolName> | [<arg1>, <arg2>, ...]
- FINAL_ANSWER: <your response>

For EXECUTE, provide argument values directly as a JSON array (e.g. EXECUTE: math.add | [25, 75]). Do NOT use parameter object names like {"a": 25, "b": 75}.

Do not include conversational text or markdown formatting unless using FINAL_ANSWER.

Task: ${userPrompt}`;

    const history = [];
    history.push({ role: 'user', parts: [{ text: systemInstruction }] });

        for (let i = 0; i < maxIterations; i++) {
        console.log(`\n================ STEP ${i} SENT TO AI ================`);
        const lastMessage = history[history.length - 1];
        console.log(lastMessage.parts[0].text);

        const response = await call(history);
        const text = String(response).trim();

        console.log(`---------------- STEP ${i} AI RESPONSE ----------------`);
        console.log(text);

        history.push({ role: 'model', parts: [{ text }] });

        if (text.startsWith('FINAL_ANSWER:')) {
            return text.replace('FINAL_ANSWER:', '').trim();
        }

        let resultText = '';
        if (text.startsWith('SEARCH:')) {
            const query = text.replace('SEARCH:', '').trim();
            const result = kit.search(query);
            resultText = `SEARCH_RESULT: ${JSON.stringify(result || 'No tool found')}`;
        } else if (text.startsWith('LIST_CATEGORIES')) {
            const categories = kit.listCategoriesAI();
            resultText = `CATEGORIES_RESULT: ${categories}`;
        } else if (text.startsWith('LIST_TOOLS:')) {
            const category = text.replace('LIST_TOOLS:', '').trim();
            const tools = kit.listToolsAi(category);
            resultText = `TOOLS_RESULT:\n${tools}`;
        } else if (text.startsWith('EXECUTE:')) {
            const parts = text.replace('EXECUTE:', '').split('|');
            const toolName = parts[0].trim();
            const rawArgs = parts[1] ? parts[1].trim() : '[]';

            try {
                const parsedArgs = JSON.parse(rawArgs);
                const result = kit.execute(toolName, parsedArgs);
                resultText = `EXECUTION_RESULT: ${JSON.stringify(result)}`;
            } catch (err) {
                resultText = `EXECUTION_ERROR: ${err.message}`;
            }
        } else {
            resultText = `ERROR: Your output did not start with a valid command prefix. You MUST reply using one of: SEARCH:, LIST_CATEGORIES, LIST_TOOLS:, EXECUTE:, or FINAL_ANSWER:.`;
        }

        history.push({ role: 'user', parts: [{ text: resultText }] });
    }

    throw new Error('Max iterations reached without FINAL_ANSWER');
};



module.exports = { McpKit, prompt };
