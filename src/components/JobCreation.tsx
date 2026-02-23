import React, { useState, useMemo } from 'react';
import { ShopifyProduct, GenerationSettings, BackgroundOption } from '../types';
import {
  DEFAULT_GENERATION_SETTINGS,
  MAX_IMAGES_PER_PRODUCT,
  MIN_IMAGES_PER_PRODUCT,
  MAX_PARALLEL_PRODUCTS,
  PRESET_BACKGROUND_COLORS,
  PRESET_GRADIENTS,
} from '../constants';

interface JobCreationProps {
  products: ShopifyProduct[];
  onCreateJob: (
    name: string,
    productIds: number[],
    settings: GenerationSettings
  ) => void;
  onCancel: () => void;
}

const ProductCard: React.FC<{
  product: ShopifyProduct;
  isSelected: boolean;
  onToggle: () => void;
}> = ({ product, isSelected, onToggle }) => {
  const imageUrl = product.images[0]?.src || '';

  return (
    <div
      onClick={onToggle}
      className={`relative cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-500/50'
          : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="aspect-square bg-gray-800">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500">
            No image
          </div>
        )}
      </div>
      <div className="p-2 bg-gray-800">
        <p className="text-sm text-white truncate">{product.title}</p>
        <p className="text-xs text-gray-400 truncate">
          {product.vendor && <span className="text-blue-400">{product.vendor}</span>}
          {product.vendor && ' · '}
          {product.images.length} images
        </p>
      </div>
      {isSelected && (
        <div className="absolute top-2 right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
          <svg
            className="w-4 h-4 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </div>
  );
};

const JobCreation: React.FC<JobCreationProps> = ({
  products,
  onCreateJob,
  onCancel,
}) => {
  const [jobName, setJobName] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<GenerationSettings>(DEFAULT_GENERATION_SETTINGS);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterVendor, setFilterVendor] = useState<string>('all');
  const [filterImageCount, setFilterImageCount] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'title' | 'vendor' | 'type'>('title');
  const [backgroundType, setBackgroundType] = useState<'default' | 'transparent' | 'solid' | 'gradient' | 'custom'>('default');
  const [customBackground, setCustomBackground] = useState('');
  const [solidColor, setSolidColor] = useState('#FFFFFF');
  const [gradientColors, setGradientColors] = useState(['#FFFFFF', '#F0F0F0']);

  // Get unique product types
  const productTypes = useMemo(() => {
    const types = new Set(products.map((p) => p.product_type).filter(Boolean));
    return Array.from(types).sort();
  }, [products]);

  // Get unique vendors
  const vendors = useMemo(() => {
    const vendorSet = new Set(products.map((p) => p.vendor).filter(Boolean));
    return Array.from(vendorSet).sort();
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      const matchesSearch =
        product.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        product.vendor?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'all' || product.product_type === filterType;
      const matchesVendor = filterVendor === 'all' || product.vendor === filterVendor;

      // Image count filter
      let matchesImageCount = true;
      const imageCount = product.images?.length || 0;
      switch (filterImageCount) {
        case 'none':
          matchesImageCount = imageCount === 0;
          break;
        case 'single':
          matchesImageCount = imageCount === 1;
          break;
        case 'few':
          matchesImageCount = imageCount <= 2;
          break;
        case 'needs-images':
          matchesImageCount = imageCount <= 1;
          break;
        case 'all':
        default:
          matchesImageCount = true;
      }

      return matchesSearch && matchesType && matchesVendor && matchesImageCount;
    });

    // Sort products
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'vendor':
          return (a.vendor || '').localeCompare(b.vendor || '');
        case 'type':
          return (a.product_type || '').localeCompare(b.product_type || '');
        case 'title':
        default:
          return a.title.localeCompare(b.title);
      }
    });
  }, [products, searchQuery, filterType, filterVendor, filterImageCount, sortBy]);

  const toggleProduct = (productId: number) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Range selection state
  const [rangeStart, setRangeStart] = useState<string>('');
  const [rangeEnd, setRangeEnd] = useState<string>('');

  const selectAll = () => {
    setSelectedProductIds(new Set(filteredProducts.map((p) => p.id)));
  };

  const deselectAll = () => {
    setSelectedProductIds(new Set());
  };

  const selectRange = () => {
    const start = parseInt(rangeStart) || 1;
    const end = parseInt(rangeEnd) || filteredProducts.length;

    // Validate range
    const validStart = Math.max(1, Math.min(start, filteredProducts.length));
    const validEnd = Math.max(validStart, Math.min(end, filteredProducts.length));

    // Select products in range (1-indexed for user, 0-indexed in array)
    const rangeProducts = filteredProducts.slice(validStart - 1, validEnd);
    setSelectedProductIds(new Set(rangeProducts.map((p) => p.id)));
  };

  const addRange = () => {
    const start = parseInt(rangeStart) || 1;
    const end = parseInt(rangeEnd) || filteredProducts.length;

    const validStart = Math.max(1, Math.min(start, filteredProducts.length));
    const validEnd = Math.max(validStart, Math.min(end, filteredProducts.length));

    const rangeProducts = filteredProducts.slice(validStart - 1, validEnd);
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      rangeProducts.forEach((p) => next.add(p.id));
      return next;
    });
  };

  const getBackgroundOption = (): BackgroundOption => {
    switch (backgroundType) {
      case 'transparent':
        return { type: 'transparent' };
      case 'solid':
        return { type: 'solid', color: solidColor };
      case 'gradient':
        return { type: 'gradient', colors: gradientColors };
      case 'custom':
        return { type: 'custom', description: customBackground };
      default:
        return { type: 'default' };
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const name = jobName.trim() || `Job ${new Date().toLocaleDateString()}`;
    const finalSettings: GenerationSettings = {
      ...settings,
      backgroundOption: getBackgroundOption(),
    };

    onCreateJob(name, Array.from(selectedProductIds), finalSettings);
  };

  const isValid = selectedProductIds.size > 0;

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Create New Job</h1>
              <p className="text-sm text-gray-400">
                Select products and configure generation settings
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!isValid}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Create Job ({selectedProductIds.size} products)
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product Selection */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Select Products</h2>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={selectAll}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Select all
                  </button>
                  <span className="text-gray-500">|</span>
                  <button
                    onClick={deselectAll}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              {/* Range Selector */}
              <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-700 rounded-lg">
                <span className="text-sm text-gray-300">Select range:</span>
                <input
                  type="number"
                  placeholder="From"
                  value={rangeStart}
                  onChange={(e) => setRangeStart(e.target.value)}
                  min={1}
                  max={filteredProducts.length}
                  className="w-20 px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-gray-400">-</span>
                <input
                  type="number"
                  placeholder="To"
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(e.target.value)}
                  min={1}
                  max={filteredProducts.length}
                  className="w-20 px-2 py-1 bg-gray-600 border border-gray-500 rounded text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400">(of {filteredProducts.length})</span>
                <button
                  onClick={selectRange}
                  className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                >
                  Select Range
                </button>
                <button
                  onClick={addRange}
                  className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
                >
                  Add to Selection
                </button>
              </div>

              {/* Filters */}
              <div className="flex flex-col gap-4 mb-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Search products..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <select
                      value={filterVendor}
                      onChange={(e) => setFilterVendor(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All vendors</option>
                      {vendors.map((vendor) => (
                        <option key={vendor} value={vendor}>
                          {vendor}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All types</option>
                      {productTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      value={filterImageCount}
                      onChange={(e) => setFilterImageCount(e.target.value)}
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="all">All image counts</option>
                      <option value="needs-images">Needs images (0-1)</option>
                      <option value="none">No images</option>
                      <option value="single">Single image</option>
                      <option value="few">Few images (0-2)</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Sort by:</span>
                  <button
                    onClick={() => setSortBy('title')}
                    className={`px-3 py-1 text-sm rounded ${
                      sortBy === 'title' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    Title
                  </button>
                  <button
                    onClick={() => setSortBy('vendor')}
                    className={`px-3 py-1 text-sm rounded ${
                      sortBy === 'vendor' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    Vendor
                  </button>
                  <button
                    onClick={() => setSortBy('type')}
                    className={`px-3 py-1 text-sm rounded ${
                      sortBy === 'type' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
                    }`}
                  >
                    Type
                  </button>
                  <span className="ml-auto text-sm text-gray-400">
                    {filteredProducts.length} products
                  </span>
                </div>
              </div>

              {/* Product Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 max-h-[600px] overflow-y-auto">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    isSelected={selectedProductIds.has(product.id)}
                    onToggle={() => toggleProduct(product.id)}
                  />
                ))}
              </div>

              {filteredProducts.length === 0 && (
                <p className="text-center text-gray-400 py-8">No products found</p>
              )}
            </div>
          </div>

          {/* Settings Panel */}
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-lg p-4 sticky top-24">
              <h2 className="text-lg font-semibold text-white mb-4">Settings</h2>

              <div className="space-y-4">
                {/* Job Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Job Name
                  </label>
                  <input
                    type="text"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                    placeholder="My generation job"
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Images per Product */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Images per Product: {settings.numToGenerate}
                  </label>
                  <input
                    type="range"
                    min={MIN_IMAGES_PER_PRODUCT}
                    max={MAX_IMAGES_PER_PRODUCT}
                    value={settings.numToGenerate}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        numToGenerate: parseInt(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{MIN_IMAGES_PER_PRODUCT}</span>
                    <span>{MAX_IMAGES_PER_PRODUCT}</span>
                  </div>
                </div>

                {/* Parallel Products */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Parallel Products: {settings.parallelProducts}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={MAX_PARALLEL_PRODUCTS}
                    value={settings.parallelProducts}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        parallelProducts: parseInt(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Higher values process faster but may hit rate limits
                  </p>
                </div>

                {/* Upload Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Upload Mode
                  </label>
                  <select
                    value={settings.uploadMode}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        uploadMode: e.target.value as 'replace' | 'append',
                      }))
                    }
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="append">Add to existing images</option>
                    <option value="replace">Replace all images</option>
                  </select>
                </div>

                {/* Background Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Background Style
                  </label>
                  <select
                    value={backgroundType}
                    onChange={(e) =>
                      setBackgroundType(
                        e.target.value as typeof backgroundType
                      )
                    }
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="default">Auto (best for shot type)</option>
                    <option value="transparent">Transparent-ready</option>
                    <option value="solid">Solid color</option>
                    <option value="gradient">Gradient</option>
                    <option value="custom">Custom description</option>
                  </select>

                  {/* Background Type Specific Options */}
                  {backgroundType === 'solid' && (
                    <div className="mt-2">
                      <label className="block text-xs text-gray-400 mb-1">
                        Select color
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {PRESET_BACKGROUND_COLORS.map((color) => (
                          <button
                            key={color.value}
                            onClick={() => setSolidColor(color.value)}
                            className={`w-8 h-8 rounded border-2 ${
                              solidColor === color.value
                                ? 'border-blue-500'
                                : 'border-gray-600'
                            }`}
                            style={{ backgroundColor: color.value }}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {backgroundType === 'gradient' && (
                    <div className="mt-2">
                      <label className="block text-xs text-gray-400 mb-1">
                        Select gradient
                      </label>
                      <div className="flex flex-col gap-2">
                        {PRESET_GRADIENTS.map((gradient) => (
                          <button
                            key={gradient.name}
                            onClick={() => setGradientColors(gradient.colors)}
                            className={`px-3 py-2 rounded text-sm text-left ${
                              gradientColors.join() === gradient.colors.join()
                                ? 'ring-2 ring-blue-500'
                                : ''
                            }`}
                            style={{
                              background: `linear-gradient(90deg, ${gradient.colors.join(', ')})`,
                              color:
                                gradient.colors[0] === '#1A1A2E' ? 'white' : 'black',
                            }}
                          >
                            {gradient.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {backgroundType === 'custom' && (
                    <div className="mt-2">
                      <label className="block text-xs text-gray-400 mb-1">
                        Describe the background
                      </label>
                      <textarea
                        value={customBackground}
                        onChange={(e) => setCustomBackground(e.target.value)}
                        placeholder="e.g., Natural marble surface with soft shadows..."
                        rows={3}
                        className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}
                </div>

                {/* Skip Products with Enough Images */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Skip products with {settings.skipMinImages || 0} or more images
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={settings.skipMinImages || 0}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        skipMinImages: parseInt(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>0 (off)</span>
                    <span>12</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {settings.skipMinImages
                      ? `Products with ${settings.skipMinImages}+ existing Shopify images will be skipped`
                      : 'Process all selected products regardless of existing images'}
                  </p>
                </div>

                {/* Max Auto Retries */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Max auto-retries on QA fail: {settings.maxAutoRetries ?? 1}
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={3}
                    value={settings.maxAutoRetries ?? 1}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        maxAutoRetries: parseInt(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>0 (none)</span>
                    <span>3</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    {(settings.maxAutoRetries ?? 1) === 0
                      ? 'No auto-retries. Failed images can be manually regenerated.'
                      : `Each failed image will auto-retry up to ${settings.maxAutoRetries ?? 1} time(s) before stopping`}
                  </p>
                </div>

                {/* Preserve Original */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="preserveOriginal"
                    checked={settings.preserveOriginalImage}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        preserveOriginalImage: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <label
                    htmlFor="preserveOriginal"
                    className="ml-2 text-sm text-gray-300"
                  >
                    Keep original product images
                  </label>
                </div>

                {/* Summary */}
                <div className="pt-4 border-t border-gray-700">
                  <h3 className="text-sm font-medium text-gray-300 mb-2">Summary</h3>
                  {(() => {
                    const skipThreshold = settings.skipMinImages || 0;
                    const selectedProducts = products.filter((p) => selectedProductIds.has(p.id));
                    const skippedCount = skipThreshold > 0
                      ? selectedProducts.filter((p) => (p.images?.length || 0) >= skipThreshold).length
                      : 0;
                    const activeCount = selectedProductIds.size - skippedCount;
                    const totalImages = activeCount * settings.numToGenerate;

                    return (
                      <ul className="text-sm text-gray-400 space-y-1">
                        <li>Products selected: {selectedProductIds.size}</li>
                        {skippedCount > 0 && (
                          <li className="text-yellow-400">
                            Will skip: {skippedCount} (have {skipThreshold}+ images)
                          </li>
                        )}
                        <li>Products to process: {activeCount}</li>
                        <li>Images per product: {settings.numToGenerate}</li>
                        <li>Total images: {totalImages}</li>
                        <li className="text-green-400">
                          Est. cost: ~${(activeCount * 0.04).toFixed(2)}
                        </li>
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default JobCreation;
