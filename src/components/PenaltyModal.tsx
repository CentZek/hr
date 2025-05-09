import React, { useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { EmployeeRecord, DailyRecord, PENALTY_OPTIONS } from '../types';

interface PenaltyModalProps {
  employee: EmployeeRecord;
  day: DailyRecord;
  onClose: () => void;
  onApply: (penaltyMinutes: number) => void;
}

const PenaltyModal: React.FC<PenaltyModalProps> = ({ employee, day, onClose, onApply }) => {
  const [selectedPenalty, setSelectedPenalty] = useState<number>(day.penaltyMinutes);
  const [customPenalty, setCustomPenalty] = useState<string>(
    !PENALTY_OPTIONS.some(o => o.minutes === day.penaltyMinutes) && day.penaltyMinutes > 0
      ? (day.penaltyMinutes.toString())
      : ''
  );
  const [penaltyType, setPenaltyType] = useState<'preset' | 'custom'>(
    PENALTY_OPTIONS.some(o => o.minutes === day.penaltyMinutes) ? 'preset' : 'custom'
  );

  const handleSubmit = () => {
    if (penaltyType === 'preset') {
      console.log(`Applying preset penalty of ${selectedPenalty} minutes`);
      onApply(selectedPenalty);
    } else {
      const minutes = parseInt(customPenalty);
      if (isNaN(minutes) || minutes < 0) {
        alert('Please enter a valid number of minutes');
        return;
      }
      console.log(`Applying custom penalty of ${minutes} minutes`);
      onApply(minutes);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900">Apply Penalty</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
            <h4 className="text-base font-medium text-gray-800 mb-2">Employee Information</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Name</p>
                <p className="font-medium">{employee.name}</p>
              </div>
              <div>
                <p className="text-gray-500">Employee No</p>
                <p className="font-medium">{employee.employeeNumber}</p>
              </div>
              <div>
                <p className="text-gray-500">Date</p>
                <p className="font-medium">{format(new Date(day.date), 'MM/dd/yyyy')}</p>
              </div>
              <div>
                <p className="text-gray-500">Current Hours</p>
                <p className="font-medium">{day.hoursWorked.toFixed(2)}</p>
              </div>
            </div>
          </div>
          
          {day.penaltyMinutes > 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
              <p className="text-amber-700 font-medium">Current Penalty: {day.penaltyMinutes} minutes ({(day.penaltyMinutes / 60).toFixed(2)} hours)</p>
              <p className="text-amber-600 mt-1">Applying a new penalty will replace the current one.</p>
            </div>
          )}
          
          <div className="space-y-4 mb-6">
            {/* Preset penalties */}
            <div className="flex items-center mb-2">
              <input
                type="radio"
                id="preset-penalty"
                checked={penaltyType === 'preset'}
                onChange={() => setPenaltyType('preset')}
                className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label htmlFor="preset-penalty" className="ml-2 block text-sm font-medium text-gray-700">
                Select Penalty
              </label>
            </div>
            
            {penaltyType === 'preset' && (
              <div className="pl-6">
                <select
                  value={selectedPenalty}
                  onChange={(e) => setSelectedPenalty(parseInt(e.target.value))}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:ring-purple-500 focus:border-purple-500 sm:text-sm rounded-md"
                >
                  {PENALTY_OPTIONS.map((option, index) => (
                    <option key={index} value={option.minutes}>{option.label}</option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Custom penalty */}
            <div className="flex items-center mb-2">
              <input
                type="radio"
                id="custom-penalty"
                checked={penaltyType === 'custom'}
                onChange={() => setPenaltyType('custom')}
                className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
              />
              <label htmlFor="custom-penalty" className="ml-2 block text-sm font-medium text-gray-700">
                Custom Penalty (minutes)
              </label>
            </div>
            
            {penaltyType === 'custom' && (
              <div className="pl-6">
                <input
                  type="number"
                  value={customPenalty}
                  onChange={(e) => setCustomPenalty(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-purple-500 focus:border-purple-500 sm:text-sm"
                  placeholder="Enter minutes"
                  min="0"
                />
              </div>
            )}
          </div>
          
          <div className="flex justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
            >
              Apply Penalty
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PenaltyModal;