import React from 'react';
import Select, { MultiValue } from 'react-select';
import { Users } from 'lucide-react';

interface Employee {
  value: string;
  label: string;
}

interface MultiEmployeeSelectProps {
  employees: any[];
  selectedEmployeeIds: string[];
  onChange: (employeeIds: string[]) => void;
  className?: string;
}

const MultiEmployeeSelect: React.FC<MultiEmployeeSelectProps> = ({ 
  employees, 
  selectedEmployeeIds, 
  onChange,
  className = ""
}) => {
  // Sort employees alphabetically by name
  const sortedEmployees = [...employees].sort((a, b) => 
    a.name.localeCompare(b.name)
  );
  
  // Convert employees to options format
  const options: Employee[] = [
    { value: 'all', label: 'All Employees' },
    ...sortedEmployees.map(employee => ({
      value: employee.id,
      label: `${employee.name} (#${employee.employee_number})`
    }))
  ];
  
  // Determine selected options
  const selectedOptions = selectedEmployeeIds.includes('all') 
    ? [options[0]] 
    : options.filter(option => selectedEmployeeIds.includes(option.value));
  
  const handleChange = (selectedOptions: MultiValue<Employee>) => {
    // Check if "All Employees" is selected
    if (selectedOptions.some(option => option.value === 'all')) {
      onChange(['all']);
    } else {
      onChange(selectedOptions.map(option => option.value));
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Users className="w-4 h-4 text-gray-500 flex-shrink-0" />
      <div className="w-64">
        <Select
          isMulti
          options={options}
          value={selectedOptions}
          onChange={handleChange}
          className="react-select-container"
          classNamePrefix="react-select"
          placeholder="Select employees"
          closeMenuOnSelect={false}
          hideSelectedOptions={false}
        />
      </div>
    </div>
  );
};

export default MultiEmployeeSelect;