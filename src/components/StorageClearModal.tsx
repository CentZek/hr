import React, { useState } from 'react';
import { Trash2, AlertTriangle, X, RefreshCw, Info } from 'lucide-react';

interface StorageClearModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClear: () => void;
}

const StorageClearModal: React.FC<StorageClearModalProps> = ({ 
  isOpen, 
  onClose,
  onClear 
}) => {
  const [isClearingData, setIsClearingData] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  if (!isOpen) return null;

  const handleClearStorage = () => {
    if (confirmText !== 'CLEAR') {
      alert('Please type CLEAR to confirm');
      return;
    }

    setIsClearingData(true);
    
    // Slight delay to show the loading state
    setTimeout(() => {
      try {
        // Clear browser storage
        onClear();
        
        // Close modal and show success
        setIsClearingData(false);
        onClose();
        
        // Force page reload after a small delay
        setTimeout(() => {
          window.location.reload();
        }, 500);
      } catch (error) {
        console.error('Error clearing storage:', error);
        setIsClearingData(false);
        alert('There was an error clearing storage. Please try again.');
      }
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-red-600 p-4 flex items-center">
          <Trash2 className="w-6 h-6 text-white mr-2" />
          <h3 className="text-lg font-medium text-white">Clear Browser Data</h3>
          <button onClick={onClose} className="ml-auto text-white hover:text-red-100" disabled={isClearingData}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6">
          <div className="bg-amber-50 border border-amber-100 rounded-md p-4 mb-4 flex items-start">
            <AlertTriangle className="w-5 h-5 text-amber-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-1">This will clear all locally stored data</p>
              <p>This action will clear all data stored in your browser for this application. Use this if you're experiencing issues with the application not loading properly.</p>
              <p className="mt-2">After clearing, the application will reload with a clean state.</p>
            </div>
          </div>
          
          <div className="bg-blue-50 border border-blue-100 rounded-md p-4 mb-4 flex items-start">
            <Info className="w-5 h-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Firefox-specific issue</p>
              <p>This can help fix issues specifically in Firefox browsers where some application pages don't load correctly due to storage or caching problems.</p>
            </div>
          </div>
          
          <div className="text-sm text-gray-600 mb-4">Please type <strong>CLEAR</strong> to confirm:</div>
          
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            placeholder="Type CLEAR to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={isClearingData}
            >
              Cancel
            </button>
            <button
              onClick={handleClearStorage}
              disabled={isClearingData || confirmText !== 'CLEAR'}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isClearingData ? (
                <>
                  <RefreshCw className="inline-block w-4 h-4 mr-2 animate-spin" />
                  Clearing...
                </>
              ) : (
                <>
                  <Trash2 className="inline-block w-4 h-4 mr-2" />
                  Clear Browser Data
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StorageClearModal;