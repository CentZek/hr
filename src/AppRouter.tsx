import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import HrPage from './pages/HrPage';
import ApprovedHoursPage from './pages/ApprovedHoursPage';
import EmployeeLoginPage from './pages/EmployeeLoginPage';
import EmployeeDashboardPage from './pages/EmployeeDashboardPage';

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

const AppRouter: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/hr" element={<HrPage />} />
      <Route path="/approved-hours" element={<ApprovedHoursPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default AppRouter;