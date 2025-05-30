import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import HrPage from './pages/HrPage';
import HrLoginPage from './pages/HrLoginPage';
import ApprovedHoursPage from './pages/ApprovedHoursPage';
import EmployeeLoginPage from './pages/EmployeeLoginPage';
import EmployeeDashboardPage from './pages/EmployeeDashboardPage';
import { useHrAuth } from './context/HrAuthContext';

// Route guard component for employee routes
const EmployeeRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const navigate = useNavigate();
  const employeeId = localStorage.getItem('employeeId');
  
  useEffect(() => {
    if (!employeeId) {
      navigate('/login', { replace: true });
    }
  }, [navigate, employeeId]);
  
  if (!employeeId) {
    return null;
  }
  
  return children;
};

// Route guard component for HR routes
const HrRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const navigate = useNavigate();
  const { isAuthenticated } = useHrAuth();
  
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/hr-login', { replace: true });
    }
  }, [navigate, isAuthenticated]);
  
  if (!isAuthenticated) {
    return null;
  }
  
  return children;
};

const AppRouter: React.FC = () => {
  return (
    <Routes>
      <Route path="/\" element={<LandingPage />} />
      
      {/* HR routes with authentication */}
      <Route path="/hr-login" element={<HrLoginPage />} />
      <Route 
        path="/hr" 
        element={
          <HrRoute>
            <HrPage />
          </HrRoute>
        } 
      />
      <Route 
        path="/approved-hours" 
        element={
          <HrRoute>
            <ApprovedHoursPage />
          </HrRoute>
        } 
      />
      <Route path="/approved/approved-hours" element={<Navigate to="/approved-hours\" replace />} />
      
      {/* Employee routes */}
      <Route path="/login" element={<EmployeeLoginPage />} />
      <Route 
        path="/employee" 
        element={
          <EmployeeRoute>
            <EmployeeDashboardPage />
          </EmployeeRoute>
        } 
      />
      {/* Redirect any unknown paths to the landing page */}
      <Route path="*" element={<Navigate to="/\" replace />} />
    </Routes>
  );
};

export default AppRouter;