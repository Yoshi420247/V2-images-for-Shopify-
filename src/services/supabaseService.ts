import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GenerationJob, GeneratedImage, ProductGenerationState } from '../types';
import { STORAGE_KEYS } from '../constants';

// ============================================
// Client Initialization
// ============================================

let supabaseClient: SupabaseClient | null = null;

const getSupabaseClient = (): SupabaseClient | null => {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.warn('Supabase not configured - falling back to localStorage only');
    return null;
  }

  supabaseClient = createClient(url, anonKey);
  return supabaseClient;
};

/**
 * Check if Supabase is available
 */
export const isSupabaseConfigured = (): boolean => {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_ANON_KEY;
};

// ============================================
// Local Storage Helpers
// ============================================

/**
 * Save jobs to localStorage as backup
 */
const saveJobsToLocalStorage = (jobs: GenerationJob[]): void => {
  try {
    // Strip base64 data before saving to localStorage
    const cleanJobs = jobs.map((job) => ({
      ...job,
      productStates: Object.fromEntries(
        Object.entries(job.productStates).map(([productId, state]) => [
          productId,
          {
            ...state,
            sourceImageBase64s: null,
            generatedImages: state.generatedImages.map((img) => ({
              ...img,
              base64: '',
            })),
          },
        ])
      ),
    }));

    localStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(cleanJobs));
  } catch (error) {
    console.error('Failed to save jobs to localStorage:', error);
  }
};

/**
 * Load jobs from localStorage
 */
const loadJobsFromLocalStorage = (): GenerationJob[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.JOBS);
    if (!stored) return [];

    return JSON.parse(stored) as GenerationJob[];
  } catch (error) {
    console.error('Failed to load jobs from localStorage:', error);
    return [];
  }
};

// ============================================
// Image Storage
// ============================================

/**
 * Upload an image to Supabase Storage
 */
export const uploadImage = async (
  jobId: string,
  productId: number,
  imageId: string,
  base64Data: string
): Promise<string | null> => {
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    // Remove data URL prefix and determine format
    let cleanBase64 = base64Data;
    let mimeType = 'image/png';

    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        cleanBase64 = match[2];
      }
    }

    const extension = mimeType.split('/')[1] || 'png';
    const filePath = `${jobId}/${productId}/${imageId}.${extension}`;

    // Convert base64 to Blob
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    // Upload to storage
    const { error: uploadError } = await client.storage
      .from('generated-images')
      .upload(filePath, blob, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return null;
    }

    // Get public URL
    const { data: urlData } = client.storage
      .from('generated-images')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Failed to upload image:', error);
    return null;
  }
};

/**
 * Delete images for a job
 */
export const deleteJobImages = async (jobId: string): Promise<void> => {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    // List all files in the job folder
    const { data: files, error: listError } = await client.storage
      .from('generated-images')
      .list(jobId);

    if (listError || !files) {
      console.error('Failed to list job images:', listError);
      return;
    }

    // Recursively delete all files
    const filePaths = files.map((file) => `${jobId}/${file.name}`);

    if (filePaths.length > 0) {
      await client.storage.from('generated-images').remove(filePaths);
    }
  } catch (error) {
    console.error('Failed to delete job images:', error);
  }
};

// ============================================
// Job Persistence
// ============================================

/**
 * Convert job to database format
 */
const jobToDbFormat = (job: GenerationJob): Record<string, unknown> => {
  // Strip base64 data from generated images
  const cleanProductStates: Record<string, ProductGenerationState> = {};

  for (const [productId, state] of Object.entries(job.productStates)) {
    cleanProductStates[productId] = {
      ...state,
      sourceImageBase64s: null,
      generatedImages: state.generatedImages.map((img) => ({
        ...img,
        base64: '',
      })),
    };
  }

  return {
    id: job.id,
    name: job.name,
    status: job.status,
    product_ids: job.productIds,
    settings: job.settings,
    creation_date: job.creationDate,
    product_states: cleanProductStates,
    error: job.error || null,
    store_url: job.storeUrl || null,
  };
};

/**
 * Convert database record to job format
 */
const dbToJobFormat = (record: Record<string, unknown>): GenerationJob => {
  return {
    id: record.id as string,
    name: record.name as string,
    status: record.status as GenerationJob['status'],
    productIds: record.product_ids as number[],
    settings: record.settings as GenerationJob['settings'],
    creationDate: record.creation_date as string,
    productStates: record.product_states as Record<number, ProductGenerationState>,
    error: record.error as string | undefined,
    storeUrl: record.store_url as string | undefined,
  };
};

/**
 * Save a job to the database
 */
export const saveJob = async (job: GenerationJob): Promise<boolean> => {
  // Always save to localStorage as backup
  const existingJobs = loadJobsFromLocalStorage();
  const updatedJobs = existingJobs.filter((j) => j.id !== job.id);
  updatedJobs.push(job);
  saveJobsToLocalStorage(updatedJobs);

  // Try to save to Supabase
  const client = getSupabaseClient();
  if (!client) return true; // localStorage save succeeded

  try {
    const dbRecord = jobToDbFormat(job);

    const { error } = await client.from('jobs').upsert(dbRecord, {
      onConflict: 'id',
    });

    if (error) {
      console.error('Supabase save error:', error);
      return true; // localStorage backup still succeeded
    }

    return true;
  } catch (error) {
    console.error('Failed to save job to Supabase:', error);
    return true; // localStorage backup still succeeded
  }
};

/**
 * Persist a generated image and update the job
 */
export const persistGeneratedImage = async (
  job: GenerationJob,
  productId: number,
  image: GeneratedImage
): Promise<{ job: GenerationJob; imageUrl: string | null }> => {
  // Upload image to storage
  const imageUrl = await uploadImage(job.id, productId, image.id, image.base64);

  // Update the image with the URL and clear base64
  const updatedImage: GeneratedImage = {
    ...image,
    imageUrl: imageUrl || undefined,
    base64: '', // Clear base64 after persistence
  };

  // Update the job
  const updatedJob: GenerationJob = {
    ...job,
    productStates: {
      ...job.productStates,
      [productId]: {
        ...job.productStates[productId],
        generatedImages: job.productStates[productId].generatedImages.map((img) =>
          img.id === image.id ? updatedImage : img
        ),
      },
    },
  };

  // Save the updated job
  await saveJob(updatedJob);

  return { job: updatedJob, imageUrl };
};

/**
 * Load all jobs from storage
 */
export const loadJobs = async (storeUrl?: string): Promise<GenerationJob[]> => {
  const localJobs = loadJobsFromLocalStorage();

  const client = getSupabaseClient();
  if (!client) {
    // Return localStorage jobs, optionally filtered by store
    if (storeUrl) {
      return localJobs.filter((j) => j.storeUrl === storeUrl);
    }
    return localJobs;
  }

  try {
    let query = client.from('jobs').select('*').order('creation_date', { ascending: false });

    if (storeUrl) {
      query = query.eq('store_url', storeUrl);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to load jobs from Supabase:', error);
      return localJobs;
    }

    if (!data || data.length === 0) {
      return localJobs;
    }

    // Convert database records to job format
    const supabaseJobs = data.map(dbToJobFormat);

    // Merge with localStorage jobs (Supabase takes precedence)
    const jobMap = new Map<string, GenerationJob>();

    for (const job of localJobs) {
      jobMap.set(job.id, job);
    }

    for (const job of supabaseJobs) {
      jobMap.set(job.id, job);
    }

    return Array.from(jobMap.values()).sort(
      (a, b) => new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime()
    );
  } catch (error) {
    console.error('Failed to load jobs:', error);
    return localJobs;
  }
};

/**
 * Delete a job from storage
 */
export const deleteJob = async (jobId: string): Promise<boolean> => {
  // Remove from localStorage
  const localJobs = loadJobsFromLocalStorage();
  const filteredJobs = localJobs.filter((j) => j.id !== jobId);
  saveJobsToLocalStorage(filteredJobs);

  // Delete images from storage
  await deleteJobImages(jobId);

  // Delete from Supabase
  const client = getSupabaseClient();
  if (!client) return true;

  try {
    const { error } = await client.from('jobs').delete().eq('id', jobId);

    if (error) {
      console.error('Failed to delete job from Supabase:', error);
      return true; // localStorage delete succeeded
    }

    return true;
  } catch (error) {
    console.error('Failed to delete job:', error);
    return true;
  }
};

/**
 * Restore interrupted jobs to stopped status
 */
export const restoreInterruptedJobs = (jobs: GenerationJob[]): GenerationJob[] => {
  return jobs.map((job) => {
    const isInterrupted = ['generating_images', 'analyzing_products', 'stopping'].includes(
      job.status
    );

    if (!isInterrupted) return job;

    return {
      ...job,
      status: 'stopped' as const,
      productStates: Object.fromEntries(
        Object.entries(job.productStates).map(([productId, state]) => [
          productId,
          {
            ...state,
            sourceImageBase64s: null,
            isGenerating: false,
          },
        ])
      ),
    };
  });
};

// ============================================
// Credentials Storage
// ============================================

/**
 * Save Shopify credentials to localStorage
 */
export const saveCredentials = (credentials: {
  storeUrl: string;
  accessToken: string;
  proxyUrl: string;
}): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.SHOPIFY_CREDENTIALS, JSON.stringify(credentials));
  } catch (error) {
    console.error('Failed to save credentials:', error);
  }
};

/**
 * Load Shopify credentials from localStorage
 */
export const loadCredentials = (): {
  storeUrl: string;
  accessToken: string;
  proxyUrl: string;
} | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SHOPIFY_CREDENTIALS);
    if (!stored) return null;

    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load credentials:', error);
    return null;
  }
};

/**
 * Clear stored credentials
 */
export const clearCredentials = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEYS.SHOPIFY_CREDENTIALS);
  } catch (error) {
    console.error('Failed to clear credentials:', error);
  }
};

// ============================================
// Generation Settings Storage
// ============================================

/**
 * Save generation settings to localStorage
 */
export const saveGenerationSettings = (settings: Record<string, unknown>): void => {
  try {
    localStorage.setItem(STORAGE_KEYS.GENERATION_SETTINGS, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save generation settings:', error);
  }
};

/**
 * Load generation settings from localStorage
 */
export const loadGenerationSettings = (): Record<string, unknown> | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.GENERATION_SETTINGS);
    if (!stored) return null;

    return JSON.parse(stored);
  } catch (error) {
    console.error('Failed to load generation settings:', error);
    return null;
  }
};
