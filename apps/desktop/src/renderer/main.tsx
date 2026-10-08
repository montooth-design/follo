// Renderer entry point: mount the app. Navigation and view selection live in App.tsx.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './style.css';
import '../shared/ui/ui.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
