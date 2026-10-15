import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';

// 注意：不使用 StrictMode，避免开发模式下 WebGL 引擎被创建两次
createRoot(document.getElementById('root')!).render(<App />);
