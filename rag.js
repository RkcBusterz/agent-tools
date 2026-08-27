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

module.exports = { Embedding, retrieve, chunkText, cosineSimilarity };
