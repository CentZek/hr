import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, User, KeyRound, AlertCircle, Home } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AnimatedClock from '../components/AnimatedClock';
import toast, { Toaster } from 'react-hot-toast';

const EmployeeLoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already logged in
    const checkSession = async () => {
      const employeeId = localStorage.getItem('employeeId');
      const employeeName = localStorage.getItem('employeeName');
      
      if (employeeId && employeeName) {
        navigate('/employee', { replace: true });
      }
    };
    
    checkSession();
  }, [navigate]);

  // Function to generate a unique username by checking the database
  const generateUniqueUsername = async (baseName: string, employeeNumber: string) => {
    // First try with employee number as part of the username for uniqueness
    let candidateUsername = `${baseName}_${employeeNumber}`;
    let counter = 1;
    let isUnique = false;
    
    while (!isUnique && counter < 100) {
      // Check if this username exists - case insensitive
      const { data, error } = await supabase
        .from('user_credentials')
        .select('username')
        .ilike('username', candidateUsername)
        .maybeSingle();
      
      if (error) {
        console.error('Error checking username uniqueness:', error);
        throw new Error('Failed to verify username uniqueness');
      }
      
      // If no data returned, username is unique
      if (!data) {
        isUnique = true;
      } else {
        // Try next candidate with a counter
        candidateUsername = `${baseName}_${counter}`;
        counter++;
      }
    }
    
    // Safety check to prevent infinite loops
    if (counter >= 100) {
      throw new Error('Failed to generate a unique username after multiple attempts');
    }
    
    return candidateUsername;
  };

  const handleLoginWithCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // First check if exact match by username in user_credentials table
      const { data: credentialsData, error: credentialsError } = await supabase
        .from('user_credentials')
        .select('id, employee_id, username, password')
        .eq('username', username)
        .maybeSingle();

      // If credentials exist with exact username match, validate password
      if (credentialsData) {
        // Validate password
        if (credentialsData.password !== password) {
          setError('Invalid password. Please try again.');
          setIsLoading(false);
          return;
        }

        // Get employee details
        const { data: employeeData, error: employeeError } = await supabase
          .from('employees')
          .select('*')
          .eq('id', credentialsData.employee_id)
          .maybeSingle();

        if (employeeError || !employeeData) {
          setError('Failed to retrieve employee details. Please contact HR.');
          setIsLoading(false);
          return;
        }

        // Store employee info in localStorage
        localStorage.setItem('employeeId', employeeData.id);
        localStorage.setItem('employeeName', employeeData.name);
        localStorage.setItem('employeeNumber', employeeData.employee_number);
        
        toast.success('Login successful');
        setTimeout(() => {
          navigate('/employee', { replace: true });
        }, 500);
        return;
      }

      // If no exact username match, try to find employee by name and employee number
      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .or(`name.ilike.${username}%,name.eq.${username}`)
        .eq('employee_number', password)
        .order('name', { ascending: true });

      if (employeeError) {
        throw employeeError;
      }

      // If multiple results, check for exact match on employee number
      if (employeeData && employeeData.length > 0) {
        // Find exact match on employee number
        const matchingEmployee = employeeData.find(e => e.employee_number === password);

        if (!matchingEmployee) {
          setError('Multiple employees found with that name. Please enter your complete name or employee number.');
          setIsLoading(false);
          return;
        }

        try {
          // Generate a unique username for this employee - always include employee number for uniqueness
          const uniqueUsername = await generateUniqueUsername(matchingEmployee.name, matchingEmployee.employee_number);
          
          // Create new credentials entry for this employee
          const { error: newCredentialsError } = await supabase
            .from('user_credentials')
            .insert({
              employee_id: matchingEmployee.id,
              username: uniqueUsername,
              password: matchingEmployee.employee_number
            });

          if (newCredentialsError) {
            console.error('Error creating credentials:', newCredentialsError);
            setError('Failed to create login credentials. Please try again.');
            setIsLoading(false);
            return;
          }

          // Inform user about their new username
          toast.success(`Welcome! Your username has been set to: ${uniqueUsername}`);

          // Store employee info in localStorage
          localStorage.setItem('employeeId', matchingEmployee.id);
          localStorage.setItem('employeeName', matchingEmployee.name);
          localStorage.setItem('employeeNumber', matchingEmployee.employee_number);
          
          setTimeout(() => {
            navigate('/employee', { replace: true });
          }, 1500); // Longer timeout so user can see the username message
          return;
        } catch (usernameError) {
          console.error('Username generation error:', usernameError);
          setError('Failed to create a unique username. Please contact HR.');
          setIsLoading(false);
          return;
        }
      } else {
        setError('Employee not found. Please check your name and employee number.');
        setIsLoading(false);
        return;
      }
    } catch (error: any) {
      console.error('Login error:', error);
      setError(error?.message || 'An unexpected error occurred. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#e6eaff] flex flex-col items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        {/* Header Section */}
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <AnimatedClock />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            Employee Portal
          </h2>
          <p className="text-sm text-gray-600 text-center">
            Track your working hours and manage your shifts
          </p>
        </div>

        {/* Login Form */}
        <div className="bg-white shadow-md rounded-lg p-6">
          <form onSubmit={handleLoginWithCredentials} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-3 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                Username or Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 sm:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Enter your username or full name"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                First time login: Enter your full name exactly as provided by HR
              </p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password (Your Employee Number)
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 sm:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-purple-500 focus:border-purple-500"
                  placeholder="Enter your employee number"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                  isLoading ? 'bg-purple-400' : 'bg-purple-600 hover:bg-purple-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition duration-150 ease-in-out`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Logging in...
                  </>
                ) : (
                  'Log In'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Help text and back to home link */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 mb-2">
            Need help? Please contact HR or your supervisor.
          </p>
          <button
            onClick={() => navigate('/')} 
            className="text-purple-600 hover:text-purple-800 flex items-center justify-center mx-auto mt-2"
          >
            <Home className="w-4 h-4 mr-1" />
            Back to Home
          </button>
        </div>
      </div>
      <Toaster position="top-right" />
    </div>
  );
};

export default EmployeeLoginPage;