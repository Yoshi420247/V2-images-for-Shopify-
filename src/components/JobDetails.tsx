import React, { useState, useCallback, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  GenerationJob,
  ShopifyProduct,
  ShopifyCredentials,
  GeneratedImage,
  ProductGenerationState,
  ImageGenerationModel,
  ImageResolution,
} from '../types';
import {
  analyzeAndRefinePrompts,
  generateImage,
  getDefaultShotIndices,
  smartAnalyzeImage,
} from '../services/geminiService';
import {
  fetchProductImagesAsBase64,
  uploadImage,
  deleteImage,
  deleteAllProductImages,
} from '../services/shopifyService';
import { persistGeneratedImage, deleteProductImagesFromStorage } from '../services/supabaseService';
import { saveImageToStore, loadImageFromStore, imageKey, deleteImageFromStore } from '../services/imageStore';
import { STATUS_MESSAGES, IMAGE_MODEL_OPTIONS, IMAGE_RESOLUTION_OPTIONS } from '../constants';

interface JobDetailsProps {
  job: GenerationJob;
  products: ShopifyProduct[];
  credentials: ShopifyCredentials;
  onUpdateJob: (updater: (job: GenerationJob) => GenerationJob) => void;
  onBack: () => void;
}

type ViewMode = 'grid' | 'by-product';
type FilterMode = 'all' | 'selected' | 'approved' | 'failed';

interface ImageWithContext {
  image: GeneratedImage;
  product: ShopifyProduct;
  productState: ProductGenerationState;
  imageIndex: number;
}

// ============================================
// ImageCard - extracted as a stable top-level component
// so React doesn't remount it on every parent re-render
// (which would lose the IndexedDB-loaded base64 state)
// ============================================

interface ImageCardProps {
  item: ImageWithContext;
  showProductName?: boolean;
  jobId: string;
  isAnalyzing: boolean;
  onToggleSelection: (productId: number, imageId: string) => void;
  onSmartRegenerate: (productId: number, imageIndex: number, image: GeneratedImage, product: ShopifyProduct, productState: ProductGenerationState) => void;
  onManualRegenerate: (productId: number, imageIndex: number, image: GeneratedImage, product: ShopifyProduct, productState: ProductGenerationState) => void;
  onViewImage: (item: ImageWithContext) => void;
}

const ImageCard: React.FC<ImageCardProps> = ({
  item,
  showProductName = true,
  jobId,
  isAnalyzing,
  onToggleSelection,
  onSmartRegenerate,
  onManualRegenerate,
  onViewImage,
}) => {
  const { image, product, productState, imageIndex } = item;
  const [loadedBase64, setLoadedBase64] = useState<string | null>(null);
  const imageUrl = image.imageUrl || image.base64 || loadedBase64;

  // Load image from IndexedDB if neither base64 nor imageUrl available
  useEffect(() => {
    if (!image.base64 && !image.imageUrl && image.status !== 'generating') {
      const key = imageKey(jobId, product.id, image.id);
      loadImageFromStore(key).then((data) => {
        if (data) setLoadedBase64(data);
      });
    }
  }, [image.base64, image.imageUrl, image.id, image.status, product.id, jobId]);

  const getStatusColor = () => {
    switch (image.status) {
      case 'generating':
        return 'border-blue-500';
      case 'success':
      case 'uploaded':
        return image.selectedForUpload ? 'border-green-500 ring-2 ring-green-500/50' : 'border-green-500/50';
      case 'qa_failed':
        return 'border-orange-500';
      case 'error':
        return 'border-red-500';
      default:
        return 'border-gray-700';
    }
  };

  return (
    <div
      className={`relative bg-gray-800 rounded-lg overflow-hidden border-2 transition-all ${getStatusColor()} ${
        image.selectedForUpload ? 'shadow-lg shadow-green-500/20' : ''
      }`}
    >
      {/* Checkbox overlay */}
      {image.status !== 'generating' && imageUrl && (
        <div className="absolute top-2 left-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection(product.id, image.id);
            }}
            className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
              image.selectedForUpload
                ? 'bg-green-500 border-green-500'
                : 'bg-gray-900/80 border-gray-500 hover:border-green-400'
            }`}
          >
            {image.selectedForUpload && (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Status badge */}
      <div className="absolute top-2 right-2 z-10">
        {image.status === 'generating' && (
          <span className="px-2 py-1 text-xs bg-blue-500/90 text-white rounded-full">
            Generating...
          </span>
        )}
        {image.status === 'uploaded' && (
          <span className="px-2 py-1 text-xs bg-purple-500/90 text-white rounded-full">
            Uploaded
          </span>
        )}
        {image.status === 'qa_failed' && (
          <span className="px-2 py-1 text-xs bg-orange-500/90 text-white rounded-full">
            QA Failed
          </span>
        )}
        {image.status === 'error' && (
          <span className="px-2 py-1 text-xs bg-red-500/90 text-white rounded-full">
            Error
          </span>
        )}
      </div>

      {/* Image */}
      <div
        className="aspect-square bg-gray-900 cursor-pointer"
        onClick={() => onViewImage(item)}
      >
        {image.status === 'generating' || isAnalyzing ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-2" />
            <span className="text-xs">{isAnalyzing ? 'Analyzing...' : 'Generating...'}</span>
          </div>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt={`Generated for ${product.title}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            No image
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="p-2">
        {showProductName && (
          <p className="text-xs text-gray-300 truncate mb-1" title={product.title}>
            {product.title}
          </p>
        )}

        {/* QA info preview */}
        {image.qaInfo && !image.qaInfo.isApproved && (
          <p className="text-xs text-orange-400 truncate" title={image.qaInfo.reasoning}>
            {image.qaInfo.reasoning}
          </p>
        )}

        {/* Error message */}
        {image.error && (
          <p className="text-xs text-red-400 truncate" title={image.error}>
            {image.error}
          </p>
        )}

        {/* Action buttons */}
        {['success', 'qa_failed', 'error'].includes(image.status) && (
          <div className="flex gap-1 mt-2">
            <button
              onClick={() => onSmartRegenerate(product.id, imageIndex, image, product, productState)}
              disabled={isAnalyzing}
              className="flex-1 px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded transition-colors"
              title="AI analyzes what went wrong and regenerates"
            >
              Smart Regen
            </button>
            <button
              onClick={() => onManualRegenerate(product.id, imageIndex, image, product, productState)}
              className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            >
              Regenerate
            </button>
          </div>
        )}

        {/* Regeneration count */}
        {image.regenerationCount > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            Attempt {image.regenerationCount + 1}
          </p>
        )}
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
  // View and filter state
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(
    job.productIds[0] || null
  );

  // Image viewer modal state
  const [viewingImage, setViewingImage] = useState<ImageWithContext | null>(null);
  const [viewingImageIndex, setViewingImageIndex] = useState<number>(0);
  const [viewerLoadedBase64, setViewerLoadedBase64] = useState<string | null>(null);

  // Load full-screen viewer image from IndexedDB if needed
  useEffect(() => {
    setViewerLoadedBase64(null);
    if (viewingImage && !viewingImage.image.base64 && !viewingImage.image.imageUrl) {
      const key = imageKey(job.id, viewingImage.product.id, viewingImage.image.id);
      loadImageFromStore(key).then((data) => {
        if (data) setViewerLoadedBase64(data);
      });
    }
  }, [viewingImage, job.id]);

  // Status and processing state
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [smartAnalyzing, setSmartAnalyzing] = useState<Set<string>>(new Set());
  const [imageModel, setImageModel] = useState<ImageGenerationModel>(
    job.settings.imageModel || 'nano-banana'
  );
  const [imageResolution, setImageResolution] = useState<ImageResolution>(
    job.settings.imageResolution || '2k'
  );

  // Processing refs
  const isRunningRef = useRef(false);
  const shouldStopRef = useRef(false);

  const getProductsForJob = useCallback(
    () => job.productIds.map((id) => products.find((p) => p.id === id)).filter(Boolean) as ShopifyProduct[],
    [job.productIds, products]
  );

  // Get all images with their context for grid view
  const getAllImagesWithContext = useCallback((): ImageWithContext[] => {
    const images: ImageWithContext[] = [];
    const jobProducts = getProductsForJob();

    for (const product of jobProducts) {
      const state = job.productStates[product.id];
      if (!state) continue;

      state.generatedImages.forEach((image, index) => {
        images.push({
          image,
          product,
          productState: state,
          imageIndex: index,
        });
      });
    }

    return images;
  }, [job.productStates, getProductsForJob]);

  // Filter images based on current filter mode
  const getFilteredImages = useCallback((): ImageWithContext[] => {
    let images = getAllImagesWithContext();

    switch (filterMode) {
      case 'selected':
        return images.filter((i) => i.image.selectedForUpload);
      case 'approved':
        return images.filter((i) => i.image.isApproved || i.image.status === 'success');
      case 'failed':
        return images.filter((i) => i.image.status === 'qa_failed' || i.image.status === 'error');
      default:
        return images;
    }
  }, [getAllImagesWithContext, filterMode]);

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

  // Toggle selection for upload
  const toggleImageSelection = useCallback((productId: number, imageId: string) => {
    updateProductState(productId, (s) => ({
      ...s,
      generatedImages: s.generatedImages.map((img) =>
        img.id === imageId ? { ...img, selectedForUpload: !img.selectedForUpload } : img
      ),
    }));
  }, [updateProductState]);

  // Select all visible images
  const selectAllVisible = useCallback(() => {
    const filtered = getFilteredImages();
    const productUpdates: Record<number, Set<string>> = {};

    for (const item of filtered) {
      if (!productUpdates[item.product.id]) {
        productUpdates[item.product.id] = new Set();
      }
      productUpdates[item.product.id].add(item.image.id);
    }

    for (const [productIdStr, imageIds] of Object.entries(productUpdates)) {
      const productId = Number(productIdStr);
      updateProductState(productId, (s) => ({
        ...s,
        generatedImages: s.generatedImages.map((img) =>
          imageIds.has(img.id) ? { ...img, selectedForUpload: true } : img
        ),
      }));
    }
  }, [getFilteredImages, updateProductState]);

  // Deselect all visible images
  const deselectAllVisible = useCallback(() => {
    const filtered = getFilteredImages();
    const productUpdates: Record<number, Set<string>> = {};

    for (const item of filtered) {
      if (!productUpdates[item.product.id]) {
        productUpdates[item.product.id] = new Set();
      }
      productUpdates[item.product.id].add(item.image.id);
    }

    for (const [productIdStr, imageIds] of Object.entries(productUpdates)) {
      const productId = Number(productIdStr);
      updateProductState(productId, (s) => ({
        ...s,
        generatedImages: s.generatedImages.map((img) =>
          imageIds.has(img.id) ? { ...img, selectedForUpload: false } : img
        ),
      }));
    }
  }, [getFilteredImages, updateProductState]);

  // Smart regenerate - analyze and fix automatically
  const handleSmartRegenerate = useCallback(async (
    productId: number,
    imageIndex: number,
    image: GeneratedImage,
    product: ShopifyProduct,
    productState: ProductGenerationState
  ) => {
    if (!productState.sourceImageBase64s || !productState.analysis) {
      return;
    }

    const analyzeKey = `${productId}-${image.id}`;
    setSmartAnalyzing((prev) => new Set(prev).add(analyzeKey));

    try {
      // Load image data from IndexedDB if not in memory
      let imageData = image.base64 || image.imageUrl || '';
      if (!imageData) {
        const storedData = await loadImageFromStore(imageKey(job.id, productId, image.id));
        if (storedData) imageData = storedData;
      }

      // Step 1: Analyze what went wrong
      const analysisResult = await smartAnalyzeImage(
        imageData,
        productState.sourceImageBase64s[0],
        product.title,
        image.prompt,
        productState.analysis.estimatedSize
      );

      // Step 2: Mark as generating
      updateProductState(productId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = {
          ...image,
          status: 'generating',
          error: undefined,
        };
        return { ...s, generatedImages: images };
      });

      // Step 3: Regenerate with the analyzed feedback
      const feedback = `${analysisResult.analysis}\n\nSuggested fixes:\n${analysisResult.suggestedFixes.join('\n')}`;
      const shotIndices = getDefaultShotIndices(job.settings.numToGenerate);

      const result = await generateImage(
        productState.sourceImageBase64s,
        shotIndices[imageIndex],
        product.title,
        productState.analysis,
        job.settings.backgroundOption,
        job.settings.brandGuidelines,
        true,
        feedback,
        image.prompt,
        imageModel,
        imageResolution
      );

      const regeneratedImage: GeneratedImage = {
        id: image.id,
        base64: result.base64,
        prompt: result.prompt,
        originalPrompt: result.originalPrompt || image.prompt,
        status: result.qaInfo?.isApproved ? 'success' : 'qa_failed',
        isApproved: result.qaInfo?.isApproved || false,
        selectedForUpload: result.qaInfo?.isApproved || false,
        qaInfo: result.qaInfo,
        regenerationCount: image.regenerationCount + 1,
      };

      updateProductState(productId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = regeneratedImage;
        return { ...s, generatedImages: images };
      });
    } catch (error) {
      updateProductState(productId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = {
          ...image,
          status: 'error',
          error: error instanceof Error ? error.message : 'Smart regeneration failed',
        };
        return { ...s, generatedImages: images };
      });
    } finally {
      setSmartAnalyzing((prev) => {
        const next = new Set(prev);
        next.delete(analyzeKey);
        return next;
      });
    }
  }, [job, updateProductState, imageModel, imageResolution]);

  // Manual regenerate with optional feedback
  const handleManualRegenerate = useCallback(async (
    productId: number,
    imageIndex: number,
    image: GeneratedImage,
    product: ShopifyProduct,
    productState: ProductGenerationState,
    feedback?: string
  ) => {
    if (!productState.sourceImageBase64s || !productState.analysis) {
      return;
    }

    updateProductState(productId, (s) => {
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
        productState.sourceImageBase64s,
        shotIndices[imageIndex],
        product.title,
        productState.analysis,
        job.settings.backgroundOption,
        job.settings.brandGuidelines,
        true,
        feedback || image.qaInfo?.reasoning,
        image.prompt,
        imageModel,
        imageResolution
      );

      const regeneratedImage: GeneratedImage = {
        id: image.id,
        base64: result.base64,
        prompt: result.prompt,
        originalPrompt: result.originalPrompt || image.prompt,
        status: result.qaInfo?.isApproved ? 'success' : 'qa_failed',
        isApproved: result.qaInfo?.isApproved || false,
        selectedForUpload: result.qaInfo?.isApproved || false,
        qaInfo: result.qaInfo,
        regenerationCount: image.regenerationCount + 1,
      };

      updateProductState(productId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = regeneratedImage;
        return { ...s, generatedImages: images };
      });
    } catch (error) {
      updateProductState(productId, (s) => {
        const images = [...s.generatedImages];
        images[imageIndex] = {
          ...image,
          status: 'error',
          error: error instanceof Error ? error.message : 'Regeneration failed',
        };
        return { ...s, generatedImages: images };
      });
    }
  }, [job.settings, updateProductState, imageModel, imageResolution]);

  const processProduct = async (product: ShopifyProduct) => {
    if (shouldStopRef.current) return;

    const productId = product.id;
    const state = job.productStates[productId];

    // Smart skip: skip products that already have enough images
    const skipThreshold = job.settings.skipMinImages || 0;
    if (skipThreshold > 0 && product.images && product.images.length >= skipThreshold) {
      setStatusMessage(`Skipping ${product.title} (already has ${product.images.length} images)`);
      updateProductState(productId, (s) => ({ ...s, isGenerating: false }));
      return;
    }

    const maxAutoRetries = job.settings.maxAutoRetries ?? 1;

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

      const shotIndices = getDefaultShotIndices(job.settings.numToGenerate);

      // Step 2: Combined analysis + prompt refinement in ONE API call
      let analysis = state.analysis;
      let preRefinedPrompts: string[] | null = null;

      if (!analysis) {
        setStatusMessage(`Analyzing & preparing prompts for ${product.title}...`);
        onUpdateJob((j) => ({ ...j, status: 'analyzing_products' }));

        const combined = await analyzeAndRefinePrompts(
          product.title,
          sourceImages,
          shotIndices,
          job.settings.backgroundOption,
          job.settings.brandGuidelines
        );

        analysis = combined.analysis;
        preRefinedPrompts = combined.prompts;

        updateProductState(productId, (s) => ({
          ...s,
          analysis,
          isAnalyzed: true,
        }));
      }

      if (shouldStopRef.current) return;

      // Step 3: Generate images (using pre-refined prompts when available)
      onUpdateJob((j) => ({ ...j, status: 'generating_images' }));

      // Track approved image IDs for auto-upload
      const completedImageIds: string[] = [];

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
            selectedForUpload: false,
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
            job.settings.brandGuidelines,
            undefined,
            undefined,
            undefined,
            imageModel,
            imageResolution,
            preRefinedPrompts?.[i]
          );

          const generatedImage: GeneratedImage = {
            id: imageId,
            base64: result.base64,
            prompt: result.prompt,
            originalPrompt: result.originalPrompt,
            status: result.qaInfo?.isApproved ? 'success' : 'qa_failed',
            isApproved: result.qaInfo?.isApproved || false,
            selectedForUpload: result.qaInfo?.isApproved || false,
            qaInfo: result.qaInfo,
            regenerationCount: existingImage?.regenerationCount || 0,
          };

          // Auto-retry if QA failed and under configurable threshold
          let finalImage = generatedImage;
          if (
            !result.qaInfo?.isApproved &&
            generatedImage.regenerationCount < maxAutoRetries
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
              result.prompt,
              imageModel,
              imageResolution
            );

            finalImage = {
              ...generatedImage,
              base64: retryResult.base64,
              prompt: retryResult.prompt,
              originalPrompt: retryResult.originalPrompt || result.prompt,
              status: retryResult.qaInfo?.isApproved ? 'success' : 'qa_failed',
              isApproved: retryResult.qaInfo?.isApproved || false,
              selectedForUpload: retryResult.qaInfo?.isApproved || false,
              qaInfo: retryResult.qaInfo,
              regenerationCount: generatedImage.regenerationCount + 1,
            };
          }

          updateProductState(productId, (s) => {
            const images = [...s.generatedImages];
            images[i] = finalImage;
            return { ...s, generatedImages: images };
          });

          // Track approved images for auto-upload
          if (finalImage.isApproved) {
            completedImageIds.push(finalImage.id);
          }

          // Save to IndexedDB first (always available, no config needed)
          const storeKey = imageKey(job.id, productId, finalImage.id);
          await saveImageToStore(storeKey, finalImage.base64);

          // Also persist to Supabase (optional cloud backup)
          const persistResult = await persistGeneratedImage(
            { ...job, productStates: { ...job.productStates } },
            productId,
            finalImage
          );

          // Clear base64 from React state to free memory
          // Image data is safely stored in IndexedDB (and optionally Supabase)
          updateProductState(productId, (s) => {
            const images = [...s.generatedImages];
            const idx = images.findIndex((img) => img.id === finalImage.id);
            if (idx !== -1) {
              images[idx] = {
                ...images[idx],
                base64: '',
                imageUrl: persistResult.imageUrl || undefined,
              };
            }
            return { ...s, generatedImages: images };
          });
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
              selectedForUpload: false,
              qaInfo: null,
              regenerationCount: existingImage?.regenerationCount || 0,
            };
            return { ...s, generatedImages: images };
          });
        }
      }

      // Auto-upload approved images to Shopify and clean up storage
      if (job.settings.autoUploadApproved && completedImageIds.length > 0) {
        // Load approved images from IndexedDB (React state may be stale in this closure)
        const toUpload: { id: string; data: string }[] = [];
        for (const imgId of completedImageIds) {
          const stored = await loadImageFromStore(imageKey(job.id, productId, imgId));
          if (stored) toUpload.push({ id: imgId, data: stored });
        }

        if (toUpload.length > 0) {
          setStatusMessage(`Uploading ${toUpload.length} images for ${product.title} to Shopify...`);

          // Handle replace mode: delete existing Shopify images first
          if (job.settings.uploadMode === 'replace') {
            if (job.settings.preserveOriginalImage) {
              const imagesToDelete = product.images.filter((img) => img.position !== 1);
              for (const img of imagesToDelete) {
                await deleteImage(productId, img.id, credentials);
              }
            } else {
              await deleteAllProductImages(productId, credentials);
            }
          }

          for (const { id: imgId, data: imgData } of toUpload) {
            try {
              await uploadImage(productId, imgData, credentials);
              updateProductState(productId, (s) => ({
                ...s,
                generatedImages: s.generatedImages.map((i) =>
                  i.id === imgId ? { ...i, status: 'uploaded' } : i
                ),
              }));
            } catch {
              // Individual upload failed - image stays for manual retry
            }
          }

          // Clean up storage after uploads
          setStatusMessage(`Cleaning up storage for ${product.title}...`);
          await deleteProductImagesFromStorage(job.id, productId);
          for (const { id: imgId } of toUpload) {
            await deleteImageFromStore(imageKey(job.id, productId, imgId));
          }
        }
      }

      // Free source images from memory after product is done
      updateProductState(productId, (s) => ({
        ...s,
        isGenerating: false,
        sourceImageBase64s: null,
      }));
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

    // Update image model and resolution in settings
    onUpdateJob((j) => ({
      ...j,
      status: 'analyzing_products',
      error: undefined,
      settings: { ...j.settings, imageModel, imageResolution },
    }));

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

    setTimeout(() => {
      if (!isRunningRef.current) {
        onUpdateJob((j) => ({ ...j, status: 'stopped' }));
      }
    }, 1000);
  };

  // Upload all selected images
  const uploadSelectedImages = async () => {
    const selectedImages = getAllImagesWithContext().filter(
      (item) => item.image.selectedForUpload && item.image.status !== 'uploaded'
    );

    if (selectedImages.length === 0) {
      alert('No images selected for upload');
      return;
    }

    // Group by product for replace mode handling
    const imagesByProduct: Record<number, ImageWithContext[]> = {};
    for (const item of selectedImages) {
      if (!imagesByProduct[item.product.id]) {
        imagesByProduct[item.product.id] = [];
      }
      imagesByProduct[item.product.id].push(item);
    }

    setStatusMessage(`Uploading ${selectedImages.length} images...`);

    for (const [productIdStr, items] of Object.entries(imagesByProduct)) {
      const productId = Number(productIdStr);

      // In replace mode, delete existing images before uploading new ones
      if (job.settings.uploadMode === 'replace') {
        setStatusMessage('Removing existing images...');
        if (job.settings.preserveOriginalImage) {
          // Keep position-1 image (the original), delete the rest
          const product = products.find((p) => p.id === productId);
          if (product) {
            const imagesToDelete = product.images.filter((img) => img.position !== 1);
            for (const img of imagesToDelete) {
              await deleteImage(productId, img.id, credentials);
            }
          }
        } else {
          await deleteAllProductImages(productId, credentials);
        }
      }

      for (const item of items) {
        try {
          updateProductState(productId, (s) => ({
            ...s,
            generatedImages: s.generatedImages.map((img) =>
              img.id === item.image.id ? { ...img, status: 'uploading' } : img
            ),
          }));

          // Prefer IndexedDB (actual base64) over Supabase URL
          let imageData = item.image.base64;
          if (!imageData) {
            const stored = await loadImageFromStore(imageKey(job.id, productId, item.image.id));
            if (stored) imageData = stored;
          }
          // Fall back to Supabase URL (uploadImage handles URLs via Shopify src field)
          if (!imageData && item.image.imageUrl) {
            imageData = item.image.imageUrl;
          }
          if (!imageData) continue;

          await uploadImage(productId, imageData, credentials);

          updateProductState(productId, (s) => ({
            ...s,
            generatedImages: s.generatedImages.map((img) =>
              img.id === item.image.id ? { ...img, status: 'uploaded' } : img
            ),
          }));
        } catch {
          updateProductState(productId, (s) => ({
            ...s,
            generatedImages: s.generatedImages.map((img) =>
              img.id === item.image.id
                ? { ...img, status: 'error', error: 'Upload failed' }
                : img
            ),
          }));
        }
      }
    }

    setStatusMessage('Upload complete');
  };

  // Navigation in image viewer
  const filteredImagesForViewer = getFilteredImages();

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!viewingImage) return;

    const currentIdx = filteredImagesForViewer.findIndex(
      (i) => i.image.id === viewingImage.image.id
    );

    let newIdx: number;
    if (direction === 'prev') {
      newIdx = currentIdx > 0 ? currentIdx - 1 : filteredImagesForViewer.length - 1;
    } else {
      newIdx = currentIdx < filteredImagesForViewer.length - 1 ? currentIdx + 1 : 0;
    }

    setViewingImage(filteredImagesForViewer[newIdx]);
    setViewingImageIndex(newIdx);
  };

  // Keyboard shortcuts for image viewer modal
  useEffect(() => {
    if (!viewingImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingImage(null);
      if (e.key === 'ArrowLeft') navigateImage('prev');
      if (e.key === 'ArrowRight') navigateImage('next');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // navigateImage depends on viewingImage and filteredImagesForViewer,
    // both listed here — exhaustive by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingImage, filteredImagesForViewer]);

  const canStart = ['queued', 'stopped', 'failed'].includes(job.status);
  const canStop = ['analyzing_products', 'generating_images'].includes(job.status);

  const totalImages = job.productIds.length * job.settings.numToGenerate;
  const allImages = getAllImagesWithContext();
  const completedImages = allImages.filter((i) =>
    ['success', 'uploaded'].includes(i.image.status)
  ).length;
  const selectedCount = allImages.filter((i) => i.image.selectedForUpload).length;
  const failedCount = allImages.filter((i) =>
    ['qa_failed', 'error'].includes(i.image.status)
  ).length;

  // Helpers for ImageCard callbacks
  const handleViewImage = useCallback((item: ImageWithContext) => {
    setViewingImage(item);
    setViewingImageIndex(filteredImagesForViewer.findIndex((i) => i.image.id === item.image.id));
  }, [filteredImagesForViewer]);

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3">
              <button
                onClick={onBack}
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-bold text-white">{job.name}</h1>
                <p className="text-xs text-gray-400">{statusMessage || job.status}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Model selector */}
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value as ImageGenerationModel)}
                disabled={!canStart}
                className="px-3 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>

              {/* Resolution selector */}
              <select
                value={imageResolution}
                onChange={(e) => setImageResolution(e.target.value as ImageResolution)}
                disabled={!canStart}
                className="px-3 py-1.5 text-sm bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              >
                {IMAGE_RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name} ({opt.size})
                  </option>
                ))}
              </select>

              {canStart && (
                <button
                  onClick={startGeneration}
                  className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  {job.status === 'queued' ? 'Start' : 'Resume'}
                </button>
              )}
              {canStop && (
                <button
                  onClick={stopGeneration}
                  className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Progress: {completedImages} / {totalImages}</span>
              <span className="flex gap-3">
                <span className="text-green-400">{selectedCount} selected</span>
                {failedCount > 0 && <span className="text-orange-400">{failedCount} failed</span>}
              </span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
                style={{ width: `${(completedImages / totalImages) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="bg-gray-800/50 border-b border-gray-700 sticky top-[104px] z-10">
        <div className="max-w-7xl mx-auto px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between flex-wrap gap-2">
            {/* View mode toggle */}
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-700 rounded-lg p-0.5">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Grid View
                </button>
                <button
                  onClick={() => setViewMode('by-product')}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${
                    viewMode === 'by-product' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  By Product
                </button>
              </div>

              {/* Filter pills */}
              <div className="flex gap-1">
                {(['all', 'selected', 'approved', 'failed'] as FilterMode[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setFilterMode(filter)}
                    className={`px-2 py-1 text-xs rounded-full transition-colors ${
                      filterMode === filter
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {filter.charAt(0).toUpperCase() + filter.slice(1)}
                    {filter === 'selected' && selectedCount > 0 && ` (${selectedCount})`}
                    {filter === 'failed' && failedCount > 0 && ` (${failedCount})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Bulk actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={selectAllVisible}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                Select All
              </button>
              <button
                onClick={deselectAllVisible}
                className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              >
                Deselect All
              </button>
              <button
                onClick={uploadSelectedImages}
                disabled={selectedCount === 0}
                className="px-4 py-1 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Upload Selected ({selectedCount})
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {viewMode === 'grid' ? (
          // Grid View - all images in a responsive grid
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {getFilteredImages().map((item) => (
              <ImageCard
                key={`${item.product.id}-${item.image.id}`}
                item={item}
                showProductName
                jobId={job.id}
                isAnalyzing={smartAnalyzing.has(`${item.product.id}-${item.image.id}`)}
                onToggleSelection={toggleImageSelection}
                onSmartRegenerate={handleSmartRegenerate}
                onManualRegenerate={handleManualRegenerate}
                onViewImage={handleViewImage}
              />
            ))}
          </div>
        ) : (
          // By Product View
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Product list sidebar */}
            <div className="lg:col-span-1">
              <div className="bg-gray-800 rounded-lg p-3 sticky top-[160px]">
                <h2 className="text-sm font-semibold text-white mb-3">Products</h2>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {getProductsForJob().map((product) => {
                    const state = job.productStates[product.id];
                    const successCount = state?.generatedImages.filter(
                      (img) => ['success', 'uploaded'].includes(img.status)
                    ).length || 0;
                    const selectedCount = state?.generatedImages.filter(
                      (img) => img.selectedForUpload
                    ).length || 0;

                    return (
                      <button
                        key={product.id}
                        onClick={() => setSelectedProductId(product.id)}
                        className={`w-full p-2 rounded-lg text-left transition-colors ${
                          selectedProductId === product.id
                            ? 'bg-blue-600'
                            : 'bg-gray-700 hover:bg-gray-600'
                        }`}
                      >
                        <p className="text-xs text-white truncate">{product.title}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {successCount}/{job.settings.numToGenerate} done
                          {selectedCount > 0 && (
                            <span className="text-green-400"> · {selectedCount} selected</span>
                          )}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Product images */}
            <div className="lg:col-span-3">
              {selectedProductId && job.productStates[selectedProductId] ? (
                <div className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-white">
                        {products.find((p) => p.id === selectedProductId)?.title}
                      </h2>
                      {job.productStates[selectedProductId].analysis && (
                        <p className="text-sm text-gray-400">
                          Size: {job.productStates[selectedProductId].analysis?.estimatedSize}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {job.productStates[selectedProductId].generatedImages.map((image, index) => {
                      const product = products.find((p) => p.id === selectedProductId)!;
                      const item: ImageWithContext = {
                        image,
                        product,
                        productState: job.productStates[selectedProductId],
                        imageIndex: index,
                      };
                      return (
                        <ImageCard
                          key={image.id}
                          item={item}
                          showProductName={false}
                          jobId={job.id}
                          isAnalyzing={smartAnalyzing.has(`${product.id}-${image.id}`)}
                          onToggleSelection={toggleImageSelection}
                          onSmartRegenerate={handleSmartRegenerate}
                          onManualRegenerate={handleManualRegenerate}
                          onViewImage={handleViewImage}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-gray-800 rounded-lg p-8 text-center">
                  <p className="text-gray-400">Select a product to view images</p>
                </div>
              )}
            </div>
          </div>
        )}

        {getFilteredImages().length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-400">
              {filterMode === 'all'
                ? 'No images generated yet. Start the job to generate images.'
                : `No ${filterMode} images found.`}
            </p>
          </div>
        )}
      </main>

      {/* Image Viewer Modal */}
      {viewingImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setViewingImage(null)}
        >
          <div className="relative max-w-5xl w-full max-h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Navigation */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 z-10">
              <button
                onClick={() => navigateImage('prev')}
                className="p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 z-10">
              <button
                onClick={() => navigateImage('next')}
                className="p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full text-white"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Close button */}
            <button
              onClick={() => setViewingImage(null)}
              className="absolute top-2 right-2 p-2 bg-gray-800/80 rounded-full text-white hover:bg-gray-700 z-10"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Image */}
            <div className="flex-1 flex items-center justify-center">
              <img
                src={viewingImage.image.imageUrl || viewingImage.image.base64 || viewerLoadedBase64 || ''}
                alt="Generated"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>

            {/* Info panel */}
            <div className="mt-4 bg-gray-800 rounded-lg p-4 max-h-48 overflow-y-auto">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-white mb-1">{viewingImage.product.title}</h3>
                  <p className="text-xs text-gray-400 mb-2">
                    Image {viewingImageIndex + 1} of {filteredImagesForViewer.length}
                  </p>
                  {viewingImage.image.prompt && (
                    <div className="mb-2">
                      <p className="text-xs text-gray-500 mb-1">Prompt:</p>
                      <p className="text-xs text-gray-300">{viewingImage.image.prompt}</p>
                    </div>
                  )}
                  {viewingImage.image.qaInfo && (
                    <div className={`p-2 rounded text-xs ${
                      viewingImage.image.qaInfo.isApproved
                        ? 'bg-green-500/10 text-green-400'
                        : 'bg-orange-500/10 text-orange-400'
                    }`}>
                      <p className="font-medium">
                        {viewingImage.image.qaInfo.isApproved ? 'QA Passed' : 'QA Failed'}
                      </p>
                      <p className="mt-1 text-gray-400">{viewingImage.image.qaInfo.reasoning}</p>
                    </div>
                  )}
                </div>

                {/* Actions in modal */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => toggleImageSelection(viewingImage.product.id, viewingImage.image.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      viewingImage.image.selectedForUpload
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {viewingImage.image.selectedForUpload ? 'Selected' : 'Select'}
                  </button>
                  {['success', 'qa_failed', 'error'].includes(viewingImage.image.status) && (
                    <>
                      <button
                        onClick={() => {
                          handleSmartRegenerate(
                            viewingImage.product.id,
                            viewingImage.imageIndex,
                            viewingImage.image,
                            viewingImage.product,
                            viewingImage.productState
                          );
                          setViewingImage(null);
                        }}
                        className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                      >
                        Smart Regen
                      </button>
                      <button
                        onClick={() => {
                          handleManualRegenerate(
                            viewingImage.product.id,
                            viewingImage.imageIndex,
                            viewingImage.image,
                            viewingImage.product,
                            viewingImage.productState
                          );
                          setViewingImage(null);
                        }}
                        className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      >
                        Regenerate
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobDetails;
