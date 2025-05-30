import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import AppRouter from './AppRouter';
import { AppProvider } from './context/AppContext';
import { HrAuthProvider } from './context/HrAuthContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <HrAuthProvider>
          <AppRouter />
        </HrAuthProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>
);