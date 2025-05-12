import React from 'react';
import { X, AlertCircle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  isProcessing: boolean;
  confirmButtonText?: string;
  cancelButtonText?: string;
  type?: 'warning' | 'danger' | 'info';
  confirmButtonColor?: string;
  icon?: React.ReactNode;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  isProcessing,
  confirmButtonText = "Confirm",
  cancelButtonText = "Cancel",
  type = "warning",
  confirmButtonColor,
  icon
}) => {
  if (!isOpen) return null;

  // Determine colors based on type
  const getColors = () => {
    switch (type) {
      case 'danger':
        return {
          headerBg: 'bg-red-600',
          confirmBg: confirmButtonColor || 'bg-red-600 hover:bg-red-700',
          alertBg: 'bg-red-50',
          alertBorder: 'border-red-100',
          alertText: 'text-red-800'
        };
      case 'info':
        return {
          headerBg: 'bg-blue-600',
          confirmBg: confirmButtonColor || 'bg-blue-600 hover:bg-blue-700',
          alertBg: 'bg-blue-50',
          alertBorder: 'border-blue-100',
          alertText: 'text-blue-800'
        };
      default: // warning
        return {
          headerBg: 'bg-amber-600',
          confirmBg: confirmButtonColor || 'bg-amber-600 hover:bg-amber-700',
          alertBg: 'bg-amber-50',
          alertBorder: 'border-amber-100',
          alertText: 'text-amber-800'
        };
    }
  };

  const colors = getColors();
  const defaultIcon = <AlertCircle className="w-5 h-5 mr-2" />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className={`${colors.headerBg} p-4 flex items-center`}>
          {icon || defaultIcon}
          <h3 className="text-lg font-medium text-white">{title}</h3>
          <button onClick={onClose} className="ml-auto text-white hover:text-gray-100" disabled={isProcessing}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className={`${colors.alertBg} border ${colors.alertBorder} rounded-md p-4 mb-4 flex items-start`}>
            <AlertCircle className="w-5 h-5 text-amber-500 mr-3 mt-0.5 flex-shrink-0" />
            <div className={`text-sm ${colors.alertText}`}>
              <p className="whitespace-pre-line">{message}</p>
            </div>
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              disabled={isProcessing}
            >
              {cancelButtonText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isProcessing}
              className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${colors.confirmBg} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing ? 
                <><span className="inline-block h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin mr-2 align-[-2px]"></span>Processing...</> : 
                confirmButtonText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;