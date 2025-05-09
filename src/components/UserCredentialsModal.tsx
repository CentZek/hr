import React, { useState, useEffect } from 'react';
import { X, User, KeyRound, AlertCircle, Check, Search, Plus, Eye, EyeOff, Edit } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface UserCredentialsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Employee {
  id: string;
  name: string;
  employee_number: string;
}

interface Credential {
  id: string;
  employee_id: string;
  username: string;
  password: string;
  employee_name?: string;
  employee_number?: string;
}

const UserCredentialsModal: React.FC<UserCredentialsModalProps> = ({ isOpen, onClose }) => {
  // State for employees and credentials
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // State for form
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCredentialId, setEditingCredentialId] = useState('');
  const [usernameExists, setUsernameExists] = useState(false);
  
  // State for errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  
  // Fetch employees and credentials on load
  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);
  
  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch employees
      const { data: employeesData, error: employeesError } = await supabase
        .from('employees')
        .select('id, name, employee_number')
        .order('name');
      
      if (employeesError) throw employeesError;
      
      // Fetch credentials with employee names
      const { data: credentialsData, error: credentialsError } = await supabase
        .from('user_credentials')
        .select(`
          id, 
          employee_id, 
          username, 
          password,
          employees (
            name,
            employee_number
          )
        `)
        .order('created_at', { ascending: false });
      
      if (credentialsError) throw credentialsError;
      
      // Format credentials data with employee names
      const formattedCredentials: Credential[] = credentialsData?.map(cred => ({
        id: cred.id,
        employee_id: cred.employee_id,
        username: cred.username,
        password: cred.password,
        employee_name: cred.employees?.name,
        employee_number: cred.employees?.employee_number
      })) || [];
      
      setEmployees(employeesData || []);
      setCredentials(formattedCredentials);
      
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load employee data');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setSelectedEmployeeId('');
    setUsername('');
    setPassword('');
    setErrors({});
    setIsEditing(false);
    setEditingCredentialId('');
    setUsernameExists(false);
  };

  const handleEdit = (credential: Credential) => {
    setIsEditing(true);
    setEditingCredentialId(credential.id);
    setSelectedEmployeeId(credential.employee_id);
    setUsername(credential.username);
    setPassword(credential.password);
    setUsernameExists(false); // Reset when editing existing credential
  };

  // Check if username already exists (excluding the current editing credential)
  const checkUsernameExists = async (username: string) => {
    if (!username.trim()) return false;
    
    try {
      const query = supabase
        .from('user_credentials')
        .select('id')
        .eq('username', username);
      
      // If editing an existing credential, exclude it from the check
      if (isEditing) {
        query.neq('id', editingCredentialId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return (data && data.length > 0);
    } catch (error) {
      console.error('Error checking username:', error);
      return false; // Fail open to prevent blocking the form
    }
  };

  // Check username on change
  useEffect(() => {
    const checkUsername = async () => {
      if (username.trim()) {
        const exists = await checkUsernameExists(username);
        setUsernameExists(exists);
        if (exists) {
          setErrors(prev => ({ ...prev, username: 'Username already exists' }));
        } else {
          setErrors(prev => ({ ...prev, username: '' }));
        }
      }
    };
    
    const timer = setTimeout(() => {
      checkUsername();
    }, 500); // Debounce
    
    return () => clearTimeout(timer);
  }, [username, isEditing, editingCredentialId]);

  // Generate unique username based on employee name
  const generateUniqueUsername = (baseName: string) => {
    // Get list of existing usernames that start with this base name
    const existingNames = credentials.map(c => c.username)
      .filter(name => name.startsWith(baseName));
    
    if (existingNames.length === 0) {
      return baseName;
    }
    
    // Try adding a number suffix
    let counter = 1;
    let candidate = `${baseName}${counter}`;
    
    while (existingNames.includes(candidate)) {
      counter++;
      candidate = `${baseName}${counter}`;
    }
    
    return candidate;
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!selectedEmployeeId) {
      newErrors.employee = 'Please select an employee';
    }
    
    if (!username.trim()) {
      newErrors.username = 'Username is required';
    } else if (usernameExists) {
      newErrors.username = 'Username already exists';
    }
    
    if (!password.trim()) {
      newErrors.password = 'Password is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    
    setIsSaving(true);
    try {
      if (isEditing) {
        // Update existing credentials - removed unnecessary select()
        const { error } = await supabase
          .from('user_credentials')
          .update({
            username,
            password
          })
          .eq('id', editingCredentialId);
        
        if (error) throw error;
        toast.success('Credentials updated successfully');
      } else {
        // Check if employee already has credentials
        const { data: existingCred, error: checkError } = await supabase
          .from('user_credentials')
          .select('id')
          .eq('employee_id', selectedEmployeeId)
          .maybeSingle();
        
        if (checkError) throw checkError;
        
        if (existingCred) {
          // Update existing - removed unnecessary select()
          const { error } = await supabase
            .from('user_credentials')
            .update({
              username,
              password
            })
            .eq('id', existingCred.id);
          
          if (error) throw error;
          toast.success('Credentials updated successfully');
        } else {
          // Create new - removed unnecessary select()
          const { error } = await supabase
            .from('user_credentials')
            .insert({
              employee_id: selectedEmployeeId,
              username,
              password
            });
          
          if (error) throw error;
          toast.success('Credentials created successfully');
        }
      }
      
      // Refresh data and reset form
      await fetchData();
      resetForm();
      
    } catch (error) {
      console.error('Error saving credentials:', error);
      toast.error('Failed to save credentials');
    } finally {
      setIsSaving(false);
    }
  };

  // Filter credentials based on search query
  const filteredCredentials = credentials.filter(cred => {
    const searchLower = searchQuery.toLowerCase();
    return (
      (cred.employee_name?.toLowerCase().includes(searchLower) || false) ||
      (cred.employee_number?.toLowerCase().includes(searchLower) || false) ||
      cred.username.toLowerCase().includes(searchLower)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-green-600 text-white">
          <h3 className="text-lg font-semibold flex items-center">
            <KeyRound className="w-5 h-5 mr-2" />
            Manage Employee Credentials
          </h3>
          <button 
            onClick={onClose}
            className="text-white hover:text-green-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-0 h-[75vh] max-h-[75vh]">
          {/* Left panel - Create/Edit form */}
          <div className="p-6 border-r border-gray-200 overflow-y-auto">
            <h4 className="font-medium text-lg mb-4">
              {isEditing ? 'Edit Credentials' : 'Create New Credentials'}
            </h4>
            
            {/* Form */}
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
              {/* Employee Selection */}
              <div>
                <label htmlFor="employee" className="block text-sm font-medium text-gray-700 mb-1">
                  Employee
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <select
                    id="employee"
                    value={selectedEmployeeId}
                    onChange={(e) => {
                      setSelectedEmployeeId(e.target.value);
                      
                      // If we're creating a new user, pre-fill the username with the employee name
                      if (!isEditing) {
                        const selectedEmployee = employees.find(emp => emp.id === e.target.value);
                        if (selectedEmployee) {
                          // Generate a unique username based on employee name
                          const uniqueName = generateUniqueUsername(selectedEmployee.name);
                          setUsername(uniqueName);
                        }
                      }
                      
                      setErrors({ ...errors, employee: '' });
                    }}
                    className={`block w-full pl-10 pr-3 py-2 text-base border ${
                      errors.employee ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-green-500 focus:border-green-500'
                    } rounded-md`}
                    disabled={isLoading || isEditing}
                  >
                    <option value="">Select an employee</option>
                    {employees.map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} (#{employee.employee_number})
                      </option>
                    ))}
                  </select>
                </div>
                {errors.employee && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.employee}</p>
                )}
              </div>
              
              {/* Username */}
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setErrors({ ...errors, username: '' });
                    }}
                    className={`block w-full pl-10 pr-3 py-2 text-base border ${
                      errors.username || usernameExists ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-green-500 focus:border-green-500'
                    } rounded-md`}
                    placeholder="Username"
                  />
                  {usernameExists && (
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                      <AlertCircle className="h-5 w-5 text-red-500" />
                    </div>
                  )}
                </div>
                {errors.username && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.username}</p>
                )}
                {usernameExists && !errors.username && (
                  <p className="mt-1.5 text-xs text-red-600">This username is already taken</p>
                )}
              </div>
              
              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <KeyRound className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setErrors({ ...errors, password: '' });
                    }}
                    className={`block w-full pl-10 pr-10 py-2 text-base border ${
                      errors.password ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : 
                      'border-gray-300 focus:ring-green-500 focus:border-green-500'
                    } rounded-md`}
                    placeholder="Password"
                  />
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-gray-400 hover:text-gray-500"
                    >
                      {showPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
                {errors.password && (
                  <p className="mt-1.5 text-xs text-red-600">{errors.password}</p>
                )}
              </div>
              
              {/* Button */}
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="mr-2 px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving || usernameExists}
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <span className="inline-block animate-spin h-4 w-4 border-2 border-t-transparent border-white rounded-full mr-2"></span>
                      Saving...
                    </>
                  ) : (
                    isEditing ? 'Update Credentials' : 'Create Credentials'
                  )}
                </button>
              </div>
            </form>
            
            {/* Help text */}
            <div className="mt-6 border-t border-gray-200 pt-4">
              <div className="bg-yellow-50 border border-yellow-100 rounded-md p-4 flex items-start">
                <AlertCircle className="w-5 h-5 text-yellow-500 mr-3 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-1">Important Security Notes</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Username and password are used for employee login</li>
                    <li>Employee ID numbers are often used as default passwords</li>
                    <li>Consider using more secure passwords for sensitive accounts</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          
          {/* Right panel - Credentials list */}
          <div className="md:col-span-2 border-l border-gray-200 flex flex-col">
            {/* Search */}
            <div className="p-4 border-b border-gray-200">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, employee number or username..."
                  className="block w-full pl-10 pr-3 py-2 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-green-500 focus:border-green-500"
                />
              </div>
            </div>
            
            {/* Credentials list */}
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex justify-center items-center h-full">
                  <div className="animate-spin w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full"></div>
                </div>
              ) : filteredCredentials.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  {searchQuery ? (
                    <>
                      <Search className="h-12 w-12 text-gray-300 mb-2" />
                      <p>No results found for "{searchQuery}"</p>
                    </>
                  ) : (
                    <>
                      <KeyRound className="h-12 w-12 text-gray-300 mb-2" />
                      <p>No credentials created yet</p>
                      <p className="text-sm mt-1">Create your first employee login credentials!</p>
                    </>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {filteredCredentials.map(cred => (
                    <div
                      key={cred.id}
                      className="p-4 hover:bg-gray-50 transition-colors duration-100"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 flex items-center">
                            {cred.employee_name || 'Unknown Employee'}
                            <span className="ml-2 text-xs text-gray-500">
                              #{cred.employee_number || 'N/A'}
                            </span>
                          </h4>
                          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            <div>
                              <p className="text-gray-500">Username</p>
                              <p className="font-medium">{cred.username}</p>
                            </div>
                            <div>
                              <p className="text-gray-500">Password</p>
                              <p className="font-medium">
                                {showPassword ? cred.password : '••••••••'}
                              </p>
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleEdit(cred)}
                          className="p-1.5 text-sm bg-green-50 text-green-600 rounded-md hover:bg-green-100 flex items-center"
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserCredentialsModal;