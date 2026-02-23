import React, { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ShopifyCollection,
  ShopifyCredentials,
  CollectionGenerationState,
  MarketContext,
  QueuedCollection,
  CollectionPlan,
} from '../types';
import {
  fetchAllCollections,
  fetchCollectionProducts,
  fetchProductImagesAsBase64,
  updateCollectionImage,
} from '../services/shopifyService';
import {
  generateCollectionImage,
  quickAnalyzeCollection,
  regenerateWithUserFeedback,
} from '../services/collectionImageService';
import { QA_THRESHOLDS } from '../constants';

interface CollectionManagerProps {
  credentials: ShopifyCredentials;
  onBack: () => void;
}

// Preset market contexts for common industries
const MARKET_PRESETS: { label: string; context: MarketContext }[] = [
  {
    label: 'Cannabis Smokeshop',
    context: {
      industry: 'cannabis smokeshop',
      targetDemographic: 'cannabis enthusiasts, recreational users',
      aestheticPreferences: 'modern, edgy, lifestyle-focused',
      avoidElements: ['children', 'medical claims', 'consumption imagery'],
    },
  },
  {
    label: 'Cannabis Extraction',
    context: {
      industry: 'cannabis extraction equipment',
      targetDemographic: 'processors, manufacturers, extraction professionals',
      aestheticPreferences: 'industrial, technical, professional',
      avoidElements: ['consumption', 'recreational use imagery', 'amateur setups'],
    },
  },
  {
    label: 'Vape Retail',
    context: {
      industry: 'vape and e-cigarette retail',
      targetDemographic: 'adult vapers, former smokers',
      aestheticPreferences: 'modern, sleek, lifestyle',
      avoidElements: ['youth imagery', 'health claims', 'smoking'],
    },
  },
  {
    label: 'Head Shop',
    context: {
      industry: 'head shop and accessories',
      targetDemographic: 'counter-culture enthusiasts, collectors',
      aestheticPreferences: 'artistic, colorful, eclectic',
      avoidElements: ['drug use imagery', 'illegal activity suggestions'],
    },
  },
  {
    label: 'Custom...',
    context: {
      industry: '',
      targetDemographic: '',
      aestheticPreferences: '',
      avoidElements: [],
    },
  },
];

const CollectionManager: React.FC<CollectionManagerProps> = ({
  credentials,
  onBack,
}) => {
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading collections...');
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [generationStates, setGenerationStates] = useState<
    Record<number, CollectionGenerationState>
  >({});
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  // New state for market context
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customIndustry, setCustomIndustry] = useState('');
  const [customBrandIdentity, setCustomBrandIdentity] = useState('');

  // New state for queue
  const [queuedCollections, setQueuedCollections] = useState<QueuedCollection[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [queueProgress, setQueueProgress] = useState<{ current: number; total: number } | null>(null);

  // New state for feedback regeneration
  const [feedbackInput, setFeedbackInput] = useState('');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackCollectionId, setFeedbackCollectionId] = useState<number | null>(null);
  const [lastPlan, setLastPlan] = useState<Record<number, CollectionPlan>>({});

  // Load collections on mount
  useEffect(() => {
    const loadCollections = async () => {
      try {
        const allCollections = await fetchAllCollections(credentials, setLoadingMessage);
        setCollections(allCollections);
      } catch {
        // Collections will show as empty on load failure
      } finally {
        setIsLoading(false);
      }
    };

    loadCollections();
  }, [credentials]);

  const getSelectedCollection = () =>
    collections.find((c) => c.id === selectedCollectionId);

  const getGenerationState = (collectionId: number): CollectionGenerationState | null =>
    generationStates[collectionId] || null;

  const updateGenerationState = useCallback(
    (
      collectionId: number,
      updater: (state: CollectionGenerationState) => CollectionGenerationState
    ) => {
      setGenerationStates((prev) => ({
        ...prev,
        [collectionId]: updater(prev[collectionId]),
      }));
    },
    []
  );

  // Handle market preset selection
  const handlePresetChange = (presetLabel: string) => {
    setSelectedPreset(presetLabel);
    const preset = MARKET_PRESETS.find((p) => p.label === presetLabel);
    if (preset && presetLabel !== 'Custom...') {
      setMarketContext(preset.context);
    } else if (presetLabel === 'Custom...') {
      setMarketContext({
        industry: customIndustry,
        brandIdentity: customBrandIdentity,
      });
    } else {
      setMarketContext(null);
    }
  };

  // Update custom market context
  const updateCustomContext = () => {
    if (selectedPreset === 'Custom...') {
      setMarketContext({
        industry: customIndustry,
        brandIdentity: customBrandIdentity,
      });
    }
  };

  const initializeGenerationState = async (collection: ShopifyCollection) => {
    // Fetch sample products
    const products = await fetchCollectionProducts(collection.id, credentials, 5);

    const state: CollectionGenerationState = {
      collection,
      sampleProducts: products,
      analysis: null,
      generatedImage: null,
      status: 'pending',
      error: null,
      marketContext: marketContext || undefined,
    };

    setGenerationStates((prev) => ({
      ...prev,
      [collection.id]: state,
    }));

    return state;
  };

  const analyzeCollection = async (collection: ShopifyCollection) => {
    let state = getGenerationState(collection.id);
    if (!state) {
      state = await initializeGenerationState(collection);
    }

    updateGenerationState(collection.id, (s) => ({
      ...s,
      status: 'analyzing',
      error: null,
      marketContext: marketContext || undefined,
    }));

    try {
      const analysis = await quickAnalyzeCollection(collection, state.sampleProducts, marketContext || undefined);

      updateGenerationState(collection.id, (s) => ({
        ...s,
        analysis,
        status: 'pending',
      }));
    } catch (error) {
      updateGenerationState(collection.id, (s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Analysis failed',
      }));
    }
  };

  const generateImage = async (collection: ShopifyCollection) => {
    let state = getGenerationState(collection.id);
    if (!state) {
      state = await initializeGenerationState(collection);
    }

    updateGenerationState(collection.id, (s) => ({
      ...s,
      status: 'generating',
      error: null,
      marketContext: marketContext || undefined,
    }));

    try {
      // Fetch product images
      const productImages: string[] = [];
      for (const product of state.sampleProducts.slice(0, 3)) {
        const images = await fetchProductImagesAsBase64(product, credentials, 1);
        productImages.push(...images);
      }

      if (productImages.length === 0) {
        throw new Error('No product images available');
      }

      // Generate the image with market context
      const result = await generateCollectionImage(
        collection,
        state.sampleProducts,
        productImages,
        QA_THRESHOLDS.MAX_AUTO_REGENERATIONS,
        undefined,
        marketContext || undefined
      );

      // Store the plan for potential feedback regeneration
      setLastPlan((prev) => ({ ...prev, [collection.id]: result.plan }));

      const generatedImage = {
        id: uuidv4(),
        base64: result.base64,
        prompt: result.plan.analysis.suggestedImageConcept,
        status: result.qaResult.isApproved ? ('success' as const) : ('qa_failed' as const),
        qaResult: result.qaResult,
        regenerationCount: result.attempts - 1,
      };

      updateGenerationState(collection.id, (s) => ({
        ...s,
        analysis: result.plan.analysis,
        generatedImage,
        status: 'pending',
      }));
    } catch (error) {
      updateGenerationState(collection.id, (s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Generation failed',
      }));
    }
  };

  // Regenerate with user feedback
  const handleFeedbackRegenerate = async () => {
    if (!feedbackCollectionId || !feedbackInput.trim()) return;

    const collection = collections.find((c) => c.id === feedbackCollectionId);
    const state = getGenerationState(feedbackCollectionId);
    const plan = lastPlan[feedbackCollectionId];

    if (!collection || !state || !plan || !state.generatedImage?.qaResult) {
      setShowFeedbackModal(false);
      return;
    }

    setShowFeedbackModal(false);

    updateGenerationState(feedbackCollectionId, (s) => ({
      ...s,
      status: 'generating',
      error: null,
      userFeedback: feedbackInput,
    }));

    try {
      // Fetch product images again
      const productImages: string[] = [];
      for (const product of state.sampleProducts.slice(0, 3)) {
        const images = await fetchProductImagesAsBase64(product, credentials, 1);
        productImages.push(...images);
      }

      const result = await regenerateWithUserFeedback(
        collection,
        plan,
        state.generatedImage.qaResult,
        productImages,
        feedbackInput,
        marketContext || undefined
      );

      // Update stored plan
      setLastPlan((prev) => ({ ...prev, [feedbackCollectionId]: result.plan }));

      const generatedImage = {
        id: uuidv4(),
        base64: result.base64,
        prompt: result.plan.analysis.suggestedImageConcept,
        status: result.qaResult.isApproved ? ('success' as const) : ('qa_failed' as const),
        qaResult: result.qaResult,
        regenerationCount: (state.generatedImage?.regenerationCount || 0) + 1,
      };

      updateGenerationState(feedbackCollectionId, (s) => ({
        ...s,
        analysis: result.plan.analysis,
        generatedImage,
        status: 'pending',
      }));
    } catch (error) {
      updateGenerationState(feedbackCollectionId, (s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Feedback regeneration failed',
      }));
    }

    setFeedbackInput('');
    setFeedbackCollectionId(null);
  };

  // Queue management
  const addToQueue = (collectionId: number) => {
    if (queuedCollections.some((q) => q.collectionId === collectionId)) return;

    setQueuedCollections((prev) => [
      ...prev,
      {
        collectionId,
        priority: prev.length,
        addedAt: new Date(),
      },
    ]);

    // Update status to queued
    const collection = collections.find((c) => c.id === collectionId);
    if (collection) {
      initializeGenerationState(collection).then(() => {
        updateGenerationState(collectionId, (s) => ({
          ...s,
          status: 'queued',
        }));
      });
    }
  };

  const removeFromQueue = (collectionId: number) => {
    setQueuedCollections((prev) => prev.filter((q) => q.collectionId !== collectionId));
    updateGenerationState(collectionId, (s) => ({
      ...s,
      status: 'pending',
    }));
  };

  const processQueue = async () => {
    if (queuedCollections.length === 0 || isProcessingQueue) return;

    setIsProcessingQueue(true);
    setQueueProgress({ current: 0, total: queuedCollections.length });

    const queue = [...queuedCollections];

    for (let i = 0; i < queue.length; i++) {
      setQueueProgress({ current: i + 1, total: queue.length });

      const queuedItem = queue[i];
      const collection = collections.find((c) => c.id === queuedItem.collectionId);

      if (collection) {
        await generateImage(collection);
      }

      // Remove from queue
      setQueuedCollections((prev) => prev.filter((q) => q.collectionId !== queuedItem.collectionId));
    }

    setIsProcessingQueue(false);
    setQueueProgress(null);
  };

  const uploadCollectionImage = async (collection: ShopifyCollection) => {
    const state = getGenerationState(collection.id);
    if (!state?.generatedImage) return;

    updateGenerationState(collection.id, (s) => ({
      ...s,
      status: 'uploading',
    }));

    try {
      await updateCollectionImage(
        collection,
        state.generatedImage.base64,
        credentials
      );

      updateGenerationState(collection.id, (s) => ({
        ...s,
        generatedImage: s.generatedImage
          ? { ...s.generatedImage, status: 'uploaded' }
          : null,
        status: 'completed',
      }));

      // Refresh collection to show new image
      const updatedCollections = await fetchAllCollections(credentials);
      setCollections(updatedCollections);
    } catch (error) {
      updateGenerationState(collection.id, (s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      }));
    }
  };

  const getStatusBadge = (collection: ShopifyCollection) => {
    const state = getGenerationState(collection.id);
    const isQueued = queuedCollections.some((q) => q.collectionId === collection.id);

    if (isQueued && state?.status !== 'generating') {
      return (
        <span className="px-2 py-1 text-xs rounded bg-yellow-600 text-white">
          Queued
        </span>
      );
    }

    if (!state) return null;

    const colors = {
      pending: 'bg-gray-500',
      queued: 'bg-yellow-600',
      analyzing: 'bg-blue-500',
      generating: 'bg-purple-500',
      uploading: 'bg-yellow-500',
      completed: 'bg-green-500',
      error: 'bg-red-500',
    };

    const labels = {
      pending: 'Ready',
      queued: 'Queued',
      analyzing: 'Analyzing...',
      generating: 'Generating...',
      uploading: 'Uploading...',
      completed: 'Done',
      error: 'Error',
    };

    return (
      <span
        className={`px-2 py-1 text-xs rounded ${colors[state.status]} text-white`}
      >
        {labels[state.status]}
      </span>
    );
  };

  // Keyboard shortcuts for modals
  useEffect(() => {
    if (!showFeedbackModal && !viewingImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFeedbackModal) {
          setShowFeedbackModal(false);
          setFeedbackInput('');
        }
        if (viewingImage) setViewingImage(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showFeedbackModal, viewingImage]);

  const selectedCollection = getSelectedCollection();
  const selectedState = selectedCollectionId
    ? getGenerationState(selectedCollectionId)
    : null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
          <p className="text-white">{loadingMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={onBack}
                className="p-2 text-gray-400 hover:text-white"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">Collection Images</h1>
                <p className="text-sm text-gray-400">
                  Generate marketing images for your collections
                </p>
              </div>
            </div>
            {/* Queue Controls */}
            <div className="flex items-center space-x-4">
              {queuedCollections.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">
                    {queuedCollections.length} queued
                  </span>
                  <button
                    onClick={processQueue}
                    disabled={isProcessingQueue}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg transition-colors text-sm"
                  >
                    {isProcessingQueue
                      ? `Processing ${queueProgress?.current}/${queueProgress?.total}...`
                      : 'Process Queue'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Market Context Panel */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium text-white mb-3">Market Targeting</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Industry Preset</label>
              <select
                value={selectedPreset}
                onChange={(e) => handlePresetChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
              >
                <option value="">Select market...</option>
                {MARKET_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedPreset === 'Custom...' && (
              <>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Custom Industry</label>
                  <input
                    type="text"
                    value={customIndustry}
                    onChange={(e) => setCustomIndustry(e.target.value)}
                    onBlur={updateCustomContext}
                    placeholder="e.g., luxury watches, organic skincare"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Brand Identity</label>
                  <input
                    type="text"
                    value={customBrandIdentity}
                    onChange={(e) => setCustomBrandIdentity(e.target.value)}
                    onBlur={updateCustomContext}
                    placeholder="e.g., minimalist, eco-friendly, premium"
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
                  />
                </div>
              </>
            )}

            {marketContext && selectedPreset !== 'Custom...' && (
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Active Context</label>
                <div className="px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm text-gray-300">
                  <span className="font-medium text-white">{marketContext.industry}</span>
                  {marketContext.targetDemographic && (
                    <span className="ml-2 text-gray-400">| {marketContext.targetDemographic}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Collections List */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">
                  Collections ({collections.length})
                </h2>
                {collections.length > 0 && (
                  <button
                    onClick={() => {
                      // Add all unqueued collections to queue
                      collections.forEach((c) => {
                        if (!queuedCollections.some((q) => q.collectionId === c.id)) {
                          addToQueue(c.id);
                        }
                      });
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    Queue All
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {collections.map((collection) => {
                  const isQueued = queuedCollections.some((q) => q.collectionId === collection.id);
                  return (
                    <div
                      key={collection.id}
                      className={`p-3 rounded-lg transition-colors ${
                        selectedCollectionId === collection.id
                          ? 'bg-blue-600'
                          : isQueued
                          ? 'bg-yellow-900/30 border border-yellow-600/50'
                          : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      <div
                        className="cursor-pointer"
                        onClick={() => setSelectedCollectionId(collection.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">{collection.title}</p>
                            <p className="text-xs text-gray-400 mt-1">
                              {collection.collection_type} - {collection.products_count || 0} products
                            </p>
                          </div>
                          {getStatusBadge(collection)}
                        </div>
                        {collection.image && (
                          <div className="mt-2 h-16 rounded overflow-hidden">
                            <img
                              src={collection.image.src}
                              alt={collection.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                      </div>
                      {/* Queue toggle button */}
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isQueued) {
                              removeFromQueue(collection.id);
                            } else {
                              addToQueue(collection.id);
                            }
                          }}
                          className={`text-xs px-2 py-1 rounded ${
                            isQueued
                              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                              : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
                          }`}
                        >
                          {isQueued ? 'Remove from Queue' : '+ Add to Queue'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Collection Details */}
          <div className="lg:col-span-2">
            {selectedCollection ? (
              <div className="bg-gray-800 rounded-lg p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-white">
                      {selectedCollection.title}
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {selectedCollection.collection_type} collection
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    {selectedState?.generatedImage &&
                      selectedState.generatedImage.status !== 'uploaded' && (
                        <>
                          <button
                            onClick={() => {
                              setFeedbackCollectionId(selectedCollection.id);
                              setShowFeedbackModal(true);
                            }}
                            disabled={selectedState.status === 'generating'}
                            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-600/50 text-white rounded-lg transition-colors"
                          >
                            Feedback Regen
                          </button>
                          <button
                            onClick={() => uploadCollectionImage(selectedCollection)}
                            disabled={selectedState.status === 'uploading'}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors"
                          >
                            Upload to Shopify
                          </button>
                        </>
                      )}
                    <button
                      onClick={() => generateImage(selectedCollection)}
                      disabled={
                        selectedState?.status === 'generating' ||
                        selectedState?.status === 'uploading'
                      }
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                    >
                      {selectedState?.generatedImage ? 'Regenerate' : 'Generate Image'}
                    </button>
                  </div>
                </div>

                {/* Current Collection Image */}
                {selectedCollection.image && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                      Current Image
                    </h3>
                    <div className="h-48 rounded-lg overflow-hidden bg-gray-900">
                      <img
                        src={selectedCollection.image.src}
                        alt={selectedCollection.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                )}

                {/* Analysis */}
                {selectedState?.analysis && (
                  <div className="mb-6 p-4 bg-gray-700 rounded-lg">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                      Collection Analysis
                    </h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-400">Theme</p>
                        <p className="text-white">{selectedState.analysis.collectionTheme}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Target Audience</p>
                        <p className="text-white">{selectedState.analysis.targetAudience}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Visual Style</p>
                        <p className="text-white">{selectedState.analysis.visualStyle}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Marketing Angle</p>
                        <p className="text-white">{selectedState.analysis.marketingAngle}</p>
                      </div>
                    </div>
                    <div className="mt-3">
                      <p className="text-gray-400">Image Concept</p>
                      <p className="text-white text-sm">
                        {selectedState.analysis.suggestedImageConcept}
                      </p>
                    </div>
                  </div>
                )}

                {/* Generated Image */}
                {selectedState?.generatedImage && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                      Generated Image
                      {selectedState.generatedImage.regenerationCount > 0 && (
                        <span className="ml-2 text-xs text-gray-400">
                          (Attempt {selectedState.generatedImage.regenerationCount + 1})
                        </span>
                      )}
                    </h3>
                    <div
                      className="h-64 rounded-lg overflow-hidden bg-gray-900 cursor-pointer"
                      onClick={() =>
                        setViewingImage(selectedState.generatedImage?.base64 || null)
                      }
                    >
                      <img
                        src={selectedState.generatedImage.base64}
                        alt="Generated"
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* QA Result */}
                    {selectedState.generatedImage.qaResult && (
                      <div
                        className={`mt-3 p-3 rounded-lg ${
                          selectedState.generatedImage.qaResult.isApproved
                            ? 'bg-green-500/10'
                            : 'bg-orange-500/10'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`text-sm font-medium ${
                              selectedState.generatedImage.qaResult.isApproved
                                ? 'text-green-400'
                                : 'text-orange-400'
                            }`}
                          >
                            {selectedState.generatedImage.qaResult.isApproved
                              ? 'Quality Check Passed'
                              : 'Quality Check Issues'}
                          </span>
                          <div className="flex space-x-4 text-sm">
                            <span className="text-gray-400">
                              Category: {selectedState.generatedImage.qaResult.categoryMatch}/10
                            </span>
                            <span className="text-gray-400">
                              Realism: {selectedState.generatedImage.qaResult.realismScore}/10
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-300">
                          {selectedState.generatedImage.qaResult.reasoning}
                        </p>
                        {selectedState.generatedImage.qaResult.issues.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-400 mb-1">Issues:</p>
                            <ul className="text-xs text-gray-300 list-disc list-inside">
                              {selectedState.generatedImage.qaResult.issues.map(
                                (issue, i) => (
                                  <li key={i}>{issue}</li>
                                )
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* User Feedback Display */}
                    {selectedState.userFeedback && (
                      <div className="mt-2 p-2 bg-blue-900/20 border border-blue-600/30 rounded">
                        <p className="text-xs text-blue-400">Your feedback:</p>
                        <p className="text-sm text-gray-300">{selectedState.userFeedback}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Generation Progress */}
                {selectedState?.status === 'generating' && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
                      <p className="text-white">Generating collection image...</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {marketContext ? `Targeting: ${marketContext.industry}` : 'Processing...'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Error */}
                {selectedState?.error && (
                  <div className="p-4 bg-red-500/10 border border-red-500/50 rounded-lg">
                    <p className="text-sm text-red-400">{selectedState.error}</p>
                  </div>
                )}

                {/* Sample Products */}
                {selectedState?.sampleProducts && selectedState.sampleProducts.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-2">
                      Sample Products
                    </h3>
                    <div className="grid grid-cols-5 gap-2">
                      {selectedState.sampleProducts.map((product) => (
                        <div
                          key={product.id}
                          className="aspect-square rounded overflow-hidden bg-gray-900"
                        >
                          {product.images[0] ? (
                            <img
                              src={product.images[0].src}
                              alt={product.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
                              No image
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quick Analysis Button */}
                {!selectedState?.analysis && selectedState?.status !== 'analyzing' && (
                  <button
                    onClick={() => analyzeCollection(selectedCollection)}
                    className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                  >
                    Analyze Collection First
                  </button>
                )}

                {selectedState?.status === 'analyzing' && (
                  <div className="mt-4 flex items-center text-sm text-gray-400">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2" />
                    Analyzing collection...
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg p-8 text-center">
                <p className="text-gray-400">
                  Select a collection to generate marketing images
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowFeedbackModal(false)}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              Feedback Regeneration
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Explain what went wrong with the generated image. Be specific about what
              you want changed - the AI will use your feedback to create an improved version.
            </p>
            <textarea
              value={feedbackInput}
              onChange={(e) => setFeedbackInput(e.target.value)}
              placeholder="e.g., 'The products are too small in the frame. I need them to be more prominent and centered. The lighting feels too dark for our brand aesthetic.'"
              className="w-full h-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm resize-none"
            />
            <div className="flex justify-end space-x-3 mt-4">
              <button
                onClick={() => {
                  setShowFeedbackModal(false);
                  setFeedbackInput('');
                }}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFeedbackRegenerate}
                disabled={!feedbackInput.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-600/50 text-white rounded-lg transition-colors"
              >
                Regenerate with Feedback
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingImage(null)}
        >
          <div className="max-w-4xl max-h-full">
            <img
              src={viewingImage}
              alt="Generated"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <button
              onClick={() => setViewingImage(null)}
              className="absolute top-4 right-4 p-2 bg-gray-800 rounded-full text-white hover:bg-gray-700"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CollectionManager;
