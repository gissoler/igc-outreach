import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
/* Legacy styles first (Live Agent Run and the intake agent); the app theme loads after and wins. */
import './styles.css';
import './research.css';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
