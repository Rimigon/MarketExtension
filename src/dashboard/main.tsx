import { createRoot } from 'react-dom/client';
import '@/styles/global.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('dashboard root missing');
createRoot(root).render(<App />);
