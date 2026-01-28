import React, { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  GenerationJob,
  ShopifyProduct,
  ShopifyCredentials,
  GeneratedImage,
  ProductGenerationState,
} from '../types';
import {
  analyzeProduct,
  generateImage,
  getDefaultShotIndices,
} from '../services/geminiService';
import {
  fetchProductImagesAsBase64,
  uploadImage,
  deleteAllProductImages,
} from '../services/shopifyService';
import { persistGeneratedImage, saveJob } from '../services/supabaseService';
import { QA_THRESHOLDS, STATUS_MESSAGES } from '../constants';

interface JobDetailsProps {
  job: GenerationJob;
  products: ShopifyProduct[];
  credentials: ShopifyCredentials;
  onUpdateJob: (updater: (job: GenerationJob) => GenerationJob) => void;
  onBack: () => void;
}

const ResultCard: React.FC<{
  image: GeneratedImage;
  onApprove: () => void;
  onRegenerate: (feedback?: string) => void;
  onView: () => void;
}> = ({ image, onApprove, onRegenerate, onView }) => {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');

  const handleRegenerate = () => {
    if (showFeedback && feedback.trim()) {
      onRegenerate(feedback);
      setFeedback('');
      setShowFeedback(false);
    } else {
      setShowFeedback(true);
    }
  };

  const getStatusBadge = () => {
    switch (image.status) {
      case 'generating':
        return (
          <span className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">
            Generating...
          </span>
        );
      case 'success':
        return (
          <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">
            Ready
          </span>
        );
      case 'uploading':
        return (
          <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 rounded">
            Uploading...
          </span>
        );
      case 'uploaded':
        return (
          <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">
            Uploaded
          </span>
        );
      case 'qa_failed':
        return (
          <span className="px-2 py-1 text-xs bg-orange-500/20 text-orange-400 rounded">
            QA Failed
          </span>
        );
      case 'error':
        return (
          <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">
            Error
          </span>
        );
      default:
        return null;
    }
  };

  const imageUrl = image.imageUrl || (image.base64 ? image.base64 : '');

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Image */}
      <div className="aspect-square bg-gray-900 relative cursor-pointer" onClick={onView}>
        {image.status === 'generating' ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt="Generated"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            No image
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-2 right-2">{getStatusBadge()}</div>

        {/* Approval Badge */}
        {image.isApproved && (
          <div className="absolute top-2 left-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        {/* Regeneration Count */}
        {image.regenerationCount > 0 && (
          <div className="absolute bottom-2 left-2 px-2 py-1 bg-gray-800/80 rounded text-xs text-gray-300">
            Attempt {image.regenerationCount + 1}
          </div>
        )}
      </div>

      {/* Info & Actions */}
      <div className="p-3">
        {/* QA Info */}
        {image.qaInfo && (
          <div className={`mb-2 p-2 rounded text-xs ${
            image.qaInfo.isApproved
              ? 'bg-green-500/10 text-green-400'
              : 'bg-orange-500/10 text-orange-400'
          }`}>
            <p className="font-medium">
              {image.qaInfo.isApproved ? 'QA Passed' : 'QA Failed'}
            </p>
            <p className="mt-1 text-gray-400">{image.qaInfo.reasoning}</p>
          </div>
        )}

        {/* Error */}
        {image.error && (
          <div className="mb-2 p-2 bg-red-500/10 rounded text-xs text-red-400">
            {image.error}
          </div>
        )}

        {/* Feedback Input */}
        {showFeedback && (
          <div className="mb-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Describe what to improve..."
              rows={2}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {!image.isApproved && image.status === 'success' && (
            <button
              onClick={onApprove}
              className="flex-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
            >
              Approve
            </button>
          )}
          {['success', 'qa_failed', 'error'].includes(image.status) && (
            <button
              onClick={handleRegenerate}
              className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              {showFeedback ? 'Submit' : 'Regenerate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const JobDetails: React.FC<JobDetailsProps> = ({
  job,
  products,
  credentials,
  onUpdateJob,
  onBack,
}) => {
  const [selectedProductId, setSelectedProductId] = useState<number | null>(
    job.productIds[0] || null
  );
  const [viewingImage, setViewingImage] = useState<GeneratedImage | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const isRunningRef = useRef(false);
  const shouldStopRef = useRef(false);

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const productState = selectedProductId
    ? job.productStates[selectedProductId]
    : null;

  const getProductsForJob = useCallback(
    () => job.productIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ShopifyProduct[],
    [job.productIds, products]
  );

  const updateProductState = useCallback(
    (productId: number, updater: (state: ProductGenerationState) => ProductGenerationState) => {
      onUpdateJob((j) => ({
        ...j,
        productStates: {
          ...j.productStates,
          [productId]: updater(j.productStates[productId]),
        },
      }));
    },
    [onUpdateJob]
  );

  const processProduct = async (product: ShopifyProduct) => {
    if (shouldStopRef.current) return;

    const productId = product.id;
    const state = job.productStates[productId];

    try {
      // Step 1: Fetch source images if not already cached
      let sourceImages = state.sourceImageBase64s;
      if (!sourceImages || sourceImages.length === 0) {
        setStatusMessage(`Fetching images for ${product.title}...`);
        sourceImages = await fetchProductImagesAsBase64(product, credentials);
        updateProductState(productId, (s) => ({
          ...s,
          sourceImageBase64s: sourceImages,
        }));
      }

      if (!sourceImages || sourceImages.length === 0) {
        throw new Error('No source images available');
      }

      // Step 2: Analyze product if not already analyzed
      let analysis = state.analysis;
      if (!analysis) {
        setStatusMessage(`Analyzing ${product.title}...`);
        onUpdateJob((j) => ({ ...j, status: 'analyzing_products' }));
        analysis = await analyzeProduct(product.title, sourceImages);
        updateProductState(productId, (s) => ({
          ...s,
          analysis,
          isAnalyzed: true,
        }));
      }

      if (shouldStopRef.current) return;

      // Step 3: Generate images
      onUpdateJob((j) => ({ ...j, status: 'generating_images' }));
      const shotIndices = getDefaultShotIndices(job.settings.numToGenerate);

      for (let i = 0; i < shotIndices.length; i++) {
        if (shouldStopRef.current) return;

        const existingImage = state.generatedImages[i];
        if (existingImage && ['success', 'uploaded'].includes(existingImage.status)) {
          continue; // Skip already generated images
        }

        const imageId = existingImage?.id || uuidv4();
        setStatusMessage(`Generating image ${i + 1}/${shotIndices.length} for ${product.title}...`);

        // Mark as generating
        updateProductState(productId, (s) => {
          const images = [...s.generatedImages];
          images[i] = {
            id: imageId,
            base64: '',
            prompt: '',
            status: 'generating',
            isApproved: false,
            qaInfo: null,
            regenerationCount: existingImage?.regenerationCount || 0,
          };
          return { ...s, generatedImages: images, isGenerating: true };
        });

        try {
          const result = await generateImage(
            sourceImages!,
            shotIndices[i],
            product.title,
            analysis!,
            job.settings.backgroundOption,
            job.settings.brandGuidelines
          );

          const generatedImage: GeneratedImage = {
            id: imageId,
            base64: result.base64,
            prompt: result.prompt,
            originalPrompt: result.originalPrompt,
            status: result.qaInfo?.isApproved ? 'success' : 'qa_failed',
            isApproved: result.qaInfo?.isApproved || false,
            qaInfo: result.qaInfo,
            regenerationCount: existingImage?.regenerationCount || 0,
          };

          // Auto-retry if QA failed and under threshold
          let finalImage = generatedImage;
          if (
            !result.qaInfo?.isApproved &&
            generatedImage.regenerationCount < QA_THRESHOLDS.MAX_AUTO_REGENERATIONS
          ) {
            setStatusMessage(`Auto-regenerating image ${i + 1} (QA failed)...`);
            const retryResult = await generateImage(
              sourceImages!,
              shotIndices[i],
              product.title,
              analysis!,
              job.settings.backgroundOption,
              job.settings.brandGuidelines,
              true,
              result.qaInfo?.reasoning,
              result.prompt
            );

            finalImage = {
              ...generatedImage,
              base64: retryResult.base64,
              prompt: retryResult.prompt,
              originalPrompt: retryResult.originalPrompt || result.prompt,
              status: retryResult.qaInfo?.isApproved ? 'success' : 'qa_failed',
              isApproved: retryResult.qaInfo?.isApproved || false,
              qaInfo: retryResult.qaInfo,
              regenerationCount: generatedImage.regenerationCount + 1,
            };
          }

          updateProductState(productId, (s) => {
            const images = [...s.generatedImages];
            images[i] = finalImage;
            return { ...s, generatedImages: images };
          });

          // Persist the image
          await persistGeneratedImage(
            { ...job, productStates: { ...job.productStates } },
            productId,
            finalImage
          );
        } catch (error) {
          updateProductState(productId, (s) => {
            const images = [...s.generatedImages];
            images[i] = {
              id: imageId,
              base64: '',
              prompt: '',
              status: 'error',
              error: error instanceof Error ? error.message : 'Generation failed',
              isApproved: false,
              qaInfo: null,
              regenerationCount: existingImage?.regenerationCount || 0,
            };
            return { ...s, generatedImages: images };
          });
        }
      }

      updateProductState(productId, (s) => ({ ...s, isGenerating: false }));
    } catch (error) {
      updateProductState(productId, (s) => ({
        ...s,
        isGenerating: false,
        error: error instanceof Error ? error.message : 'Processing failed',
      }));
    }
  };

  const startGeneration = async () => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    shouldStopRef.current = false;

    onUpdateJob((j) => ({ ...j, status: 'analyzing_products', error: undefined }));

    const jobProducts = getProductsForJob();
    const parallelCount = job.settings.parallelProducts;

    try {
      // Process products in batches
      for (let i = 0; i < jobProducts.length; i += parallelCount) {
        if (shouldStopRef.current) break;

        const batch = jobProducts.slice(i, i + parallelCount);
        await Promise.all(batch.map((product) => processProduct(product)));
      }

      if (!shouldStopRef.current) {
        onUpdateJob((j) => ({ ...j, status: 'completed' }));
        setStatusMessage(STATUS_MESSAGES.COMPLETE);
      }
    } catch (error) {
      onUpdateJob((j) => ({
        ...j,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Job failed',
      }));
    } finally {
      isRunningRef.current = false;
    }
  };

  const stopGeneration = () => {
    shouldStopRef.current = true;
    onUpdateJob((j) => ({ ...j, status: 'stopping' }));
    setStatusMessage('Stopping...');

    // Set final stopped status after a short delay
    setTimeout(() => {
      if (!isRunningRef.current) {
        onUpdateJob((j) => ({ ...j, status: 'stopped' }));
      }
    }, 1000);
  };

  const handleApproveImage = (imageId: string) => {
    if (!selectedProductId) return;

    updateProductState(selectedProductId, (s) => ({
      ...s,
      generatedImages: s.generatedImages.map((img) =>
        img.id === imageId ? { ...img, isApproved: true } : img
      ),
    }));
  };

  const handleRegenerateImage = async (imageIndex: number, feedback?: string) => {
    if (!selectedProductId || !selectedProduct || !productState) return;

    const image = productState.generatedImages[imageIndex];
    if (!image) return;

    const sourceImages = productState.sourceImageBase64s;
    const analysis = productState.analysis;

    if (!sourceImages || !analysis) {
      console.error('Missing source images or analysis');
      return;
    }

    // Mark as generating
    updateProductState(selectedProductId, (s) => {
      const images = [...s.generatedImages];
      images[imageIndex] = {
        ...image,
        status: 'generating',
        error: undefined,
      };
      return { ...s, generatedImages: images };
    });

    try {
      const shotIndices = getDefaultShotIndices(job.settings.numToGenerate);
      const result = await generateImage(
        sourceImages,
        shotIndices[imageIndex],
        selectedProduct.title,
        analysis,
        job.settings.backgroundOption,
        job.settings.brandGuidelines,
        true,
        feedback || image.qaInfo?.reasoning,
        image.prompt
      );

      const regeneratedImage: GeneratedImage = {
        id: image.id,
        base64: result.base64,
        prompt: result.prompt,
        originalPrompt: result.originalPrompt || image.prompt,
        status: result.qaInfo?.isApproved ? 'success' : 'qa_failed',
        isApproved: result.qaInfo?.isApproved || false,
        qaInfo: result.qaInfo,
        regenerationCount: image.regenerationCount + 1,
      };

      updateProductState(selectedProductId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = regeneratedImage;
        return { ...s, generatedImages: images };
      });
    } catch (error) {
      updateProductState(selectedProductId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = {
          ...image,
          status: 'error',
          error: error instanceof Error ? error.message : 'Regeneration failed',
        };
        return { ...s, generatedImages: images };
      });
    }
  };

  const uploadApprovedImages = async () => {
    if (!selectedProductId || !productState || !selectedProduct) return;

    const approvedImages = productState.generatedImages.filter(
      (img) => img.isApproved && img.status !== 'uploaded'
    );

    if (approvedImages.length === 0) {
      alert('No approved images to upload');
      return;
    }

    // Delete existing images if replace mode
    if (job.settings.uploadMode === 'replace' && !job.settings.preserveOriginalImage) {
      setStatusMessage('Removing existing images...');
      await deleteAllProductImages(selectedProductId, credentials);
    }

    setStatusMessage(STATUS_MESSAGES.UPLOADING);

    for (const image of approvedImages) {
      try {
        updateProductState(selectedProductId, (s) => ({
          ...s,
          generatedImages: s.generatedImages.map((img) =>
            img.id === image.id ? { ...img, status: 'uploading' } : img
          ),
        }));

        const imageData = image.base64 || image.imageUrl;
        if (!imageData) continue;

        await uploadImage(selectedProductId, imageData, credentials);

        updateProductState(selectedProductId, (s) => ({
          ...s,
          generatedImages: s.generatedImages.map((img) =>
            img.id === image.id ? { ...img, status: 'uploaded' } : img
          ),
        }));
      } catch (error) {
        console.error('Upload error:', error);
        updateProductState(selectedProductId, (s) => ({
          ...s,
          generatedImages: s.generatedImages.map((img) =>
            img.id === image.id
              ? { ...img, status: 'error', error: 'Upload failed' }
              : img
          ),
        }));
      }
    }

    setStatusMessage('Upload complete');
  };

  // Save job whenever it changes
  useEffect(() => {
    saveJob(job);
  }, [job]);

  const canStart = ['queued', 'stopped', 'failed'].includes(job.status);
  const canStop = ['analyzing_products', 'generating_images'].includes(job.status);

  const totalImages = job.productIds.length * job.settings.numToGenerate;
  const completedImages = Object.values(job.productStates).reduce(
    (sum, state) =>
      sum +
      state.generatedImages.filter((img) =>
        ['success', 'uploaded'].includes(img.status)
      ).length,
    0
  );

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
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">{job.name}</h1>
                <p className="text-sm text-gray-400">{statusMessage || job.status}</p>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {canStart && (
                <button
                  onClick={startGeneration}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  {job.status === 'queued' ? 'Start' : 'Resume'}
                </button>
              )}
              {canStop && (
                <button
                  onClick={stopGeneration}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Overall Progress</span>
              <span>{completedImages} / {totalImages}</span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${(completedImages / totalImages) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Product List */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-white mb-4">Products</h2>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {getProductsForJob().map((product) => {
                  const state = job.productStates[product.id];
                  const imageCount = state?.generatedImages.filter(
                    (img) => ['success', 'uploaded'].includes(img.status)
                  ).length || 0;

                  return (
                    <button
                      key={product.id}
                      onClick={() => setSelectedProductId(product.id)}
                      className={`w-full p-3 rounded-lg text-left transition-colors ${
                        selectedProductId === product.id
                          ? 'bg-blue-600'
                          : 'bg-gray-700 hover:bg-gray-600'
                      }`}
                    >
                      <p className="text-sm text-white truncate">{product.title}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {imageCount}/{job.settings.numToGenerate} images
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Generated Images */}
          <div className="lg:col-span-3">
            {selectedProduct && productState ? (
              <div className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-white">
                      {selectedProduct.title}
                    </h2>
                    {productState.analysis && (
                      <p className="text-sm text-gray-400 mt-1">
                        Size: {productState.analysis.estimatedSize}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={uploadApprovedImages}
                    disabled={
                      productState.generatedImages.filter((img) => img.isApproved).length === 0
                    }
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                  >
                    Upload Approved
                  </button>
                </div>

                {productState.generatedImages.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {productState.generatedImages.map((image, index) => (
                      <ResultCard
                        key={image.id}
                        image={image}
                        onApprove={() => handleApproveImage(image.id)}
                        onRegenerate={(feedback) => handleRegenerateImage(index, feedback)}
                        onView={() => setViewingImage(image)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-400">
                      No images generated yet. Start the job to generate images.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg p-8 text-center">
                <p className="text-gray-400">Select a product to view generated images</p>
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
          <div className="max-w-4xl max-h-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={viewingImage.imageUrl || viewingImage.base64}
              alt="Generated"
              className="max-w-full max-h-[80vh] object-contain rounded-lg"
            />
            <div className="mt-4 bg-gray-800 rounded-lg p-4">
              <p className="text-sm text-gray-300">{viewingImage.prompt}</p>
            </div>
            <button
              onClick={() => setViewingImage(null)}
              className="absolute top-4 right-4 p-2 bg-gray-800 rounded-full text-white hover:bg-gray-700"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobDetails;
