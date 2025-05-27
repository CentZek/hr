import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import HrPage from './pages/HrPage';
import ApprovedHoursPage from './pages/ApprovedHoursPage';
import EmployeeLoginPage from './pages/EmployeeLoginPage';
import EmployeeDashboardPage from './pages/EmployeeDashboardPage';

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/hr" element={<HrPage />} />
      <Route path="/approved-hours" element={<ApprovedHoursPage />} />
      <Route path="/login" element={<EmployeeLoginPage />} />
      <Route path="/employee" element={<EmployeeDashboardPage />} />
      {/* Redirect any unknown paths to the landing page */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;