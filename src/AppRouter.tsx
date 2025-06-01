import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import HrPage from './pages/HrPage';
import HrLoginPage from './pages/HrLoginPage';
import ApprovedHoursPage from './pages/ApprovedHoursPage';
import EmployeeLoginPage from './pages/EmployeeLoginPage';
import EmployeeDashboardPage from './pages/EmployeeDashboardPage';
import OperationalManagerPage from './pages/OperationalManagerPage';
import { useHrAuth } from './context/HrAuthContext';

// Route guard component for employee routes
const EmployeeRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
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

// Route guard for HR protected routes
const HrProtectedRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated } = useHrAuth();
  const location = useLocation();
  
  if (!isAuthenticated) {
    // Using a simple component instead of Navigate
    return <div className="hidden">Redirecting...</div>;
  }
  
  return children;
};

const AppRouter: React.FC = () => {
  const { isAuthenticated } = useHrAuth();
  const location = useLocation();
  const navigate = useNavigate();
  
  // Handle redirects based on auth state
  useEffect(() => {
    if (!isAuthenticated && (location.pathname === '/hr' || location.pathname === '/approved-hours')) {
      navigate('/hr-login', { replace: true });
    }
    
    // If user is authenticated and tries to access login page, redirect to HR
    if (isAuthenticated && location.pathname === '/hr-login') {
      navigate('/hr', { replace: true });
    }
  }, [isAuthenticated, location.pathname, navigate]);
  
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/hr-login" element={<HrLoginPage />} />
      <Route 
        path="/hr" 
        element={
          <HrProtectedRoute>
            <HrPage />
          </HrProtectedRoute>
        } 
      />
      <Route 
        path="/approved-hours" 
        element={
          <HrProtectedRoute>
            <ApprovedHoursPage />
          </HrProtectedRoute>
        } 
      />
      {/* Legacy route support */}
      <Route 
        path="/approved/approved-hours" 
        element={
          <HrProtectedRoute>
            <ApprovedHoursPage />
          </HrProtectedRoute>
        } 
      />
      <Route path="/login" element={<EmployeeLoginPage />} />
      <Route 
        path="/employee" 
        element={
          <EmployeeRoute>
            <EmployeeDashboardPage />
          </EmployeeRoute>
        } 
      />
      <Route path="/operational-manager" element={<OperationalManagerPage />} />
      {/* Handle unknown paths - render LandingPage instead of using Navigate */}
      <Route path="*" element={<LandingPage />} />
    </Routes>
  );
};

export default AppRouter;