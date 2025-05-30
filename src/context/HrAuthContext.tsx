import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface HrAuthContextType {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const HrAuthContext = createContext<HrAuthContextType | undefined>(undefined);

export const HrAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    // Check local storage for existing session on load
    const checkSession = () => {
      const hrUsername = localStorage.getItem('hrUsername');
      if (hrUsername) {
        setIsAuthenticated(true);
        setUsername(hrUsername);
      }
    };

    checkSession();
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      // Check credentials against hr_users table
      const { data, error } = await supabase
        .from('hr_users')
        .select('username, password')
        .eq('username', username)
        .eq('password', password)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Store session in local storage
        localStorage.setItem('hrUsername', username);
        setIsAuthenticated(true);
        setUsername(username);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error during login:', error);
      return false;
    }
  };

  const logout = () => {
    // Clear session from local storage
    localStorage.removeItem('hrUsername');
    setIsAuthenticated(false);
    setUsername(null);
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