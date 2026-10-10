const fs = require('fs');
const path = require('path');

class ModelManager {
  constructor() {
    this.modelsPath = path.join(__dirname, '../../data/models.json');
    this.models = this.loadModels();
  }

  loadModels() {
    try {
      if (fs.existsSync(this.modelsPath)) {
        const data = fs.readFileSync(this.modelsPath, 'utf8');
        const models = JSON.parse(data);
        let removedEmptyApiKey = false;
        for (const provider of Object.values(models.providers || {})) {
          if (provider && Object.hasOwn(provider, 'apiKey') && !String(provider.apiKey || '').trim()) {
            delete provider.apiKey;
            removedEmptyApiKey = true;
          }
        }
        if (removedEmptyApiKey) this.saveModels(models);
        return models;
      } else {
        // Create default structure if file doesn't exist
        const defaultModels = {
          providers: {
            google: {
              name: "Google",
              models: []
            }
          }
        };
        this.saveModels(defaultModels);
        return defaultModels;
      }
    } catch (error) {
      console.error('Error loading models:', error);
      return { providers: {} };
    }
  }

  saveModels(models) {
    try {
      fs.writeFileSync(this.modelsPath, JSON.stringify(models, null, 2), 'utf8');
      this.models = models;
      return true;
    } catch (error) {
      console.error('Error saving models:', error);
      return false;
    }
  }

  getAllProviders() {
    const providers = this.models.providers || {};
    return Object.fromEntries(Object.entries(providers).map(([id, provider]) => [id, { ...provider, hasApiKey: !!provider.apiKey, apiKey: undefined }]));
  }

  getProvider(providerId) {
    return this.models.providers[providerId] || null;
  }

  getProviderModels(providerId) {
    const provider = this.getProvider(providerId);
    return provider ? provider.models : [];
  }

  getAllModels() {
    const allModels = [];
    const providers = this.getAllProviders();
    
    for (const providerId in providers) {
      const provider = providers[providerId];
      provider.models.forEach(model => {
        allModels.push({
          ...model,
          provider: providerId,
          providerName: provider.name
        });
      });
    }
    
    return allModels;
  }

  addProvider(providerId, name, apiUrl = "", apiKey = "") {
    if (this.models.providers[providerId]) {
      return { success: false, error: 'Provider already exists' };
    }

    if (providerId === "google") return { success: false, error: "Reserved provider ID" };
    if (!name || !apiUrl) return { success: false, error: "Provider name and API URL are required" };
    try { new URL(apiUrl); } catch (_) { return { success: false, error: "A valid full API URL is required" }; }
    const provider = {
      name: name,
      type: "custom",
      apiUrl,
      models: []
    };
    if (typeof apiKey === 'string' && apiKey.trim()) provider.apiKey = apiKey.trim();
    this.models.providers[providerId] = provider;

    const saved = this.saveModels(this.models);
    return { 
      success: saved, 
      provider: this.models.providers[providerId] 
    };
  }

  updateProvider(providerId, data = {}) {
    const provider = this.getProvider(providerId);
    if (!provider || providerId === "google") return { success: false, error: "Provider not found or protected" };
    if (data.name) provider.name = data.name;
    if (data.apiUrl) { try { new URL(data.apiUrl); } catch (_) { return { success: false, error: "A valid full API URL is required" }; } provider.apiUrl = data.apiUrl; }
    return { success: this.saveModels(this.models) };
  }

  deleteProvider(providerId) {
    if (!this.models.providers[providerId] || providerId === 'google') {
      return { success: false, error: 'Provider not found or protected' };
    }

    delete this.models.providers[providerId];
    const saved = this.saveModels(this.models);
    return { success: saved };
  }

  addModel(providerId, modelData) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    // Model ID must be unique
    const existingModel = provider.models.find(m => m.id === modelData.id);
    if (existingModel) {
      return { success: false, error: 'Model ID already exists' };
    }

    const newModel = {
      id: modelData.id,
      name: modelData.name,
      description: modelData.description || '',
      default: modelData.default || false,
      supportsThinking: modelData.supportsThinking !== undefined ? modelData.supportsThinking : (providerId === 'google')
    };

    // If this model is default, remove default from others
    if (newModel.default) {
      provider.models.forEach(m => m.default = false);
    }

    provider.models.push(newModel);
    const saved = this.saveModels(this.models);
    
    return { 
      success: saved, 
      model: newModel 
    };
  }

  updateModel(providerId, modelId, modelData) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const modelIndex = provider.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) {
      return { success: false, error: 'Model not found' };
    }

    // Update model
    const updatedModel = {
      ...provider.models[modelIndex],
      id: modelData.id || provider.models[modelIndex].id,
      name: modelData.name || provider.models[modelIndex].name,
      description: modelData.description !== undefined ? modelData.description : provider.models[modelIndex].description,
      default: modelData.default !== undefined ? modelData.default : provider.models[modelIndex].default,
      supportsThinking: modelData.supportsThinking !== undefined ? modelData.supportsThinking : provider.models[modelIndex].supportsThinking
    };

    // If this model is default, remove default from others
    if (updatedModel.default) {
      provider.models.forEach((m, idx) => {
        if (idx !== modelIndex) m.default = false;
      });
    }

    provider.models[modelIndex] = updatedModel;
    const saved = this.saveModels(this.models);
    
    return { 
      success: saved, 
      model: updatedModel 
    };
  }

  deleteModel(providerId, modelId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const modelIndex = provider.models.findIndex(m => m.id === modelId);
    if (modelIndex === -1) {
      return { success: false, error: 'Model not found' };
    }

    provider.models.splice(modelIndex, 1);
    const saved = this.saveModels(this.models);
    
    return { success: saved };
  }

  setDefaultModel(providerId, modelId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    const model = provider.models.find(m => m.id === modelId);
    if (!model) {
      return { success: false, error: 'Model not found' };
    }

    // Remove default from all models
    provider.models.forEach(m => m.default = false);
    
    // Make selected model default
    model.default = true;
    
    const saved = this.saveModels(this.models);
    return { success: saved, model };
  }

  getDefaultModel(providerId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return null;
    }

    const defaultModel = provider.models.find(m => m.default);
    return defaultModel || (provider.models.length > 0 ? provider.models[0] : null);
  }

  getModel(providerId, modelId) {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return null;
    }

    return provider.models.find(m => m.id === modelId) || null;
  }

  /**
   * Check if a model supports thinking
   */
  modelSupportsThinking(providerId, modelId) {
    const model = this.getModel(providerId, modelId);
    if (!model) {
      return false; // Default to false if model not found
    }
    
    // If supportsThinking is explicitly set, use that value
    if (model.supportsThinking !== undefined) {
      return model.supportsThinking;
    }
    
    // Default behavior: Google models generally support thinking, others don't
    return providerId === 'google';
  }

  /**
   * Get model with full info including thinking support
   */
  getModelWithInfo(providerId, modelId) {
    const model = this.getModel(providerId, modelId);
    if (!model) {
      return null;
    }

    return {
      ...model,
      provider: providerId,
      supportsThinking: this.modelSupportsThinking(providerId, modelId)
    };
  }

  reload() {
    this.models = this.loadModels();
    return this.models;
  }
}

module.exports = ModelManager;
