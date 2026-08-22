const fs = require('fs');
const path = require('path');

class MemoryContext {
    constructor() {
        this.contexts = new Map();
    }

    add(id, user, message) {
        const entry = {
            user,
            message,
            timestamp: new Date().toISOString()
        };

        if (!this.contexts.has(id)) {
            this.contexts.set(id, { id, messages: [] });
        }
        const contextData = this.contexts.get(id);
        contextData.messages.push(entry);
        return contextData;
    }

    get(id, limit = null) {
        const contextData = this.contexts.get(id) || null;
        if (!contextData) {
            return null;
        }
        if (typeof limit === 'number' && limit > 0 && Array.isArray(contextData.messages)) {
            return {
                ...contextData,
                messages: contextData.messages.slice(-limit)
            };
        }
        return contextData;
    }

    getForAi(id, limit = null) {
        const data = this.get(id, limit);
        if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
            return '';
        }
        return data.messages.map(m => `${m.user}: ${m.message}`).join('\n');
    }

    edit(id, messageIndex, updatedMessage) {
        const contextData = this.contexts.get(id);
        if (!contextData) {
            throw new Error(`Context with id "${id}" not found in memory`);
        }
        if (messageIndex < 0 || messageIndex >= contextData.messages.length) {
            throw new Error(`Invalid message index ${messageIndex}`);
        }
        contextData.messages[messageIndex].message = updatedMessage;
        contextData.messages[messageIndex].updatedAt = new Date().toISOString();
        return contextData;
    }

    exportToFile(id, targetPath) {
        const contextData = this.contexts.get(id);
        if (!contextData) {
            throw new Error(`Context with id "${id}" not found in memory`);
        }
        const destination = path.resolve(process.cwd(), targetPath);
        const dir = path.dirname(destination);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(destination, JSON.stringify(contextData, null, 2), 'utf8');
        return destination;
    }
}

class FileContext {
    resolvePath(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return null;
        }
        return path.resolve(process.cwd(), filePath);
    }

    add(filePathInput, user, message, id = null) {
        const filePath = this.resolvePath(filePathInput);
        if (!filePath) {
            throw new Error('Valid file path is required');
        }

        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const entry = {
            user,
            message,
            timestamp: new Date().toISOString()
        };

        let contextData = { id: id || path.basename(filePath, '.json'), messages: [] };

        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                contextData = JSON.parse(content);
            } catch (err) {
                contextData = { id: id || path.basename(filePath, '.json'), messages: [] };
            }
        }

        contextData.messages.push(entry);
        fs.writeFileSync(filePath, JSON.stringify(contextData, null, 2), 'utf8');
        return contextData;
    }

    get(param1, param2) {
        let filePathInput = null;
        let limit = null;

        if (typeof param1 === 'object' && param1 !== null) {
            filePathInput = param1.file || param1.path || null;
            limit = typeof param1.limit === 'number' ? param1.limit : null;
        } else {
            filePathInput = param1;
            limit = typeof param2 === 'number' ? param2 : null;
        }

        const filePath = this.resolvePath(filePathInput);
        if (!filePath || !fs.existsSync(filePath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const contextData = JSON.parse(content);

            if (typeof limit === 'number' && limit > 0 && Array.isArray(contextData.messages)) {
                return {
                    ...contextData,
                    messages: contextData.messages.slice(-limit)
                };
            }
            return contextData;
        } catch (err) {
            return null;
        }
    }

    getForAi(param1, param2) {
        const data = this.get(param1, param2);
        if (!data || !Array.isArray(data.messages) || data.messages.length === 0) {
            return '';
        }
        return data.messages.map(m => `${m.user}: ${m.message}`).join('\n');
    }

    edit(filePathInput, messageIndex, updatedMessage) {
        const filePath = this.resolvePath(filePathInput);
        if (!filePath || !fs.existsSync(filePath)) {
            throw new Error(`Context file at "${filePathInput}" does not exist`);
        }

        const content = fs.readFileSync(filePath, 'utf8');
        const contextData = JSON.parse(content);

        if (messageIndex < 0 || messageIndex >= contextData.messages.length) {
            throw new Error(`Invalid message index ${messageIndex}`);
        }

        contextData.messages[messageIndex].message = updatedMessage;
        contextData.messages[messageIndex].updatedAt = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(contextData, null, 2), 'utf8');
        return contextData;
    }
}

module.exports = { MemoryContext, FileContext };
