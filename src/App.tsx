import React, { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  AppView,
  ShopifyCredentials,
  ShopifyProduct,
  GenerationJob,
  GenerationSettings,
  ProductGenerationState,
} from './types';
import { fetchAllProducts } from './services/shopifyService';
import {
  loadJobs,
  saveJob,
  deleteJob,
  restoreInterruptedJobs,
  clearCredentials,
} from './services/supabaseService';
import ConnectionSection from './components/ConnectionSection';
import Dashboard from './components/Dashboard';
import JobCreation from './components/JobCreation';
import JobDetails from './components/JobDetails';
import CollectionManager from './components/CollectionManager';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>({ state: 'CONNECTING' });
  const [shopifyCreds, setShopifyCreds] = useState<ShopifyCredentials | null>(null);
  const [storeName, setStoreName] = useState<string>('');
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const jobsRef = useRef<GenerationJob[]>([]);
  const pendingSaves = useRef<Set<string>>(new Set());

  // Keep ref in sync so debounced saves always read the latest state
  jobsRef.current = jobs;

  // Load jobs when connected
  useEffect(() => {
    const loadInitialData = async () => {
      if (!shopifyCreds) return;

      try {
        const loadedJobs = await loadJobs(shopifyCreds.storeUrl);
        const restoredJobs = restoreInterruptedJobs(loadedJobs);
        setJobs(restoredJobs);

        // Save any restored jobs
        for (const job of restoredJobs) {
          if (job.status === 'stopped') {
            await saveJob(job);
          }
        }
      } catch {
        // Jobs will start fresh if loading fails
      }
    };

    loadInitialData();
  }, [shopifyCreds]);

  // Handle connection
  const handleConnect = useCallback(
    async (credentials: ShopifyCredentials, name: string) => {
      setShopifyCreds(credentials);
      setStoreName(name);
      setView({ state: 'LOADING', message: 'Loading products...' });

      try {
        const allProducts = await fetchAllProducts(credentials, (status) => {
          setView({ state: 'LOADING', message: status });
        });
        setProducts(allProducts);
        setView({ state: 'DASHBOARD' });
      } catch {
        setView({ state: 'CONNECTING' });
      }
    },
    []
  );

  // Handle disconnect
  const handleDisconnect = useCallback(() => {
    clearCredentials();
    setShopifyCreds(null);
    setStoreName('');
    setProducts([]);
    setJobs([]);
    setView({ state: 'CONNECTING' });
  }, []);

  // Create new job
  const handleCreateJob = useCallback(
    (name: string, productIds: number[], settings: GenerationSettings) => {
      const productStates: Record<number, ProductGenerationState> = {};

      for (const productId of productIds) {
        productStates[productId] = {
          sourceImageBase64s: null,
          analysis: null,
          generatedImages: [],
          isGenerating: false,
          isAnalyzed: false,
          error: null,
        };
      }

      const newJob: GenerationJob = {
        id: uuidv4(),
        name,
        status: 'queued',
        productIds,
        settings,
        creationDate: new Date().toISOString(),
        productStates,
        storeUrl: shopifyCreds?.storeUrl,
      };

      setJobs((prev) => [newJob, ...prev]);
      saveJob(newJob);
      setView({ state: 'VIEWING_JOB', jobId: newJob.id });
    },
    [shopifyCreds]
  );

  // Update job with debounced persistence.
  // Uses jobsRef to always read the latest state when the debounce fires,
  // avoiding stale closure bugs.
  const handleUpdateJob = useCallback(
    (jobId: string, updater: (job: GenerationJob) => GenerationJob) => {
      setJobs((prevJobs) =>
        prevJobs.map((j) => (j.id === jobId ? updater(j) : j))
      );

      if (!pendingSaves.current.has(jobId)) {
        pendingSaves.current.add(jobId);
        setTimeout(() => {
          const jobToSave = jobsRef.current.find((j) => j.id === jobId);
          if (jobToSave) {
            saveJob(jobToSave);
          }
          pendingSaves.current.delete(jobId);
        }, 1000);
      }
    },
    []
  );

  // Delete job
  const handleDeleteJob = useCallback(async (jobId: string) => {
    await deleteJob(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  // Resume job
  const handleResumeJob = useCallback((jobId: string) => {
    setView({ state: 'VIEWING_JOB', jobId });
  }, []);

  // Get current job
  const getCurrentJob = (): GenerationJob | undefined => {
    if (view.state === 'VIEWING_JOB') {
      return jobs.find((j) => j.id === view.jobId);
    }
    return undefined;
  };

  // Render based on view state
  const renderView = () => {
    switch (view.state) {
      case 'CONNECTING':
        return <ConnectionSection onConnect={handleConnect} />;

      case 'LOADING':
        return (
          <div className="min-h-screen bg-gray-900 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4" />
              <p className="text-white">{view.message}</p>
            </div>
          </div>
        );

      case 'DASHBOARD':
        return (
          <Dashboard
            jobs={jobs}
            products={products}
            storeName={storeName}
            onCreateJob={() => setView({ state: 'CREATING_JOB' })}
            onViewJob={(jobId) => setView({ state: 'VIEWING_JOB', jobId })}
            onDeleteJob={handleDeleteJob}
            onResumeJob={handleResumeJob}
            onManageCollections={() => setView({ state: 'COLLECTION_MANAGER' })}
            onDisconnect={handleDisconnect}
          />
        );

      case 'CREATING_JOB':
        return (
          <JobCreation
            products={products}
            onCreateJob={handleCreateJob}
            onCancel={() => setView({ state: 'DASHBOARD' })}
          />
        );

      case 'VIEWING_JOB': {
        const job = getCurrentJob();
        if (!job || !shopifyCreds) {
          return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
              <div className="text-center">
                <p className="text-white mb-4">Job not found</p>
                <button
                  onClick={() => setView({ state: 'DASHBOARD' })}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg"
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          );
        }

        return (
          <JobDetails
            job={job}
            products={products}
            credentials={shopifyCreds}
            onUpdateJob={(updater) => handleUpdateJob(job.id, updater)}
            onBack={() => setView({ state: 'DASHBOARD' })}
          />
        );
      }

      case 'COLLECTION_MANAGER':
        if (!shopifyCreds) {
          return (
            <div className="min-h-screen bg-gray-900 flex items-center justify-center">
              <p className="text-white">Not connected</p>
            </div>
          );
        }

        return (
          <CollectionManager
            credentials={shopifyCreds}
            onBack={() => setView({ state: 'DASHBOARD' })}
          />
        );

      default:
        return null;
    }
  };

  return <div className="min-h-screen bg-gray-900">{renderView()}</div>;
};

export default App;
