import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface StorageErrorBannerProps {
  error: string;
  onRetry?: () => void;
}

const StorageErrorBanner: React.FC<StorageErrorBannerProps> = ({ 
  error, 
  onRetry 
}) => {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
      <div className="flex items-start">
        <AlertTriangle className="w-5 h-5 text-amber-500 mr-3 mt-0.5 flex-shrink-0" />
        <div className="flex-grow">
          <p className="text-sm text-amber-800 font-medium">Storage Issue Detected</p>
          <p className="text-sm text-amber-700 mt-1">{error}</p>
          <p className="text-sm text-amber-700 mt-1">
            Your changes may not be saved properly. Try using a different browser or enabling cookies.
          </p>
          {onRetry && (
            <button 
              onClick={onRetry}
              className="mt-2 inline-flex items-center px-3 py-1.5 text-xs rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StorageErrorBanner;