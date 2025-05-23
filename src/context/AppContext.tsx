import React, { createContext, useContext, useState, useEffect } from 'react';
import { EmployeeRecord } from '../types';
import { STORAGE_VERSION, getKeyName, parseWithDates } from '../utils/storageUtils';

interface AppContextType {
  // HR page state
  employeeRecords: EmployeeRecord[];
  setEmployeeRecords: React.Dispatch<React.SetStateAction<EmployeeRecord[]>>;
  hasUploadedFile: boolean;
  setHasUploadedFile: React.Dispatch<React.SetStateAction<boolean>>;
  currentFileName: string;
  setCurrentFileName: React.Dispatch<React.SetStateAction<string>>;
  totalEmployees: number;
  setTotalEmployees: React.Dispatch<React.SetStateAction<number>>;
  totalDays: number;
  setTotalDays: React.Dispatch<React.SetStateAction<number>>;
  
  // Other shared state can be added here
  clearData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // HR page state
  const [employeeRecords, setEmployeeRecords] = useState<EmployeeRecord[]>([]);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [totalDays, setTotalDays] = useState(0);

  // Function to clear all data
  const clearData = () => {
    setEmployeeRecords([]);
    setHasUploadedFile(false);
    setCurrentFileName('');
    setTotalEmployees(0);
    setTotalDays(0);
    
    // Clear localStorage
    localStorage.removeItem(getKeyName('employeeRecords'));
    localStorage.removeItem(getKeyName('hasUploadedFile'));
    localStorage.removeItem(getKeyName('currentFileName'));
    localStorage.removeItem(getKeyName('totalEmployees'));
    localStorage.removeItem(getKeyName('totalDays'));
    
    // Also clear the old version keys to prevent future issues
    localStorage.removeItem('employeeRecords');
    localStorage.removeItem('hasUploadedFile');
    localStorage.removeItem('currentFileName');
    localStorage.removeItem('totalEmployees');
    localStorage.removeItem('totalDays');
  };

  // Load data from localStorage on initial render
  useEffect(() => {
    try {
      const savedEmployeeRecords = localStorage.getItem(getKeyName('employeeRecords'));
      const savedHasUploadedFile = localStorage.getItem(getKeyName('hasUploadedFile'));
      const savedCurrentFileName = localStorage.getItem(getKeyName('currentFileName'));
      const savedTotalEmployees = localStorage.getItem(getKeyName('totalEmployees'));
      const savedTotalDays = localStorage.getItem(getKeyName('totalDays'));

      if (savedEmployeeRecords) {
        // Use the custom parser to handle dates properly
        const parsedRecords = parseWithDates(savedEmployeeRecords);
        setEmployeeRecords(parsedRecords);
      }
      
      if (savedHasUploadedFile) setHasUploadedFile(JSON.parse(savedHasUploadedFile));
      if (savedCurrentFileName) setCurrentFileName(savedCurrentFileName);
      if (savedTotalEmployees) setTotalEmployees(JSON.parse(savedTotalEmployees));
      if (savedTotalDays) setTotalDays(JSON.parse(savedTotalDays));
    } catch (error) {
      console.error('Error loading data from localStorage:', error);
      // If there's any error loading the data, clear everything to start fresh
      clearData();
    }
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(getKeyName('employeeRecords'), JSON.stringify(employeeRecords));
      localStorage.setItem(getKeyName('hasUploadedFile'), JSON.stringify(hasUploadedFile));
      localStorage.setItem(getKeyName('currentFileName'), currentFileName);
      localStorage.setItem(getKeyName('totalEmployees'), JSON.stringify(totalEmployees));
      localStorage.setItem(getKeyName('totalDays'), JSON.stringify(totalDays));
    } catch (error) {
      console.error('Error saving data to localStorage:', error);
    }
  }, [employeeRecords, hasUploadedFile, currentFileName, totalEmployees, totalDays]);

  return (
    <AppContext.Provider
      value={{
        employeeRecords,
        setEmployeeRecords,
        hasUploadedFile,
        setHasUploadedFile,
        currentFileName,
        setCurrentFileName,
        totalEmployees,
        setTotalEmployees,
        totalDays,
        setTotalDays,
        clearData
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};