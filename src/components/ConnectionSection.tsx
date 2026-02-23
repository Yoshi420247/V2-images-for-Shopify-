import React, { useState, useEffect } from 'react';
import { ShopifyCredentials } from '../types';
import { CORS_PROXY_URL } from '../constants';
import { testConnection } from '../services/shopifyService';
import {
  loadCredentials,
  saveCredentials,
  loadSupabaseConfig,
  saveSupabaseConfig,
  testSupabaseConnection,
} from '../services/supabaseService';
import { checkApiConfiguration } from '../services/geminiService';

interface ConnectionSectionProps {
  onConnect: (credentials: ShopifyCredentials, storeName: string) => void;
}

const ConnectionSection: React.FC<ConnectionSectionProps> = ({ onConnect }) => {
  const [storeUrl, setStoreUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [proxyUrl, setProxyUrl] = useState(CORS_PROXY_URL);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Supabase config state
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [supabaseStatus, setSupabaseStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [supabaseMessage, setSupabaseMessage] = useState('');

  const apiConfig = checkApiConfiguration();

  // Load saved credentials on mount
  useEffect(() => {
    const saved = loadCredentials();
    if (saved) {
      setStoreUrl(saved.storeUrl);
      setAccessToken(saved.accessToken);
      if (saved.proxyUrl) {
        setProxyUrl(saved.proxyUrl);
      }
    }

    const savedSupabase = loadSupabaseConfig();
    if (savedSupabase) {
      setSupabaseUrl(savedSupabase.url);
      setSupabaseAnonKey(savedSupabase.anonKey);
      setSupabaseStatus('success');
      setSupabaseMessage('Configured');
    }
  }, []);

  const handleTestSupabase = async () => {
    if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
      setSupabaseStatus('error');
      setSupabaseMessage('Both URL and anon key are required');
      return;
    }

    setSupabaseStatus('testing');
    setSupabaseMessage('Testing connection...');

    // Save first so the client can initialize
    saveSupabaseConfig({ url: supabaseUrl.trim(), anonKey: supabaseAnonKey.trim() });

    const result = await testSupabaseConnection();

    if (result.connected && result.bucketOk && result.tableOk) {
      setSupabaseStatus('success');
      setSupabaseMessage('Connected! Bucket and table verified.');
    } else if (result.connected) {
      setSupabaseStatus('error');
      setSupabaseMessage(result.error || 'Bucket or table missing');
    } else {
      setSupabaseStatus('error');
      setSupabaseMessage(result.error || 'Connection failed');
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      // Validate inputs
      if (!storeUrl.trim()) {
        throw new Error('Store URL is required');
      }
      if (!accessToken.trim()) {
        throw new Error('Access token is required');
      }

      // Clean up store URL
      let cleanStoreUrl = storeUrl.trim();
      cleanStoreUrl = cleanStoreUrl.replace(/^https?:\/\//, '');
      cleanStoreUrl = cleanStoreUrl.replace(/\/$/, '');

      const credentials: ShopifyCredentials = {
        storeUrl: cleanStoreUrl,
        accessToken: accessToken.trim(),
        proxyUrl: proxyUrl.trim(),
      };

      // Test connection
      const result = await testConnection(credentials);

      if (!result.success) {
        throw new Error(result.error || 'Failed to connect to Shopify');
      }

      // Save credentials
      saveCredentials(credentials);

      // Save Supabase config if provided
      if (supabaseUrl.trim() && supabaseAnonKey.trim()) {
        saveSupabaseConfig({ url: supabaseUrl.trim(), anonKey: supabaseAnonKey.trim() });
      }

      // Notify parent
      onConnect(credentials, result.storeName || cleanStoreUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-gray-800 rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">
              Shopify AI Image Generator
            </h1>
            <p className="text-gray-400">
              Generate professional product images with AI
            </p>
          </div>

          {/* API Configuration Status */}
          <div className="mb-6 p-4 bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              API Configuration
            </h3>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">OpenAI API</span>
                <span
                  className={`text-sm ${
                    apiConfig.openai ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {apiConfig.openai ? 'Configured' : 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Gemini API</span>
                <span
                  className={`text-sm ${
                    apiConfig.gemini ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {apiConfig.gemini ? 'Configured' : 'Not configured'}
                </span>
              </div>
            </div>
            {!apiConfig.allConfigured && (
              <p className="mt-2 text-xs text-yellow-400">
                Configure API keys in environment variables to enable image generation
              </p>
            )}
          </div>

          {/* Supabase Configuration */}
          <div className="mb-6 p-4 bg-gray-700 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              Image Persistence (Supabase)
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Connect Supabase to persist images across sessions. Without this, images only survive refresh via local browser storage.
            </p>
            <div className="space-y-2">
              <input
                type="text"
                value={supabaseUrl}
                onChange={(e) => { setSupabaseUrl(e.target.value); setSupabaseStatus('idle'); }}
                placeholder="https://your-project.supabase.co"
                className="w-full px-3 py-1.5 text-sm bg-gray-600 border border-gray-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                value={supabaseAnonKey}
                onChange={(e) => { setSupabaseAnonKey(e.target.value); setSupabaseStatus('idle'); }}
                placeholder="Supabase anon key (eyJ...)"
                className="w-full px-3 py-1.5 text-sm bg-gray-600 border border-gray-500 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestSupabase}
                  disabled={supabaseStatus === 'testing'}
                  className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                >
                  {supabaseStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                {supabaseStatus === 'success' && (
                  <span className="text-xs text-green-400">{supabaseMessage}</span>
                )}
                {supabaseStatus === 'error' && (
                  <span className="text-xs text-red-400">{supabaseMessage}</span>
                )}
              </div>
            </div>
            {supabaseStatus === 'error' && supabaseMessage.includes('bucket') && (
              <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-gray-300">
                <p className="font-medium mb-1">Setup Instructions:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-400">
                  <li>Go to Supabase Dashboard &gt; Storage</li>
                  <li>Create bucket named <code className="text-blue-400">generated-images</code></li>
                  <li>Set bucket to <strong>Public</strong></li>
                  <li>Add a Storage policy: allow all operations for anon role</li>
                </ol>
              </div>
            )}
            {supabaseStatus === 'error' && supabaseMessage.includes('table') && (
              <div className="mt-2 p-2 bg-gray-800 rounded text-xs text-gray-300">
                <p className="font-medium mb-1">Run this SQL in Supabase SQL Editor:</p>
                <pre className="mt-1 p-2 bg-gray-900 rounded text-green-400 overflow-x-auto text-[10px]">{`CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  product_ids JSONB,
  settings JSONB,
  creation_date TIMESTAMPTZ,
  product_states JSONB,
  error TEXT,
  store_url TEXT
);`}</pre>
              </div>
            )}
          </div>

          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label
                htmlFor="storeUrl"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Store URL
              </label>
              <input
                id="storeUrl"
                type="text"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder="your-store.myshopify.com"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isConnecting}
              />
            </div>

            <div>
              <label
                htmlFor="accessToken"
                className="block text-sm font-medium text-gray-300 mb-1"
              >
                Admin API Access Token
              </label>
              <input
                id="accessToken"
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="shpat_xxxxxxxxxxxxx"
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isConnecting}
              />
              <p className="mt-1 text-xs text-gray-400">
                Create a private app in your Shopify admin to get this token
              </p>
            </div>

            {/* Advanced Options */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                {showAdvanced ? 'Hide' : 'Show'} advanced options
              </button>

              {showAdvanced && (
                <div className="mt-2">
                  <label
                    htmlFor="proxyUrl"
                    className="block text-sm font-medium text-gray-300 mb-1"
                  >
                    CORS Proxy URL
                  </label>
                  <input
                    id="proxyUrl"
                    type="text"
                    value={proxyUrl}
                    onChange={(e) => setProxyUrl(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isConnecting}
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isConnecting}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center"
            >
              {isConnecting ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Connecting...
                </>
              ) : (
                'Connect to Shopify'
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              Your credentials are stored locally and never sent to any third-party servers
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionSection;
