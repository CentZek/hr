import React from 'react';
import { Trash2, AlertCircle, X } from 'lucide-react';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isDeleting: boolean;
  deleteButtonText?: string;
  cancelButtonText?: string;
  scope?: string;
}

const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  isOpen, onClose, onConfirm, title, message, isDeleting,
  deleteButtonText = "Delete", cancelButtonText = "Cancel", scope = "all"
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-red-600 p-4 flex items-center">
          <Trash2 className="w-6 h-6 text-white mr-2" />
          <h3 className="text-lg font-medium text-white">{title}</h3>
          <button onClick={onClose} className="ml-auto text-white hover:text-red-100" disabled={isDeleting}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="bg-red-50 border border-red-100 rounded-md p-4 mb-4 flex items-start">
            <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-800">
              <p className="font-medium mb-1">Warning: This action cannot be undone</p>
              <p>{message}</p>
              {scope === "all" && <p className="mt-2 font-medium">All time records for all employees will be permanently deleted.</p>}
              {scope === "month" && <p className="mt-2 font-medium">All time records for the selected month will be permanently deleted.</p>}
            </div>
          </div>
          
          <div className="text-sm text-gray-600 mb-4">Please type <strong>DELETE</strong> to confirm:</div>
          
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            placeholder="Type DELETE to confirm"
            autoFocus
            id="delete-confirmation-input"
          />
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={isDeleting}
            >
              {cancelButtonText}
            </button>
            <button
              onClick={() => {
                const input = document.getElementById('delete-confirmation-input') as HTMLInputElement;
                if (input?.value === 'DELETE') onConfirm();
                else alert('Please type DELETE to confirm');
              }}
              disabled={isDeleting}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? 
                <><span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2 align-[-2px]"></span>Deleting...</> : 
                <><Trash2 className="w-4 h-4 mr-1 inline" />{deleteButtonText}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmDialog;