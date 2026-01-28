import React, { useState, useEffect, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ShopifyCollection,
  ShopifyCredentials,
  CollectionGenerationState,
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
} from '../services/collectionImageService';
import { QA_THRESHOLDS } from '../constants';

interface CollectionManagerProps {
  credentials: ShopifyCredentials;
  onBack: () => void;
}

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

  // Load collections on mount
  useEffect(() => {
    const loadCollections = async () => {
      try {
        const allCollections = await fetchAllCollections(credentials, setLoadingMessage);
        setCollections(allCollections);
      } catch (error) {
        console.error('Failed to load collections:', error);
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
    }));

    try {
      const analysis = await quickAnalyzeCollection(collection, state.sampleProducts);

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

      // Generate the image
      const result = await generateCollectionImage(
        collection,
        state.sampleProducts,
        productImages,
        QA_THRESHOLDS.MAX_AUTO_REGENERATIONS,
        (stage, data) => {
          console.log(`Collection ${collection.id} - ${stage}:`, data);
        }
      );

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
    if (!state) return null;

    const colors = {
      pending: 'bg-gray-500',
      analyzing: 'bg-blue-500',
      generating: 'bg-purple-500',
      uploading: 'bg-yellow-500',
      completed: 'bg-green-500',
      error: 'bg-red-500',
    };

    const labels = {
      pending: 'Ready',
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
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Collections List */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-white mb-4">
                Collections ({collections.length})
              </h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {collections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => setSelectedCollectionId(collection.id)}
                    className={`w-full p-3 rounded-lg text-left transition-colors ${
                      selectedCollectionId === collection.id
                        ? 'bg-blue-600'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
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
                  </button>
                ))}
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
                        <button
                          onClick={() => uploadCollectionImage(selectedCollection)}
                          disabled={selectedState.status === 'uploading'}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg transition-colors"
                        >
                          Upload to Shopify
                        </button>
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
                  </div>
                )}

                {/* Generation Progress */}
                {selectedState?.status === 'generating' && (
                  <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
                      <p className="text-white">Generating collection image...</p>
                      <p className="text-sm text-gray-400 mt-1">
                        This may take a few minutes
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
