import React from 'react';
import { FileSpreadsheet, Upload, PlusCircle } from 'lucide-react';

interface EmptyStateProps {
  hasUploadedFile: boolean;
  onUploadClick: () => void;
  onManualEntryClick: () => void;
}

const EmptyState: React.FC<EmptyStateProps> = ({ hasUploadedFile, onUploadClick, onManualEntryClick }) => {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-md p-8">
      {!hasUploadedFile ? (
        <div className="text-center py-6">
          <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <FileSpreadsheet className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-base font-medium text-gray-700 mb-2">No Face ID Data</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mb-4">
            Upload a Face ID data Excel file to process check-in and check-out times for all employees
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button 
              onClick={onUploadClick}
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white 
                text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </button>
            <button 
              onClick={onManualEntryClick}
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white 
                text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Add Manual Entry
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-2">
          <p className="text-sm text-gray-500">
            File processed. Upload another file to process more records.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            <button 
              onClick={onUploadClick}
              className="inline-flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white 
                text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Another File
            </button>
            <button 
              onClick={onManualEntryClick}
              className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white 
                text-sm font-medium rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <PlusCircle className="w-4 h-4 mr-2" />
              Add Manual Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmptyState;