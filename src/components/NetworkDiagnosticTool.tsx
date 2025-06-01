import React, { useState, useEffect } from 'react';
import { diagnoseSupabaseConnection } from '../lib/supabase';

const NetworkDiagnosticTool: React.FC = () => {
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const results = await diagnoseSupabaseConnection();
      setDiagnosticResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Run diagnostics on component mount
    runDiagnostics();
  }, []);

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-3xl mx-auto my-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">Network Diagnostic Tool</h2>
      
      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Running diagnostics...</span>
        </div>
      )}
      
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
      )}
      
      {diagnosticResults && !loading && (
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-md p-4">
            <h3 className="font-medium text-gray-700 mb-2">Direct Fetch Test</h3>
            {diagnosticResults.directFetch ? (
              <div>
                <p className="mb-1">
                  <span className="font-semibold">Success:</span>{' '}
                  {diagnosticResults.directFetch.success ? (
                    <span className="text-green-600">Yes</span>
                  ) : (
                    <span className="text-red-600">No</span>
                  )}
                </p>
                {diagnosticResults.directFetch.status && (
                  <p className="mb-1">
                    <span className="font-semibold">Status:</span> {diagnosticResults.directFetch.status} {diagnosticResults.directFetch.statusText}
                  </p>
                )}
                {diagnosticResults.directFetch.error && (
                  <p className="text-red-600 mb-1">
                    <span className="font-semibold">Error:</span> {diagnosticResults.directFetch.error}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-yellow-600">No direct fetch data available</p>
            )}
          </div>
          
          <div className="border border-gray-200 rounded-md p-4">
            <h3 className="font-medium text-gray-700 mb-2">Supabase Client Connection</h3>
            {diagnosticResults.clientConnection ? (
              <div>
                <p className="mb-1">
                  <span className="font-semibold">Connected:</span>{' '}
                  {diagnosticResults.clientConnection.connected ? (
                    <span className="text-green-600">Yes</span>
                  ) : (
                    <span className="text-red-600">No</span>
                  )}
                </p>
                {diagnosticResults.clientConnection.error && (
                  <p className="text-red-600 mb-1">
                    <span className="font-semibold">Error:</span> {diagnosticResults.clientConnection.error}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-yellow-600">No client connection data available</p>
            )}
          </div>
          
          <div className="mt-4 bg-blue-50 p-4 rounded-md">
            <h3 className="font-medium text-blue-800 mb-2">Troubleshooting Tips</h3>
            <ul className="list-disc pl-5 text-blue-700 space-y-1">
              <li>Check if your network blocks outgoing connections to Supabase endpoints</li>
              <li>Verify that your Supabase project is active and available</li>
              <li>Ensure your environment variables are correct in the .env file</li>
              <li>Try accessing the Supabase API from a different network</li>
              <li>Disable any VPN or proxy services that might interfere with the connection</li>
              <li>Check if your browser is blocking the connections (try in incognito mode)</li>
            </ul>
          </div>
        </div>
      )}
      
      <div className="mt-6 flex justify-center">
        <button
          onClick={runDiagnostics}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded-md disabled:opacity-50"
        >
          {loading ? 'Running...' : 'Run Diagnostics Again'}
        </button>
      </div>
    </div>
  );
};

export default NetworkDiagnosticTool;