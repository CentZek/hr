import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface HrAuthContextType {
  isAuthenticated: boolean;
  username: string;
  login: (username: string, password: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
}

const HrAuthContext = createContext<HrAuthContextType | undefined>(undefined);

export const HrAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');

  // Check for existing session on load
  useEffect(() => {
    const checkSession = () => {
      const hrAuth = localStorage.getItem('hrAuth');
      const hrUsername = localStorage.getItem('hrUsername');
      
      if (hrAuth === 'true' && hrUsername) {
        setIsAuthenticated(true);
        setUsername(hrUsername);
      }
    };
    
    checkSession();
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; message: string }> => {
    try {
      // Verify credentials against hr_users table
      const { data, error } = await supabase
        .from('hr_users')
        .select('username, password')
        .eq('username', username)
        .single();

      if (error || !data) {
        return { success: false, message: 'Invalid username or password' };
      }

      // Verify password
      if (data.password !== password) {
        return { success: false, message: 'Invalid password' };
      }

      // Set authentication state
      setIsAuthenticated(true);
      setUsername(username);
      
      // Store in localStorage for persistence
      localStorage.setItem('hrAuth', 'true');
      localStorage.setItem('hrUsername', username);

      return { success: true, message: 'Login successful' };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'An error occurred during login' };
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setUsername('');
    
    // Clear from localStorage
    localStorage.removeItem('hrAuth');
    localStorage.removeItem('hrUsername');
  };

  return (
    <HrAuthContext.Provider value={{ isAuthenticated, username, login, logout }}>
      {children}
    </HrAuthContext.Provider>
  );
};

export const useHrAuth = (): HrAuthContextType => {
  const context = useContext(HrAuthContext);
  if (context === undefined) {
    throw new Error('useHrAuth must be used within an HrAuthProvider');
  }
  return context;
};