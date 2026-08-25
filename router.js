class LlmRouter {
    constructor(providers = [], options = {}) {
        if (!Array.isArray(providers) || providers.length === 0) {
            throw new Error('LlmRouter requires an array of provider functions');
        }
        this.providers = providers;
        this.maxRetries = typeof options.maxRetries === 'number' ? options.maxRetries : 2;
        this.retryDelayMs = typeof options.retryDelayMs === 'number' ? options.retryDelayMs : 1000;
        this.activeProviderIndex = 0;
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async call(input, onToken) {
        let lastError = null;

        for (let pIndex = 0; pIndex < this.providers.length; pIndex++) {
            const provider = this.providers[pIndex];
            const callFn = typeof provider === 'function' ? provider : (provider.call || provider.fn);

            if (typeof callFn !== 'function') {
                continue;
            }

            for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
                try {
                    const result = await callFn(input, onToken);
                    this.activeProviderIndex = pIndex;
                    return result;
                } catch (err) {
                    lastError = err;
                    if (attempt < this.maxRetries) {
                        await this.delay(this.retryDelayMs * Math.pow(2, attempt));
                    }
                }
            }
        }

        throw new Error(`LlmRouter failed across all ${this.providers.length} providers. Last error: ${lastError?.message}`);
    }

    getActiveProviderIndex() {
        return this.activeProviderIndex;
    }
}

module.exports = { LlmRouter };
