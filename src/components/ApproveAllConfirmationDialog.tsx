import React from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

interface ApproveAllConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalRecords: number;
  isProcessing: boolean;
}

const ApproveAllConfirmationDialog: React.FC<ApproveAllConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  totalRecords,
  isProcessing
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-green-600 p-4 flex items-center">
          <CheckCircle className="w-6 h-6 text-white mr-2" />
          <h3 className="text-lg font-medium text-white">Confirm Approve All</h3>
          <button onClick={onClose} className="ml-auto text-white hover:text-green-100" disabled={isProcessing}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="bg-green-50 border border-green-100 rounded-md p-4 mb-4 flex items-start">
            <AlertCircle className="w-5 h-5 text-green-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-green-800">
              <p className="font-medium mb-1">You are about to approve all records</p>
              <p>This action will mark all {totalRecords} time records as approved.</p>
              <p className="mt-2">Approved records will be ready to save to the database.</p>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              disabled={isProcessing}
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isProcessing}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? 
                <><span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2 align-[-2px]"></span>Processing...</> : 
                <>Approve All Records</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApproveAllConfirmationDialog;