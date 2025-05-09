import React, { createContext, useContext, useState, useEffect } from 'react';
import { EmployeeRecord } from '../types';

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

  // Load data from localStorage on initial render
  useEffect(() => {
    try {
      const savedEmployeeRecords = localStorage.getItem('employeeRecords');
      const savedHasUploadedFile = localStorage.getItem('hasUploadedFile');
      const savedCurrentFileName = localStorage.getItem('currentFileName');
      const savedTotalEmployees = localStorage.getItem('totalEmployees');
      const savedTotalDays = localStorage.getItem('totalDays');

      if (savedEmployeeRecords) setEmployeeRecords(JSON.parse(savedEmployeeRecords));
      if (savedHasUploadedFile) setHasUploadedFile(JSON.parse(savedHasUploadedFile));
      if (savedCurrentFileName) setCurrentFileName(savedCurrentFileName);
      if (savedTotalEmployees) setTotalEmployees(JSON.parse(savedTotalEmployees));
      if (savedTotalDays) setTotalDays(JSON.parse(savedTotalDays));
    } catch (error) {
      console.error('Error loading data from localStorage:', error);
    }
  }, []);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('employeeRecords', JSON.stringify(employeeRecords));
      localStorage.setItem('hasUploadedFile', JSON.stringify(hasUploadedFile));
      localStorage.setItem('currentFileName', currentFileName);
      localStorage.setItem('totalEmployees', JSON.stringify(totalEmployees));
      localStorage.setItem('totalDays', JSON.stringify(totalDays));
    } catch (error) {
      console.error('Error saving data to localStorage:', error);
    }
  }, [employeeRecords, hasUploadedFile, currentFileName, totalEmployees, totalDays]);

  // Function to clear all data
  const clearData = () => {
    setEmployeeRecords([]);
    setHasUploadedFile(false);
    setCurrentFileName('');
    setTotalEmployees(0);
    setTotalDays(0);
    
    // Clear localStorage
    localStorage.removeItem('employeeRecords');
    localStorage.removeItem('hasUploadedFile');
    localStorage.removeItem('currentFileName');
    localStorage.removeItem('totalEmployees');
    localStorage.removeItem('totalDays');
  };

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