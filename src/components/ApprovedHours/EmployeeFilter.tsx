import React from 'react';
import { User } from 'lucide-react';

interface EmployeeFilterProps {
  employees: any[];
  selectedEmployeeId: string;
  onChange: (employeeId: string) => void;
  className?: string;
}

const EmployeeFilter: React.FC<EmployeeFilterProps> = ({ 
  employees, 
  selectedEmployeeId, 
  onChange,
  className = ""
}) => {
  // Sort employees alphabetically by name
  const sortedEmployees = [...employees].sort((a, b) => 
    a.name.localeCompare(b.name)
  );

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <User className="w-4 h-4 text-gray-500" />
      <select
        value={selectedEmployeeId}
        onChange={(e) => onChange(e.target.value)}
        className="border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
      >
        <option value="all">All Employees</option>
        {sortedEmployees.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default EmployeeFilter;