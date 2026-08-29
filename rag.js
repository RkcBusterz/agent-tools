const fs = require('fs');
const path = require('path');

const chunkText = (text, minChar = 300, maxChar = 600) => {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const sentences = text.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [text];
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;

        if ((currentChunk + ' ' + trimmed).trim().length <= maxChar) {
            currentChunk = (currentChunk + ' ' + trimmed).trim();
        } else {
            if (currentChunk.length >= minChar) {
                chunks.push(currentChunk);
                currentChunk = trimmed;
            } else if (currentChunk.length > 0) {
                currentChunk = (currentChunk + ' ' + trimmed).trim();
                chunks.push(currentChunk);
                currentChunk = '';
            } else {
                chunks.push(trimmed);
            }
        }
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
};

const cosineSimilarity = (vecA, vecB) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
        return 0;
    }
    return dotProduct / denominator;
};

class Embedding {
    constructor(modelFn) {
        if (typeof modelFn === 'function') {
            this.modelFn = modelFn;
        }
    }

    async retrieve(options = {}) {
        const {
            prompt,
            source,
            modelFn = this.modelFn,
            limit = 3,
            minChar = 300,
            maxChar = 600
        } = options;

        if (!prompt || !source) {
            throw new Error('Both prompt and source text are required');
        }

        const callFn = typeof modelFn === 'function' ? modelFn : (modelFn?.call || modelFn?.fn);
        if (typeof callFn !== 'function') {
            throw new Error('Embedding requires a valid modelFn function');
        }

        const chunks = Array.isArray(source) ? source : chunkText(source, minChar, maxChar);
        if (chunks.length === 0) {
            return [];
        }

        const rawResult = await callFn(prompt, chunks);
        let scoredChunks = [];

        if (Array.isArray(rawResult)) {
            if (typeof rawResult[0] === 'number') {
                scoredChunks = chunks.map((chunk, index) => ({
                    chunk,
                    score: rawResult[index],
                    index
                }));
            } else if (Array.isArray(rawResult[0])) {
                const promptVec = rawResult[0];
                scoredChunks = chunks.map((chunk, index) => ({
                    chunk,
                    score: cosineSimilarity(promptVec, rawResult[index + 1]),
                    index
                }));
            } else if (typeof rawResult[0] === 'object' && rawResult[0] !== null) {
                scoredChunks = chunks.map((chunk, index) => ({
                    chunk,
                    score: typeof rawResult[index]?.score === 'number' ? rawResult[index].score : (rawResult[index]?.similarity || 0),
                    index
                }));
            }
        } else if (rawResult && typeof rawResult === 'object') {
            if (Array.isArray(rawResult.scores)) {
                scoredChunks = chunks.map((chunk, index) => ({
                    chunk,
                    score: rawResult.scores[index],
                    index
                }));
            } else if (Array.isArray(rawResult.embeddings) || Array.isArray(rawResult.data)) {
                const vecs = rawResult.embeddings || rawResult.data.map(item => item.embedding || item);
                const promptVec = vecs[0];
                scoredChunks = chunks.map((chunk, index) => ({
                    chunk,
                    score: cosineSimilarity(promptVec, vecs[index + 1]),
                    index
                }));
            }
        }

        scoredChunks.sort((a, b) => b.score - a.score);

        return typeof limit === 'number' && limit > 0 ? scoredChunks.slice(0, limit) : scoredChunks;
    }
}

const retrieve = async (prompt, source, modelFn, options = {}) => {
    const engine = new Embedding(modelFn);
    return await engine.retrieve({ prompt, source, modelFn, limit: options.limit, minChar: options.minChar, maxChar: options.maxChar });
};

const processVectorDimensions = (vectorInput, targetDimensions) => {
    let vec = Array.from(vectorInput || []);
    if (targetDimensions === 'raw' || targetDimensions === 'lossless' || !targetDimensions || targetDimensions <= 0) {
        return vec;
    }
    if (typeof targetDimensions === 'number' && vec.length > targetDimensions) {
        vec = vec.slice(0, targetDimensions);
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
        norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < vec.length; i++) {
            vec[i] = vec[i] / norm;
        }
    }
    return vec;
};

class VectorStore {
    constructor(embedFn, nameOrOptions = 'default', options = {}) {
        if (typeof nameOrOptions === 'object' && nameOrOptions !== null) {
            this.name = nameOrOptions.name || 'default';
            this.dimensions = nameOrOptions.dimensions !== undefined ? nameOrOptions.dimensions : 256;
        } else {
            this.name = nameOrOptions;
            this.dimensions = options.dimensions !== undefined ? options.dimensions : 256;
        }
        this.embedFn = embedFn;
        this.vectors = [];
    }

    async add(id, text, metadata = {}) {
        if (!text || typeof text !== 'string') {
            throw new Error('Text string is required for vector addition');
        }
        const callFn = typeof this.embedFn === 'function' ? this.embedFn : (this.embedFn?.call || this.embedFn?.fn);
        if (typeof callFn !== 'function') {
            throw new Error('VectorStore requires a valid embedFn function');
        }

        const rawVec = await callFn(text);
        let vector = Array.isArray(rawVec) ? (Array.isArray(rawVec[0]) ? rawVec[0] : rawVec) : (rawVec?.embedding || []);
        vector = processVectorDimensions(vector, this.dimensions);

        const entry = {
            id: id || `vec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            text,
            vector,
            metadata,
            timestamp: new Date().toISOString()
        };

        this.vectors.push(entry);
        return entry;
    }

    async saveVector(filePath, collectionName) {
        return await this.saveVectors(filePath, collectionName);
    }

    async saveVectors(filePathInput, collectionName = this.name) {
        if (!filePathInput) {
            throw new Error('File path is required to save vectors');
        }
        const targetPath = path.resolve(process.cwd(), filePathInput);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
        }

        const payload = {
            name: collectionName || this.name,
            dimensions: this.dimensions,
            updatedAt: new Date().toISOString(),
            total: this.vectors.length,
            vectors: this.vectors
        };

        await fs.promises.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
        return targetPath;
    }

    async loadVectors(filePathInput) {
        return await this.loadVector(filePathInput);
    }

    async loadVector(filePathInput) {
        if (!filePathInput) {
            throw new Error('File path is required to load vectors');
        }
        const targetPath = path.resolve(process.cwd(), filePathInput);
        if (!fs.existsSync(targetPath)) {
            throw new Error(`Vector file not found at path: ${targetPath}`);
        }

        const content = await fs.promises.readFile(targetPath, 'utf8');
        const parsed = JSON.parse(content);

        if (parsed && Array.isArray(parsed.vectors)) {
            this.name = parsed.name || this.name;
            this.dimensions = parsed.dimensions !== undefined ? parsed.dimensions : this.dimensions;
            this.vectors = parsed.vectors;
        }

        return this.vectors;
    }

    async search(query, options = {}) {
        const { limit = 3, minScore = 0.0 } = options;
        if (!query || this.vectors.length === 0) return [];

        const callFn = typeof this.embedFn === 'function' ? this.embedFn : (this.embedFn?.call || this.embedFn?.fn);
        if (typeof callFn !== 'function') {
            throw new Error('VectorStore requires a valid embedFn function');
        }

        const rawVec = await callFn(query);
        let queryVec = Array.isArray(rawVec) ? (Array.isArray(rawVec[0]) ? rawVec[0] : rawVec) : (rawVec?.embedding || []);
        queryVec = processVectorDimensions(queryVec, this.dimensions);

        const scored = this.vectors.map(item => ({
            id: item.id,
            text: item.text,
            metadata: item.metadata,
            score: cosineSimilarity(queryVec, item.vector)
        }));

        return scored
            .filter(item => item.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
}

module.exports = { Embedding, VectorStore, retrieve, chunkText, cosineSimilarity };
