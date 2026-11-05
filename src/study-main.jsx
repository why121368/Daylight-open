import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@/components/theme-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import ValueStudyPage from '@/pages/value-study-page';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(<ThemeProvider><ErrorBoundary fallbackPath="/"><ValueStudyPage /></ErrorBoundary></ThemeProvider>);
