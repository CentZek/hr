import React, { useState, useEffect, useRef } from 'react';
import { User, Check, Search, X, ChevronDown } from 'lucide-react';

interface MultiEmployeeFilterProps {
  employees: any[];
  selectedEmployeeIds: string[];
  onChange: (employeeIds: string[]) => void;
  className?: string;
}

const MultiEmployeeFilter: React.FC<MultiEmployeeFilterProps> = ({
  employees,
  selectedEmployeeIds,
  onChange,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sort employees alphabetically by name
  const sortedEmployees = [...employees].sort((a, b) => 
    a.name.localeCompare(b.name)
  );
  
  // Filter employees based on search term
  const filteredEmployees = sortedEmployees.filter(employee => 
    employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    employee.employee_number.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Toggle selection of an employee
  const toggleEmployee = (employeeId: string) => {
    if (selectedEmployeeIds.includes(employeeId)) {
      onChange(selectedEmployeeIds.filter(id => id !== employeeId));
    } else {
      onChange([...selectedEmployeeIds, employeeId]);
    }
  };

  // Select all visible employees
  const selectAllVisible = () => {
    const visibleIds = filteredEmployees.map(employee => employee.id);
    onChange([...new Set([...selectedEmployeeIds, ...visibleIds])]);
  };
  
  // Deselect all visible employees
  const deselectAllVisible = () => {
    const visibleIds = new Set(filteredEmployees.map(employee => employee.id));
    onChange(selectedEmployeeIds.filter(id => !visibleIds.has(id)));
  };
  
  // Clear all selections
  const clearAllSelections = () => {
    onChange([]);
  };

  // Get display text for the dropdown button
  const getDisplayText = () => {
    if (selectedEmployeeIds.length === 0) {
      return 'All Employees';
    } else if (selectedEmployeeIds.length === 1) {
      const employee = employees.find(emp => emp.id === selectedEmployeeIds[0]);
      return employee ? employee.name : '1 Employee';
    } else {
      return `${selectedEmployeeIds.length} Employees`;
    }
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Dropdown button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between border border-gray-300 rounded-md px-3 py-2 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        <div className="flex items-center">
          <User className="w-4 h-4 text-gray-500 mr-2" />
          <span className="text-sm">{getDisplayText()}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </button>
      
      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg">
          {/* Search and actions */}
          <div className="p-2 border-b border-gray-200">
            <div className="relative mb-2">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search employees..."
                className="w-full pl-9 pr-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                autoFocus
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            {/* Action buttons */}
            <div className="flex justify-between text-xs">
              <button
                onClick={selectAllVisible}
                className="text-purple-600 hover:text-purple-800"
              >
                Select all visible
              </button>
              
              <button
                onClick={deselectAllVisible}
                className="text-purple-600 hover:text-purple-800"
              >
                Deselect visible
              </button>
              
              <button
                onClick={clearAllSelections}
                className="text-red-600 hover:text-red-800"
              >
                Clear all
              </button>
            </div>
          </div>
          
          {/* Employee list */}
          <div className="max-h-60 overflow-y-auto">
            {filteredEmployees.length === 0 ? (
              <div className="p-3 text-center text-sm text-gray-500">
                No employees found
              </div>
            ) : (
              filteredEmployees.map(employee => (
                <div
                  key={employee.id}
                  onClick={() => toggleEmployee(employee.id)}
                  className={`flex items-center px-3 py-2 cursor-pointer hover:bg-gray-100 ${
                    selectedEmployeeIds.includes(employee.id) ? 'bg-purple-50' : ''
                  }`}
                >
                  <div className={`w-5 h-5 flex items-center justify-center border rounded mr-2 ${
                    selectedEmployeeIds.includes(employee.id) 
                      ? 'bg-purple-600 border-purple-600' 
                      : 'border-gray-300'
                  }`}>
                    {selectedEmployeeIds.includes(employee.id) && (
                      <Check className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{employee.name}</p>
                    <p className="text-xs text-gray-500">#{employee.employee_number}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {/* Employee count */}
          <div className="p-2 border-t border-gray-200 text-xs text-gray-500 flex justify-between">
            <span>
              {selectedEmployeeIds.length} of {employees.length} selected
            </span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-purple-600 hover:text-purple-800 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiEmployeeFilter;