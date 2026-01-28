import React from 'react';
import { GenerationJob, ShopifyProduct } from '../types';

interface DashboardProps {
  jobs: GenerationJob[];
  products: ShopifyProduct[];
  storeName: string;
  onCreateJob: () => void;
  onViewJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onManageCollections: () => void;
  onDisconnect: () => void;
}

const getStatusColor = (status: GenerationJob['status']): string => {
  switch (status) {
    case 'completed':
      return 'bg-green-500';
    case 'failed':
      return 'bg-red-500';
    case 'generating_images':
    case 'analyzing_products':
      return 'bg-blue-500';
    case 'stopped':
    case 'stopping':
      return 'bg-yellow-500';
    case 'queued':
    default:
      return 'bg-gray-500';
  }
};

const getStatusText = (status: GenerationJob['status']): string => {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'generating_images':
      return 'Generating';
    case 'analyzing_products':
      return 'Analyzing';
    case 'stopped':
      return 'Stopped';
    case 'stopping':
      return 'Stopping';
    case 'queued':
    default:
      return 'Queued';
  }
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getJobProgress = (job: GenerationJob): { completed: number; total: number } => {
  const total = job.productIds.length * job.settings.numToGenerate;
  let completed = 0;

  for (const state of Object.values(job.productStates)) {
    completed += state.generatedImages.filter(
      (img) => img.status === 'success' || img.status === 'uploaded'
    ).length;
  }

  return { completed, total };
};

const Dashboard: React.FC<DashboardProps> = ({
  jobs,
  products,
  storeName,
  onCreateJob,
  onViewJob,
  onDeleteJob,
  onResumeJob,
  onManageCollections,
  onDisconnect,
}) => {
  const handleDeleteJob = (jobId: string, jobName: string) => {
    if (window.confirm(`Are you sure you want to delete "${jobName}"?`)) {
      onDeleteJob(jobId);
    }
  };

  const getProductTitle = (productId: number): string => {
    const product = products.find((p) => p.id === productId);
    return product?.title || `Product ${productId}`;
  };

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                Shopify AI Image Generator
              </h1>
              <p className="text-sm text-gray-400">
                Connected to: <span className="text-blue-400">{storeName}</span>
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={onManageCollections}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
              >
                Collections
              </button>
              <button
                onClick={onCreateJob}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                New Job
              </button>
              <button
                onClick={onDisconnect}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Total Products</p>
            <p className="text-2xl font-bold text-white">{products.length}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Total Jobs</p>
            <p className="text-2xl font-bold text-white">{jobs.length}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Completed Jobs</p>
            <p className="text-2xl font-bold text-green-400">
              {jobs.filter((j) => j.status === 'completed').length}
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <p className="text-sm text-gray-400">Active Jobs</p>
            <p className="text-2xl font-bold text-blue-400">
              {jobs.filter((j) => ['generating_images', 'analyzing_products'].includes(j.status)).length}
            </p>
          </div>
        </div>

        {/* Jobs List */}
        <div className="bg-gray-800 rounded-lg">
          <div className="p-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Generation Jobs</h2>
          </div>

          {jobs.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-400 mb-4">No jobs yet. Create your first job to get started!</p>
              <button
                onClick={onCreateJob}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Create New Job
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {jobs.map((job) => {
                const progress = getJobProgress(job);
                const progressPercent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
                const canResume = ['stopped', 'failed'].includes(job.status);

                return (
                  <div key={job.id} className="p-4 hover:bg-gray-750">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <h3 className="text-lg font-medium text-white">{job.name}</h3>
                          <span
                            className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
                              job.status
                            )} text-white`}
                          >
                            {getStatusText(job.status)}
                          </span>
                        </div>

                        <p className="text-sm text-gray-400 mt-1">
                          {job.productIds.length} product{job.productIds.length !== 1 ? 's' : ''} -{' '}
                          {formatDate(job.creationDate)}
                        </p>

                        {/* Product Preview */}
                        <div className="mt-2 text-xs text-gray-500">
                          {job.productIds.slice(0, 3).map((id) => getProductTitle(id)).join(', ')}
                          {job.productIds.length > 3 && ` +${job.productIds.length - 3} more`}
                        </div>

                        {/* Progress Bar */}
                        {['generating_images', 'analyzing_products'].includes(job.status) && (
                          <div className="mt-3">
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Progress</span>
                              <span>{progress.completed} / {progress.total}</span>
                            </div>
                            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Error Message */}
                        {job.error && (
                          <p className="mt-2 text-sm text-red-400">{job.error}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => onViewJob(job.id)}
                          className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                        >
                          View
                        </button>
                        {canResume && (
                          <button
                            onClick={() => onResumeJob(job.id)}
                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          >
                            Resume
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteJob(job.id, job.name)}
                          className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
