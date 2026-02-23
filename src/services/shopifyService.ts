import {
  ShopifyCredentials,
  ShopifyProduct,
  ShopifyCollection,
  ShopifyImage,
  SetStatusCallback,
} from '../types';
import { SHOPIFY_API_VERSION, CORS_PROXY_URL } from '../constants';

/**
 * Parse the Link header to extract the next page URL
 */
const parseNextPageUrl = (linkHeader: string | null): string | null => {
  if (!linkHeader) return null;

  const links = linkHeader.split(',');
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) {
      return match[1];
    }
  }
  return null;
};

/**
 * Make a request to the Shopify Admin API through the CORS proxy
 */
const shopifyApiRequest = async <T>(
  endpoint: string,
  creds: ShopifyCredentials,
  options: RequestInit = {}
): Promise<{ data: T; headers: Headers }> => {
  const targetUrl = `https://${creds.storeUrl}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
  const proxyUrl = creds.proxyUrl || CORS_PROXY_URL;
  const url = `${proxyUrl}?url=${encodeURIComponent(targetUrl)}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': creds.accessToken,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { data: data as T, headers: response.headers };
};

/**
 * Make a paginated request using an absolute URL (for pagination)
 */
const shopifyPaginatedRequest = async <T>(
  absoluteUrl: string,
  creds: ShopifyCredentials
): Promise<{ data: T; headers: Headers }> => {
  const proxyUrl = creds.proxyUrl || CORS_PROXY_URL;
  const url = `${proxyUrl}?url=${encodeURIComponent(absoluteUrl)}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': creds.accessToken,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Shopify API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { data: data as T, headers: response.headers };
};

/**
 * Test connection to Shopify store
 */
export const testConnection = async (
  creds: ShopifyCredentials
): Promise<{ success: boolean; storeName?: string; error?: string }> => {
  try {
    const { data } = await shopifyApiRequest<{ shop: { name: string } }>(
      'shop.json',
      creds
    );
    return { success: true, storeName: data.shop.name };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
};

/**
 * Fetch all products from the Shopify store with pagination
 */
export const fetchAllProducts = async (
  creds: ShopifyCredentials,
  setStatus?: SetStatusCallback
): Promise<ShopifyProduct[]> => {
  const allProducts: ShopifyProduct[] = [];
  let pageCount = 0;

  const fields = 'id,title,images,product_type,body_html,vendor,status,handle,tags';
  const { data: firstPageData, headers: firstPageHeaders } = await shopifyApiRequest<{
    products: ShopifyProduct[];
  }>(`products.json?limit=250&fields=${fields}`, creds);

  allProducts.push(...firstPageData.products);
  pageCount++;
  setStatus?.(`Loaded ${allProducts.length} products (page ${pageCount})...`);

  let nextPageUrl = parseNextPageUrl(firstPageHeaders.get('Link'));

  while (nextPageUrl) {
    const { data, headers } = await shopifyPaginatedRequest<{
      products: ShopifyProduct[];
    }>(nextPageUrl, creds);

    allProducts.push(...data.products);
    pageCount++;
    setStatus?.(`Loaded ${allProducts.length} products (page ${pageCount})...`);

    nextPageUrl = parseNextPageUrl(headers.get('Link'));
  }

  setStatus?.(`Loaded all ${allProducts.length} products`);
  return allProducts;
};

/**
 * Fetch a single product by ID
 */
export const fetchProduct = async (
  productId: number,
  creds: ShopifyCredentials
): Promise<ShopifyProduct> => {
  const { data } = await shopifyApiRequest<{ product: ShopifyProduct }>(
    `products/${productId}.json`,
    creds
  );
  return data.product;
};

/**
 * Upload an image to a product
 */
export const uploadImage = async (
  productId: number,
  imageBase64: string,
  creds: ShopifyCredentials,
  position?: number,
  alt?: string
): Promise<ShopifyImage> => {
  // Remove data URL prefix if present
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const payload: {
    image: {
      attachment: string;
      position?: number;
      alt?: string;
    };
  } = {
    image: {
      attachment: base64Data,
    },
  };

  if (position !== undefined) {
    payload.image.position = position;
  }

  if (alt) {
    payload.image.alt = alt;
  }

  const { data } = await shopifyApiRequest<{ image: ShopifyImage }>(
    `products/${productId}/images.json`,
    creds,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

  return data.image;
};

/**
 * Delete an image from a product
 */
export const deleteImage = async (
  productId: number,
  imageId: number,
  creds: ShopifyCredentials
): Promise<void> => {
  await shopifyApiRequest(
    `products/${productId}/images/${imageId}.json`,
    creds,
    {
      method: 'DELETE',
    }
  );
};

/**
 * Delete all images from a product
 */
export const deleteAllProductImages = async (
  productId: number,
  creds: ShopifyCredentials
): Promise<void> => {
  const product = await fetchProduct(productId, creds);

  for (const image of product.images) {
    await deleteImage(productId, image.id, creds);
  }
};

/**
 * Fetch all collections (both custom and smart)
 */
export const fetchAllCollections = async (
  creds: ShopifyCredentials,
  setStatus?: SetStatusCallback
): Promise<ShopifyCollection[]> => {
  const allCollections: ShopifyCollection[] = [];

  // Fetch custom collections
  setStatus?.('Loading custom collections...');
  let nextPageUrl: string | null = null;

  const { data: customData, headers: customHeaders } = await shopifyApiRequest<{
    custom_collections: Array<Omit<ShopifyCollection, 'collection_type'>>;
  }>('custom_collections.json?limit=250', creds);

  const customCollections = customData.custom_collections.map(c => ({
    ...c,
    collection_type: 'custom' as const,
  }));
  allCollections.push(...customCollections);

  nextPageUrl = parseNextPageUrl(customHeaders.get('Link'));
  while (nextPageUrl) {
    const { data, headers } = await shopifyPaginatedRequest<{
      custom_collections: Array<Omit<ShopifyCollection, 'collection_type'>>;
    }>(nextPageUrl, creds);

    allCollections.push(
      ...data.custom_collections.map(c => ({
        ...c,
        collection_type: 'custom' as const,
      }))
    );
    nextPageUrl = parseNextPageUrl(headers.get('Link'));
  }

  // Fetch smart collections
  setStatus?.('Loading smart collections...');

  const { data: smartData, headers: smartHeaders } = await shopifyApiRequest<{
    smart_collections: Array<Omit<ShopifyCollection, 'collection_type'>>;
  }>('smart_collections.json?limit=250', creds);

  const smartCollections = smartData.smart_collections.map(c => ({
    ...c,
    collection_type: 'smart' as const,
  }));
  allCollections.push(...smartCollections);

  nextPageUrl = parseNextPageUrl(smartHeaders.get('Link'));
  while (nextPageUrl) {
    const { data, headers } = await shopifyPaginatedRequest<{
      smart_collections: Array<Omit<ShopifyCollection, 'collection_type'>>;
    }>(nextPageUrl, creds);

    allCollections.push(
      ...data.smart_collections.map(c => ({
        ...c,
        collection_type: 'smart' as const,
      }))
    );
    nextPageUrl = parseNextPageUrl(headers.get('Link'));
  }

  setStatus?.(`Loaded ${allCollections.length} collections`);
  return allCollections;
};

/**
 * Fetch products in a collection
 */
export const fetchCollectionProducts = async (
  collectionId: number,
  creds: ShopifyCredentials,
  limit: number = 10
): Promise<ShopifyProduct[]> => {
  const { data } = await shopifyApiRequest<{ products: ShopifyProduct[] }>(
    `collections/${collectionId}/products.json?limit=${limit}`,
    creds
  );
  return data.products;
};

/**
 * Update a collection's image
 */
export const updateCollectionImage = async (
  collection: ShopifyCollection,
  imageBase64: string,
  creds: ShopifyCredentials
): Promise<ShopifyImage> => {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const collectionType =
    collection.collection_type === 'smart' ? 'smart_collections' : 'custom_collections';

  const { data } = await shopifyApiRequest<{
    custom_collection?: { image: ShopifyImage };
    smart_collection?: { image: ShopifyImage };
  }>(
    `${collectionType}/${collection.id}.json`,
    creds,
    {
      method: 'PUT',
      body: JSON.stringify({
        [collection.collection_type === 'smart'
          ? 'smart_collection'
          : 'custom_collection']: {
          id: collection.id,
          image: {
            attachment: base64Data,
          },
        },
      }),
    }
  );

  const returnedCollection = data.custom_collection || data.smart_collection;
  if (!returnedCollection?.image) {
    throw new Error('No image returned from collection update');
  }

  return returnedCollection.image;
};

/**
 * Fetch image as base64 through CORS proxy
 */
export const fetchImageAsBase64 = async (
  imageUrl: string,
  creds: ShopifyCredentials
): Promise<string> => {
  const proxyUrl = creds.proxyUrl || CORS_PROXY_URL;
  const url = `${proxyUrl}?url=${encodeURIComponent(imageUrl)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Fetch multiple images as base64
 */
export const fetchProductImagesAsBase64 = async (
  product: ShopifyProduct,
  creds: ShopifyCredentials,
  maxImages: number = 3
): Promise<string[]> => {
  const imagesToFetch = product.images.slice(0, maxImages);
  const base64Images: string[] = [];

  for (const image of imagesToFetch) {
    try {
      const base64 = await fetchImageAsBase64(image.src, creds);
      base64Images.push(base64);
    } catch {
      // Skip images that fail to fetch
    }
  }

  return base64Images;
};
