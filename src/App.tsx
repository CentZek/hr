import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';

// Use React.lazy for code splitting to improve performance
const LandingPage = lazy(() => import('./pages/LandingPage'));
const HrPage = lazy(() => import('./pages/HrPage'));
const ApprovedHoursPage = lazy(() => import('./pages/ApprovedHoursPage'));
const EmployeeLoginPage = lazy(() => import('./pages/EmployeeLoginPage'));
const EmployeeDashboardPage = lazy(() => import('./pages/EmployeeDashboardPage'));

// Loading fallback
const LoadingFallback = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="animate-spin w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto mb-4"></div>
    <p className="text-gray-500">Loading...</p>
  </div>
);

// Error fallback for specific routes
const PageErrorFallback = ({ pageName }: { pageName: string }) => (
  <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-lg w-full">
      <h2 className="text-xl font-bold text-red-600 mb-4">Failed to load {pageName} page</h2>
      <p className="text-gray-700 mb-4">
        We're having trouble loading this page in your browser. Please try:
      </p>
      <ul className="list-disc pl-5 mb-4 text-gray-700">
        <li>Using a different browser (Chrome, Firefox, Edge)</li>
        <li>Clearing your browser cache</li>
        <li>Disabling browser extensions</li>
      </ul>
      <div className="flex gap-4 justify-center">
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Reload Page
        </button>
        <button
          onClick={() => window.location.href = '/'}
          className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
        >
          Go to Home
        </button>
      </div>
    </div>
  </div>
);

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={
        <ErrorBoundary fallback={<PageErrorFallback pageName="Landing" />}>
          <Suspense fallback={<LoadingFallback />}>
            <LandingPage />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="/hr" element={
        <ErrorBoundary fallback={<PageErrorFallback pageName="HR" />}>
          <Suspense fallback={<LoadingFallback />}>
            <HrPage />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="/approved-hours" element={
        <ErrorBoundary fallback={<PageErrorFallback pageName="Approved Hours" />}>
          <Suspense fallback={<LoadingFallback />}>
            <ApprovedHoursPage />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="/login" element={
        <ErrorBoundary fallback={<PageErrorFallback pageName="Login" />}>
          <Suspense fallback={<LoadingFallback />}>
            <EmployeeLoginPage />
          </Suspense>
        </ErrorBoundary>
      } />
      <Route path="/employee" element={
        <ErrorBoundary fallback={<PageErrorFallback pageName="Employee Dashboard" />}>
          <Suspense fallback={<LoadingFallback />}>
            <EmployeeDashboardPage />
          </Suspense>
        </ErrorBoundary>
      } />
      {/* Redirect any unknown paths to the landing page */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;