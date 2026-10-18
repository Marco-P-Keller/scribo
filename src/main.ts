import './styles/base.css';
import './styles/textlayer.css';
import './styles/chrome.css';
import { App } from './app/app';
import { createHost } from './host';

const root = document.getElementById('app')!;
const app = new App(root, createHost());
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e') || !window.scribo || window.scribo.e2e) {
  (window as unknown as { __scribo: App }).__scribo = app;
}
void app.start();
