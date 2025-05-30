import React, { useState, useEffect, useRef } from 'react';
import { User, Search, X, ChevronDown, ChevronUp } from 'lucide-react';

interface MultiEmployeeFilterProps {
  employees: any[];
  selectedEmployees: string[];
  onChange: (employeeId: string, isSelected: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  className?: string;
}

const MultiEmployeeFilter: React.FC<MultiEmployeeFilterProps> = ({ 
  employees, 
  selectedEmployees, 
  onChange,
  onSelectAll,
  onClear,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sort employees alphabetically by name
  const sortedEmployees = [...employees].sort((a, b) => 
    a.name.localeCompare(b.name)
  );

  // Filter employees based on search query
  const filteredEmployees = searchQuery.trim() === '' 
    ? sortedEmployees 
    : sortedEmployees.filter(emp => 
        emp.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        emp.employee_number.toLowerCase().includes(searchQuery.toLowerCase())
      );

  // Close the dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus the search input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Handle checkbox click
  const handleCheckboxClick = (e: React.MouseEvent, employeeId: string) => {
    e.stopPropagation(); // Prevent the row click from firing
    onChange(employeeId, !selectedEmployees.includes(employeeId));
  };

  // Handle row click
  const handleRowClick = (employeeId: string) => {
    onChange(employeeId, !selectedEmployees.includes(employeeId));
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Main button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        <User className="w-4 h-4 text-gray-500" />
        <span>
          {selectedEmployees.length === 0 
            ? 'Select Employees' 
            : selectedEmployees.length === 1 
              ? '1 Employee Selected'
              : `${selectedEmployees.length} Employees Selected`
          }
        </span>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute left-0 z-50 mt-1 w-64 bg-white rounded-md shadow-lg border border-gray-200">
          {/* Search and actions */}
          <div className="p-2 border-b border-gray-200">
            <div className="relative mb-2">
              <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="block w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2 flex items-center"
                >
                  <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
            
            <div className="flex justify-between">
              <button
                onClick={() => {
                  onSelectAll();
                  // Keep the dropdown open after selecting all
                }}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
              >
                {selectedEmployees.length === employees.length ? 'Deselect All' : 'Select All'}
              </button>
              
              {selectedEmployees.length > 0 && (
                <button
                  onClick={() => {
                    onClear();
                    // Keep the dropdown open after clearing
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                >
                  Clear ({selectedEmployees.length})
                </button>
              )}
            </div>
          </div>

          {/* Employee list */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredEmployees.length === 0 ? (
              <div className="text-center py-2 text-sm text-gray-500">
                No employees found
              </div>
            ) : (
              filteredEmployees.map((employee) => (
                <div 
                  key={employee.id}
                  className="px-3 py-1.5 hover:bg-gray-100 cursor-pointer"
                  onClick={() => handleRowClick(employee.id)}
                >
                  <div className="flex items-center flex-1 min-w-0">
                    <input
                      type="checkbox"
                      id={`emp-${employee.id}`}
                      checked={selectedEmployees.includes(employee.id)}
                      onChange={() => {}} // Handled by parent div click
                      onClick={(e) => handleCheckboxClick(e, employee.id)}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded cursor-pointer"
                    />
                    <label 
                      htmlFor={`emp-${employee.id}`} 
                      className="ml-2 block text-sm text-gray-900 truncate flex-1 cursor-pointer"
                      onClick={(e) => e.preventDefault()} // Prevent label click from triggering default checkbox behavior
                    >
                      {employee.name}
                      <span className="text-xs text-gray-500 ml-1">#{employee.employee_number}</span>
                    </label>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {/* Footer with selected count */}
          {selectedEmployees.length > 0 && (
            <div className="border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
              {selectedEmployees.length} employee{selectedEmployees.length !== 1 ? 's' : ''} selected
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiEmployeeFilter;