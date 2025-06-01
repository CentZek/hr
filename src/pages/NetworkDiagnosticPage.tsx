import React from 'react';
import NetworkDiagnosticTool from '../components/NetworkDiagnosticTool';

const NetworkDiagnosticPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold text-gray-900">Network Diagnostic</h1>
          <p className="mt-2 text-lg text-gray-600">
            Troubleshoot Supabase connection issues
          </p>
        </div>
        
        <NetworkDiagnosticTool />
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>
            If you continue to experience connection issues, please contact your system administrator
            or check the Supabase status page.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NetworkDiagnosticPage;